import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRoomStates,
  chatMessages,
  chatRoomBots,
  chatRooms,
  notifications,
  treasuryActions,
  treasuryApprovals,
  treasurySeats,
  users,
  type TreasuryAction,
} from "@/lib/db/schema";
import { idpMode } from "@/lib/auth/world";
import { worldIdV4Config } from "@/lib/worldid-v4";
import { describeTreasuryAction } from "@/lib/agent/treasury/summary";
import { INVEST_CHAIN, investConfig } from "@/lib/agent/treasury/invest";
import { RATIFY_KIND, RECURRING_RUN_KIND } from "@/lib/agent/treasury/types";
import { displayBalance, ensureAgentWallet, fundTreasury, treasuryBalance } from "@/lib/agent/treasury/wallet";
import { activityDayHeading } from "@/lib/agent/treasury/memory";
import { okfDocMeta } from "@/lib/agent/okf-docs";
import { profileForRoom } from "@/lib/agent/profiles";
import { nodeExists, writePage } from "@/lib/okf-store";
import { TOKYO_TALK_LINES, TREASURY_OPENING, tokyoTripRecord } from "@/lib/tokyo-trip-record";

/**
 * The public /world page. Two copies of the Tokyo Trip room, both made by
 * scripts/seed-tokyo-trip.mts and each found by its Alex's demo account:
 *   "tokyo" — the room the video is recorded in, shown read-only;
 *   "try"   — the --try copy visitors enter as its members, with its own
 *             accounts, agent and wallet, so nothing they do reaches "tokyo".
 * Everything here is readable without signing in, so it carries only what the
 * room would show a member: no keys, no addresses beyond public tx links.
 */

export type DemoCopy = "tokyo" | "try";
export const MEMBER_KEYS = ["alex", "bea", "chris", "dana", "eli", "alex2"] as const;
export type MemberKey = (typeof MEMBER_KEYS)[number];
const ROOM_NAME = "Tokyo Trip";
const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";

export function isMemberKey(v: string): v is MemberKey {
  return (MEMBER_KEYS as readonly string[]).includes(v);
}

/** Demo login is what /world hands visitors; off in production unless the deploy opts in. */
export function demoLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_LOGIN === "1";
}

export interface DemoMember {
  key: MemberKey;
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface DemoRoom {
  roomId: string;
  agentUserId: string | null;
  members: DemoMember[];
}

export async function demoRoom(copy: DemoCopy): Promise<DemoRoom | null> {
  const people = await db
    .select({ id: users.id, ainAddress: users.ainAddress, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.ainAddress, MEMBER_KEYS.map((k) => `demo:${copy}-${k}`)));
  const byKey = new Map(people.map((p) => [p.ainAddress?.slice(`demo:${copy}-`.length), p]));
  const alex = byKey.get("alex");
  if (!alex) return null;
  const [room] = await db
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(and(eq(chatRooms.name, ROOM_NAME), eq(chatRooms.createdBy, alex.id), eq(chatRooms.kind, "dm")))
    .orderBy(asc(chatRooms.createdAt))
    .limit(1);
  if (!room) return null;
  const [bot] = await db
    .select({ agentUserId: chatRoomBots.agentUserId })
    .from(chatRoomBots)
    .where(eq(chatRoomBots.roomId, room.id))
    .limit(1);
  const members = MEMBER_KEYS.flatMap((key) => {
    const p = byKey.get(key);
    return p ? [{ key, userId: p.id, name: p.displayName, avatarUrl: p.avatarUrl }] : [];
  });
  return { roomId: room.id, agentUserId: bot?.agentUserId ?? null, members };
}

export interface DemoSnapshot {
  /** null when it could not be read in time */
  balanceUsd: number | null;
  /** members holding a vote; `world` is false for a vote the seed placed (shown as "dev vote" in the app) */
  votes: { name: string; world: boolean }[];
  /** newest first */
  activity: { at: string; line: string; status: string; txUrl: string | null }[];
}

function txUrl(a: TreasuryAction): string | null {
  if (!a.txHash) return null;
  const onBase = (a.kind === "investment" || a.kind === RECURRING_RUN_KIND) && investConfig() !== null;
  return `${onBase ? INVEST_CHAIN.explorer : SEPOLIA_EXPLORER}/tx/${a.txHash}`;
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function agentAddress(agentUserId: string | null): Promise<`0x${string}` | null> {
  if (!agentUserId) return null;
  // ensureAgentWallet mints a key when there is none; this page never does
  const [agent] = await db
    .select({ key: users.encryptedPrivateKey })
    .from(users)
    .where(and(eq(users.id, agentUserId), eq(users.isAgent, true)))
    .limit(1);
  if (!agent?.key) return null;
  return (await ensureAgentWallet(agentUserId)).address;
}

export async function demoSnapshot(room: DemoRoom, now = Date.now()): Promise<DemoSnapshot> {
  const [seats, actions, balanceUsd] = await Promise.all([
    db
      .select({ userId: treasurySeats.userId, level: treasurySeats.verificationLevel })
      .from(treasurySeats)
      .where(eq(treasurySeats.roomId, room.roomId)),
    db
      .select()
      .from(treasuryActions)
      .where(eq(treasuryActions.roomId, room.roomId))
      .orderBy(desc(treasuryActions.createdAt))
      .limit(8),
    agentAddress(room.agentUserId)
      .then((address) => (address ? within(displayBalance(address), 4000).then((b) => b.usd) : null))
      .catch(() => null),
  ]);
  const nameOf = new Map(room.members.map((m) => [m.userId, m.name]));
  return {
    balanceUsd,
    votes: room.members
      .filter((m) => seats.some((s) => s.userId === m.userId))
      .map((m) => ({ name: nameOf.get(m.userId) ?? m.name, world: seats.find((s) => s.userId === m.userId)?.level !== "dev-simulator" })),
    activity: actions.map((a) => ({
      at: (a.decidedAt ?? a.createdAt).toISOString(),
      line: describeTreasuryAction(a, now),
      status: a.status,
      txUrl: txUrl(a),
    })),
  };
}

/** Which World each surface talks to on this server — the pre-flight, readable by anyone. */
export function worldModes(): { approvals: "sandbox" | "mock" | null; votes: string | null } {
  return { approvals: idpMode(), votes: worldIdV4Config()?.environment ?? null };
}

/**
 * On the way into the try-it room as a member: forget which World ID that
 * account was bound to. Visitors share these accounts, and the sandbox gives
 * each browser its own fake human — a binding left by the previous visitor
 * would void this visitor's first approval as "bound to a different World ID".
 */
export async function unbindTryMember(room: DemoRoom, key: MemberKey): Promise<void> {
  const member = room.members.find((m) => m.key === key);
  if (!member) return;
  await db.update(users).set({ worldSub: null, worldVerifiedAt: null }).where(eq(users.id, member.userId));
}

const RESET_EVERY_MS = 30_000;
const TOP_UP_EVERY_MS = 10 * 60_000;
const TOP_UP_BELOW_USD = 900;
const TOP_UP_TO_USD = 1000;
let lastReset = 0;
let lastTopUp = 0;

/**
 * "Start over" for the try-it room: votes, requests, approvals, World ID
 * bindings, the members' notifications and the visitors' chat go; the room, its
 * agent and the founding adoption stay, and the relation's doc goes back to
 * what the seed wrote. Chat is cut at the founding adoption plus a minute: the
 * seed dates the friends' conversation before it, and everything later was
 * said by visitors or answered to them.
 */
export async function resetTryRoom(): Promise<{ status: "done" | "missing" | "too-soon"; room: DemoRoom | null }> {
  const now = Date.now();
  if (now - lastReset < RESET_EVERY_MS) return { status: "too-soon", room: null };
  const room = await demoRoom("try");
  if (!room) return { status: "missing", room: null };
  lastReset = now;

  const actions = await db
    .select({ id: treasuryActions.id, kind: treasuryActions.kind, createdAt: treasuryActions.createdAt })
    .from(treasuryActions)
    .where(eq(treasuryActions.roomId, room.roomId))
    .orderBy(asc(treasuryActions.createdAt));
  const founding = actions.find((a) => a.kind === RATIFY_KIND);
  const drop = actions.filter((a) => a.id !== founding?.id).map((a) => a.id);
  if (drop.length) {
    await db.delete(treasuryApprovals).where(inArray(treasuryApprovals.actionId, drop));
    await db.delete(treasuryActions).where(inArray(treasuryActions.id, drop));
  }
  await db.delete(treasurySeats).where(eq(treasurySeats.roomId, room.roomId));
  if (founding)
    await db
      .delete(chatMessages)
      .where(and(eq(chatMessages.roomId, room.roomId), gt(chatMessages.createdAt, new Date(founding.createdAt.getTime() + 60_000))));
  const humanIds = room.members.map((m) => m.userId);
  if (humanIds.length) {
    await db.update(users).set({ worldSub: null, worldVerifiedAt: null }).where(inArray(users.id, humanIds));
    await db.delete(notifications).where(inArray(notifications.userId, humanIds));
  }
  await restoreTryRecord(room.roomId);
  return { status: "done", room };
}

/**
 * The try-it room's doc as the seed left it. Visitors' requests append to its
 * Meeting log and Action items (the pipeline) and to its Treasury Activity (the
 * ledger), none of which lives in the rows Start over deletes, so each reset
 * left the next visitor a doc full of other people's $180 requests. Purpose,
 * Treasury Rules and Payees stay: only an adoption changes those.
 */
async function restoreTryRecord(roomId: string): Promise<void> {
  const [state] = await db
    .select({ sectionOkfPaths: agentRoomStates.sectionOkfPaths })
    .from(agentRoomStates)
    .where(eq(agentRoomStates.roomId, roomId));
  const paths = (state?.sectionOkfPaths ?? {}) as Record<string, string>;
  const profile = await profileForRoom(roomId);
  // the seed's conversation: dated before everything a visitor could have said
  const talk = await db
    .select({ id: chatMessages.id, at: chatMessages.createdAt })
    .from(chatMessages)
    .where(eq(chatMessages.roomId, roomId))
    .orderBy(asc(chatMessages.createdAt))
    .limit(TOKYO_TALK_LINES);
  for (const s of tokyoTripRecord(roomId, talk.map((m) => m.id), talk[0]?.at ?? new Date())) {
    const rel = paths[s.key];
    if (rel && nodeExists(rel)) writePage(rel, s.title, okfDocMeta(roomId, profile, s.key), s.blocks);
  }
  const activity = paths["treasury-activity"];
  if (activity && nodeExists(activity))
    writePage(activity, "Treasury Activity", okfDocMeta(roomId, profile, undefined, { type: "Memory" }), [
      { id: randomUUID(), type: "heading1", content: { text: activityDayHeading(new Date()) }, position: 1 },
      { id: randomUUID(), type: "bulleted_list", content: { text: TREASURY_OPENING }, position: 2 },
    ]);
}

/** fundTreasury pays from this key; a deploy without one (ainmem.ainetwork.xyz) refills only when the seed is rerun. */
export function canTopUp(): boolean {
  return Boolean((process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY ?? "").trim());
}

/** Refill the try-it wallet when visitors' payments have run it down; a Sepolia transfer, so not on every reset. */
export async function topUpTryRoom(room: DemoRoom): Promise<string | null> {
  if (!canTopUp() || Date.now() - lastTopUp < TOP_UP_EVERY_MS) return null;
  const address = await agentAddress(room.agentUserId);
  if (!address) return null;
  lastTopUp = Date.now();
  if ((await treasuryBalance(address)).usd >= TOP_UP_BELOW_USD) return null;
  return fundTreasury(address, TOP_UP_TO_USD);
}
