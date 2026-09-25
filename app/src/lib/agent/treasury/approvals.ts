import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chatMessages,
  chatRoomBots,
  chatRoomMembers,
  treasuryActions,
  treasuryApprovals,
  treasurySeats,
  users,
  type TreasuryAction,
} from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { notifyConsent } from "@/lib/notifications";
import { worldIdConfigured, worldIdRpContext } from "@/lib/worldid";
import { worldIdV4Config } from "@/lib/worldid-v4";
import { idpMode } from "@/lib/auth/world";
import {
  appendTreasuryActivity,
  humanMemberIds,
  latestAdoption,
  liveTreasuryText,
  loadRelationTreasury,
  parseRatified,
} from "./memory";
import { evaluateCommand, parseTreasuryPolicy } from "./policy";
import {
  USD_PER_ETH,
  displayBalance,
  ensureAgentWallet,
  isTreasuryKey,
  receiptStatus,
  transferUsd,
  treasuryBalance,
} from "./wallet";
import {
  RATIFY_KIND,
  REQUEST_TTL_MS,
  TREASURY_SEAT_ACTION,
  type ApprovalResult,
  type RatifiedText,
  type RelationTreasury,
  type SeatResult,
  type TreasuryKind,
  type TreasuryStatus,
} from "./types";

/**
 * Treasury actions, seats and approvals — the database half of the treasury.
 *
 * Who counts is decided here and only here: a seat is one IDKit nullifier per
 * room, an approval is one World ID pairwise `sub` per action, and quorum is
 * the number of DISTINCT approver keys among approvals from VOTERS — members
 * of the electorate the rules in force were adopted with, still in the room,
 * still seated. Execution is claimed by a conditional UPDATE, so concurrent
 * approvals that both reach quorum pay exactly once, and the claimant
 * re-checks the request against the rules and balance in force at that
 * moment before any money moves.
 */

/** An approval proof may not predate the request (small allowance for clock skew). */
const FRESHNESS_SKEW_MS = 5_000;

const MSG = {
  seatSameHuman: "This human already holds a seat in this relation — one human, one seat.",
  notMember: "Only members of this relation can do that.",
  notElectorate:
    "You joined after our rules were adopted — the relation has to adopt its new membership before your approval counts.",
  notFound: "That treasury request no longer exists.",
  notPending: "This request has already been decided.",
  noRules: "This relation's memory has no Treasury Rules right now, so nothing can be approved.",
  expired: "This request expired before enough verified members approved it.",
  notSeated: "Claim your seat first — prove you're a unique human.",
  stale: "That World ID verification didn't show a fresh sign-in made after this request — approvals must be fresh.",
  subTaken: "This World ID already vouches for another account.",
  subMismatch: "This account is bound to a different World ID.",
  approverTaken: "This human already approved this request from another account.",
  alreadyApproved: "You already approved this request.",
};

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const TTL_HOURS = Math.round(REQUEST_TTL_MS / 3_600_000);

/** The unique index a Postgres 23505 tripped on ("" if unnamed), or null for any other error.
 *  drizzle wraps the pg error in DrizzleQueryError.cause. */
function uniqueViolation(err: unknown): string | null {
  let e = err as { code?: unknown; constraint?: unknown; cause?: unknown } | undefined;
  for (let i = 0; e && i < 4; i++) {
    if (e.code === "23505") return typeof e.constraint === "string" ? e.constraint : "";
    e = e.cause as typeof e;
  }
  return null;
}

async function isHumanMember(roomId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .innerJoin(users, eq(users.id, chatRoomMembers.userId))
    .where(
      and(eq(chatRoomMembers.roomId, roomId), eq(chatRoomMembers.userId, userId), eq(users.isAgent, false))
    )
    .limit(1);
  return Boolean(row);
}

/** Who can vote in this room right now: the electorate, still a member, seated. */
async function voters(roomId: string, electorate: string[]): Promise<Set<string>> {
  const [members, seats] = await Promise.all([
    humanMemberIds(roomId),
    db.select({ userId: treasurySeats.userId }).from(treasurySeats).where(eq(treasurySeats.roomId, roomId)),
  ]);
  const seated = new Set(seats.map((s) => s.userId));
  const votes = new Set(electorate);
  return new Set(members.filter((id) => seated.has(id) && votes.has(id)));
}

/** Distinct humans among the action's approvals from voters — a member who left, lost the seat, or was never in the electorate does not count. */
async function countedApprovals(actionId: string, eligible: Set<string>): Promise<number> {
  const rows = await db
    .select({ userId: treasuryApprovals.userId, approverKey: treasuryApprovals.approverKey })
    .from(treasuryApprovals)
    .where(eq(treasuryApprovals.actionId, actionId));
  return new Set(rows.filter((r) => eligible.has(r.userId)).map((r) => r.approverKey)).size;
}

async function approverNames(actionId: string, eligible: Set<string>): Promise<string[]> {
  const rows = await db
    .select({ userId: treasuryApprovals.userId, name: users.displayName })
    .from(treasuryApprovals)
    .innerJoin(users, eq(users.id, treasuryApprovals.userId))
    .where(eq(treasuryApprovals.actionId, actionId))
    .orderBy(asc(treasuryApprovals.createdAt));
  return rows.filter((r) => eligible.has(r.userId)).map((r) => r.name);
}

async function displayName(userId: string): Promise<string> {
  const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.name ?? "A member";
}

/** A shared message from the room's agent. Never fails the caller: the ledger
 *  row is the record, the chat line is a courtesy. */
async function postAgentMessage(roomId: string, agentUserId: string, text: string): Promise<void> {
  try {
    await db.insert(chatMessages).values({ roomId, authorId: agentUserId, text, attachments: [] });
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: `agent:${agentUserId}` });
  } catch (err) {
    console.error("treasury: agent message failed:", err);
  }
}

function logActivity(roomId: string, line: string): Promise<void> {
  return appendTreasuryActivity(roomId, [line]).catch((err: unknown) =>
    console.error("treasury: activity append failed:", err)
  );
}

function isExpired(a: Pick<TreasuryAction, "status" | "decidedAt" | "createdAt">, now = Date.now()): boolean {
  return a.status === "pending" && !a.decidedAt && a.createdAt.getTime() + REQUEST_TTL_MS < now;
}

// ── actions ─────────────────────────────────────────────────────────────────

export async function createTreasuryAction(input: {
  roomId: string;
  agentUserId: string;
  requestedBy: string;
  kind: TreasuryKind | typeof RATIFY_KIND;
  amountUsd: number;
  memo: string;
  recipientAddress?: string | null;
  recipientUserId?: string | null;
  ruleText: string;
  requiredApprovals: number;
  status?: "pending" | "blocked";
}): Promise<TreasuryAction> {
  const status = input.status ?? "pending";
  // set app-side: the freshness check compares it with IdP epoch seconds, so
  // it must not depend on the database session's time zone
  const now = new Date();
  const [action] = await db
    .insert(treasuryActions)
    .values({
      roomId: input.roomId,
      agentUserId: input.agentUserId,
      requestedBy: input.requestedBy,
      kind: input.kind,
      amountUsd: input.amountUsd,
      memo: input.memo,
      recipientAddress: input.recipientAddress ?? null,
      recipientUserId: input.recipientUserId ?? null,
      ruleText: input.ruleText,
      requiredApprovals: input.requiredApprovals,
      status,
      createdAt: now,
      decidedAt: status === "blocked" ? now : null,
    })
    .returning();

  if (status === "pending" && input.requiredApprovals > 0) {
    try {
      const seated = await db
        .select({ userId: treasurySeats.userId })
        .from(treasurySeats)
        .innerJoin(
          chatRoomMembers,
          and(eq(chatRoomMembers.roomId, treasurySeats.roomId), eq(chatRoomMembers.userId, treasurySeats.userId))
        )
        .where(eq(treasurySeats.roomId, input.roomId));
      const what =
        input.kind === RATIFY_KIND ? `adopting ${input.memo}` : `${usd(input.amountUsd)} · ${input.memo}`;
      await notifyConsent({
        recipientIds: seated.map((s) => s.userId),
        actorId: input.requestedBy, // notifyConsent skips the actor — the requester is not pinged
        roomId: input.roomId,
        body: `Treasury: approve ${what} (needs ${plural(input.requiredApprovals, "verified human")})`,
      });
    } catch (err) {
      console.error("treasury: approval notifications failed:", err);
    }
  }
  return action;
}

/**
 * The seed's founding adoption: the doc's current Rules and Payees, with the
 * room's members as the electorate, recorded without a vote — the members
 * agreed them in the room's chat before the treasury opened. Every later
 * change goes through a ratify request and the strictest quorum. Does nothing
 * (false) when the room already adopted a version.
 */
export async function adoptFoundingRules(input: {
  roomId: string;
  agentUserId: string;
  requestedBy: string;
}): Promise<boolean> {
  if (await latestAdoption(input.roomId)) return false;
  const live = await liveTreasuryText(input.roomId);
  if (!live) throw new Error(`treasury: room ${input.roomId} has no Treasury Rules section to adopt`);
  const text: RatifiedText = {
    rules: live.rules,
    payees: live.payees,
    members: await humanMemberIds(input.roomId),
    added: [...live.rules, ...live.payees],
    removed: [],
    joined: [],
    bar: "Our founding agreement — agreed in this room's chat before the treasury opened.",
  };
  const now = new Date();
  await db.insert(treasuryActions).values({
    roomId: input.roomId,
    agentUserId: input.agentUserId,
    requestedBy: input.requestedBy,
    kind: RATIFY_KIND,
    amountUsd: 0,
    memo: "our founding Treasury Rules and Payees",
    ruleText: JSON.stringify(text),
    requiredApprovals: 0,
    status: "executed",
    createdAt: now,
    decidedAt: now,
  });
  return true;
}

/**
 * Does this agent hold a relation treasury? Its wallet is then the treasury's,
 * and only this module's rule-checked, quorum-counted path may spend from it:
 * any treasury action ever recorded for it, a sealed treasury key, or a room
 * of its with Treasury Rules says yes. (The doc alone is not enough — a member
 * can delete the rules page.)
 */
export async function holdsTreasury(agentUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: treasuryActions.id })
    .from(treasuryActions)
    .where(eq(treasuryActions.agentUserId, agentUserId))
    .limit(1);
  if (row) return true;
  const [agent] = await db
    .select({ key: users.encryptedPrivateKey })
    .from(users)
    .where(eq(users.id, agentUserId))
    .limit(1);
  if (isTreasuryKey(agent?.key)) return true;
  const rooms = await db
    .select({ roomId: chatRoomBots.roomId })
    .from(chatRoomBots)
    .where(eq(chatRoomBots.agentUserId, agentUserId));
  for (const r of rooms) if (await loadRelationTreasury(r.roomId)) return true;
  return false;
}

// ── seats (IDKit Proof of Human) ────────────────────────────────────────────

/** The nullifier comes from the verified proof (or the server-derived dev
 *  nullifier) — callers must never pass a client-supplied value. */
export async function claimSeat(input: {
  roomId: string;
  userId: string;
  nullifierHash: string;
  verificationLevel: string;
}): Promise<SeatResult> {
  if (!(await isHumanMember(input.roomId, input.userId)))
    return { ok: false, reason: "not-member", message: MSG.notMember };
  try {
    await db.insert(treasurySeats).values({
      roomId: input.roomId,
      userId: input.userId,
      nullifierHash: input.nullifierHash,
      verificationLevel: input.verificationLevel,
    });
    return { ok: true, level: input.verificationLevel };
  } catch (err) {
    if (uniqueViolation(err) === null) throw err;
    // (room, user) → already seated, idempotent; otherwise the only other
    // unique index is (room, nullifier): this human sits on another account
    const [mine] = await db
      .select({ level: treasurySeats.verificationLevel })
      .from(treasurySeats)
      .where(and(eq(treasurySeats.roomId, input.roomId), eq(treasurySeats.userId, input.userId)))
      .limit(1);
    if (mine) return { ok: true, level: mine.level ?? input.verificationLevel };
    return { ok: false, reason: "same-human", message: MSG.seatSameHuman };
  }
}

// ── approvals (World ID for Agents step-up) ─────────────────────────────────

export type BindResult = null | { kind: "sub-taken"; holderId: string | null } | { kind: "sub-mismatch" };

/**
 * account ↔ human: an account is bound to one World ID sub, a sub to one
 * account. The write is conditional on the account being unbound, so two
 * flows finishing together cannot move an account from one human to another.
 */
export async function bindWorldSub(userId: string, sub: string): Promise<BindResult> {
  const [u] = await db.select({ worldSub: users.worldSub }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.worldSub === sub) return null;
  if (u?.worldSub) return { kind: "sub-mismatch" };
  try {
    const bound = await db
      .update(users)
      .set({ worldSub: sub, worldVerifiedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.worldSub)))
      .returning({ worldSub: users.worldSub });
    if (bound.length) return null;
    // lost a race against another bind of this same account
    const [again] = await db.select({ worldSub: users.worldSub }).from(users).where(eq(users.id, userId)).limit(1);
    return again?.worldSub === sub ? null : { kind: "sub-mismatch" };
  } catch (err) {
    if (uniqueViolation(err) === null) throw err;
    const [holder] = await db.select({ id: users.id }).from(users).where(eq(users.worldSub, sub)).limit(1);
    return { kind: "sub-taken", holderId: holder?.id ?? null };
  }
}

type Refusal = Extract<ApprovalResult, { ok: false }>;
type Gate = Refusal | { ok: true; action: TreasuryAction; treasury: RelationTreasury; eligible: Set<string> };

/**
 * Everything that must hold before a member's approval of `actionId` can
 * count, in the order a person would want to hear it. Shared by the approval
 * confirmation page (before any IdP round trip) and recordIdpApproval (after).
 */
async function approvalGate(actionId: string, userId: string, checkAlreadyApproved: boolean): Promise<Gate> {
  const [action] = await db.select().from(treasuryActions).where(eq(treasuryActions.id, actionId)).limit(1);
  if (!action) return { ok: false, reason: "not-found", message: MSG.notFound };
  if (action.status !== "pending" || action.decidedAt) return { ok: false, reason: "not-pending", message: MSG.notPending };
  if (isExpired(action)) {
    await expire(action).catch((err: unknown) => console.error(`treasury: could not expire ${action.id}:`, err));
    return { ok: false, reason: "expired", message: MSG.expired };
  }
  if (!(await isHumanMember(action.roomId, userId))) return { ok: false, reason: "not-member", message: MSG.notMember };
  const treasury = await loadRelationTreasury(action.roomId);
  if (!treasury) return { ok: false, reason: "not-pending", message: MSG.noRules };
  if (!treasury.electorate.includes(userId)) return { ok: false, reason: "not-electorate", message: MSG.notElectorate };

  const [seat] = await db
    .select({ id: treasurySeats.id })
    .from(treasurySeats)
    .where(and(eq(treasurySeats.roomId, action.roomId), eq(treasurySeats.userId, userId)))
    .limit(1);
  if (!seat) return { ok: false, reason: "not-seated", message: MSG.notSeated };

  if (checkAlreadyApproved) {
    const [mine] = await db
      .select({ id: treasuryApprovals.id })
      .from(treasuryApprovals)
      .where(and(eq(treasuryApprovals.actionId, action.id), eq(treasuryApprovals.userId, userId)))
      .limit(1);
    if (mine) return { ok: false, reason: "already-approved", message: MSG.alreadyApproved };
  }
  return { ok: true, action, treasury, eligible: await voters(action.roomId, treasury.electorate) };
}

/** What a member is about to approve, as the confirmation page shows it. */
export interface ApprovalCard {
  actionId: string;
  roomId: string;
  kind: string;
  amountUsd: number;
  memo: string;
  /** the rule that set the bar (a ratification: why it needs this many) */
  ruleText: string;
  recipient: { label: string; address: string | null } | null;
  changes: { added: string[]; removed: string[]; joined: string[] } | null;
  requestedBy: string;
  approvedBy: string[];
  required: number;
  expiresAt: string;
}

/**
 * The approval confirmation page's data — only when the viewer's approval
 * could count right now (same checks as recordIdpApproval, before the IdP).
 */
export async function approvalCard(actionId: string, viewerId: string): Promise<{ ok: true; card: ApprovalCard } | Refusal> {
  const gate = await approvalGate(actionId, viewerId, true);
  if (!gate.ok) return gate;
  const { action, eligible } = gate;
  const ratified = action.kind === RATIFY_KIND ? parseRatified(action.ruleText) : null;
  return {
    ok: true,
    card: {
      actionId: action.id,
      roomId: action.roomId,
      kind: action.kind,
      amountUsd: action.amountUsd,
      memo: action.memo,
      ruleText: ratified ? ratified.bar ?? "" : action.ruleText,
      recipient:
        action.kind === RATIFY_KIND
          ? null
          : { label: await recipientLabel(action), address: action.recipientAddress },
      changes: ratified
        ? { added: ratified.added ?? [], removed: ratified.removed ?? [], joined: ratified.joined ?? [] }
        : null,
      requestedBy: await displayName(action.requestedBy),
      approvedBy: await approverNames(action.id, eligible),
      required: action.requiredApprovals,
      expiresAt: new Date(action.createdAt.getTime() + REQUEST_TTL_MS).toISOString(),
    },
  };
}

/**
 * An approval arriving from a validated World ID for Agents step-up. `sub` and
 * `authTime` come from the ID token the server itself verified (never the
 * client); `userId` is the session's account.
 *
 * Records only — it never pays, so the approver's browser is not held on the
 * IdP redirect for the blocks a transfer takes. `executed` is always false;
 * `approvals >= required` means this approval completed the quorum, and the
 * caller then starts executeIfQuorum(actionId) without awaiting it (its
 * claim keeps any number of such starts to one payment).
 */
export async function recordIdpApproval(input: {
  actionId: string;
  userId: string;
  sub: string;
  authTime: number | null;
}): Promise<ApprovalResult> {
  const gate = await approvalGate(input.actionId, input.userId, false);
  if (!gate.ok) return gate;
  const { action, eligible } = gate;

  // fail-closed: the step-up asked for max_age=0, so the IdP owes us auth_time
  // (OIDC Core §3.1.2.1). Without it nothing shows a human signed in for THIS
  // request — iat only says when the token was minted, which a remembered IdP
  // session passes every time.
  if (input.authTime === null || input.authTime * 1000 < action.createdAt.getTime() - FRESHNESS_SKEW_MS)
    return { ok: false, reason: "stale-proof", message: MSG.stale };

  const approverKey = `sub:${input.sub}`;
  const voided = (why: string) =>
    postAgentMessage(action.roomId, action.agentUserId, `⛔ An approval was voided: ${why}`);
  const sameHumanApproved = "the same human already approved from another account.";

  const bind = await bindWorldSub(input.userId, input.sub);
  if (bind?.kind === "sub-taken") {
    const [prior] = await db
      .select({ id: treasuryApprovals.id })
      .from(treasuryApprovals)
      .where(and(eq(treasuryApprovals.actionId, action.id), eq(treasuryApprovals.approverKey, approverKey)))
      .limit(1);
    await voided(prior ? sameHumanApproved : "that World ID already vouches for another account — one human, one vote.");
    return { ok: false, reason: "same-human", message: MSG.subTaken };
  }
  if (bind?.kind === "sub-mismatch") {
    await voided("this account is bound to a different World ID.");
    return { ok: false, reason: "world-id-mismatch", message: MSG.subMismatch };
  }

  // checked first so a double submit reads as already-approved, not same-human
  // (both unique indexes would trip and Postgres reports only one)
  const [mine] = await db
    .select({ id: treasuryApprovals.id })
    .from(treasuryApprovals)
    .where(and(eq(treasuryApprovals.actionId, action.id), eq(treasuryApprovals.userId, input.userId)))
    .limit(1);
  if (mine) return { ok: false, reason: "already-approved", message: MSG.alreadyApproved };

  try {
    await db.insert(treasuryApprovals).values({
      actionId: action.id,
      userId: input.userId,
      approverKey,
      verificationLevel: "world-id-for-agents",
    });
  } catch (err) {
    const index = uniqueViolation(err);
    if (index === null) throw err;
    if (index === "treasury_approvals_action_user")
      return { ok: false, reason: "already-approved", message: MSG.alreadyApproved };
    const [holder] = await db
      .select({ userId: treasuryApprovals.userId })
      .from(treasuryApprovals)
      .where(and(eq(treasuryApprovals.actionId, action.id), eq(treasuryApprovals.approverKey, approverKey)))
      .limit(1);
    if (holder?.userId === input.userId)
      return { ok: false, reason: "already-approved", message: MSG.alreadyApproved };
    await voided(sameHumanApproved);
    return { ok: false, reason: "same-human", message: MSG.approverTaken };
  }

  const counted = await countedApprovals(action.id, eligible);
  await postAgentMessage(
    action.roomId,
    action.agentUserId,
    `✅ ${await displayName(input.userId)} approved with World ID — ${Math.min(counted, action.requiredApprovals)} of ${action.requiredApprovals}`
  );

  return { ok: true, approvals: counted, required: action.requiredApprovals, executed: false, txHash: null };
}

// ── execution ───────────────────────────────────────────────────────────────

/** Who the money went to, as the relation names it (the ADOPTED payees — a doc edit cannot relabel a payment). */
async function recipientLabel(action: TreasuryAction): Promise<string> {
  const addr = action.recipientAddress?.toLowerCase();
  if (addr) {
    const treasury = await loadRelationTreasury(action.roomId).catch(() => null);
    const payee = treasury?.payees.find((p) => p.address.toLowerCase() === addr);
    if (payee) return payee.name;
  }
  if (action.recipientUserId) return `${await displayName(action.recipientUserId)}'s wallet`;
  if (action.recipientAddress) return `${action.recipientAddress.slice(0, 6)}…${action.recipientAddress.slice(-4)}`;
  return action.memo || "the recipient";
}

const MEMO_FILLER = new Set(["the", "a", "an", "our", "to", "for", "of", "at"]);

/** "$180 to Hotel Gracery Shinjuku (hotel deposit)" — the memo only when it adds something to the label */
async function paymentPhrase(action: TreasuryAction): Promise<{ label: string; phrase: string }> {
  const label = await recipientLabel(action);
  const named = new Set(label.toLowerCase().split(/[^a-z0-9]+/));
  const adds = action.memo
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((w) => w && !named.has(w) && !MEMO_FILLER.has(w));
  return { label, phrase: `${usd(action.amountUsd)} to ${label}${adds ? ` (${action.memo})` : ""}` };
}

function errorText(err: unknown): string {
  const e = err as { shortMessage?: unknown; message?: unknown };
  const text =
    typeof e?.shortMessage === "string" ? e.shortMessage : typeof e?.message === "string" ? e.message : String(err);
  return text.split("\n")[0].slice(0, 300);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Outcome =
  | { status: "executed"; txHash: string | null; ruleText?: string }
  | { status: "failed"; error: string }
  /** sent, receipt not seen: the hash is kept so nobody pays it again blindly */
  | { status: "unconfirmed"; txHash: string; error: string }
  | { status: "blocked"; ruleText: string; error: string };

/**
 * Writes a claimed action's outcome. Retried, because until it lands the row is
 * claimed (decidedAt set) yet "pending": nobody can approve it and nothing
 * will pay it. Unconditional on status — this caller holds the claim, so what
 * it saw on chain beats an abandonment mark made meanwhile.
 */
async function settle(actionId: string, outcome: Outcome): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.update(treasuryActions).set(outcome).where(eq(treasuryActions.id, actionId));
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(attempt * 1_000);
    }
  }
}

/**
 * A claim older than this whose row is still "pending" lost its process (a
 * restart mid-transfer): past every receipt wait a live execution can spend,
 * including queueing behind the same wallet's other transfers.
 */
const CLAIM_ABANDONED_MS = 30 * 60_000;
const ABANDONED =
  "Interrupted: the server stopped before this payment was confirmed. It may or may not have been sent — check the treasury wallet on the explorer before asking again.";

/** Lapses a pending, unclaimed request; true when this call did it (and told the room). */
async function expire(action: TreasuryAction): Promise<boolean> {
  const why = `Expired: not approved within ${TTL_HOURS} hours.`;
  const [done] = await db
    .update(treasuryActions)
    .set({ status: "cancelled", decidedAt: new Date(), error: why })
    .where(and(eq(treasuryActions.id, action.id), eq(treasuryActions.status, "pending"), isNull(treasuryActions.decidedAt)))
    .returning({ id: treasuryActions.id });
  if (!done) return false;
  const what =
    action.kind === RATIFY_KIND ? `adopting ${action.memo}` : `${usd(action.amountUsd)} · ${action.memo}`;
  const nothing = action.kind === RATIFY_KIND ? "nothing was adopted" : "nothing was paid";
  await postAgentMessage(
    action.roomId,
    action.agentUserId,
    `⌛ The request for ${what} expired after ${TTL_HOURS} hours without enough verified approvals — ${nothing}.`
  );
  await logActivity(action.roomId, `⌛ Expired unapproved: ${what}`);
  return true;
}

type ExecuteResult = {
  executed: boolean;
  txHash?: string | null;
  approvals: number;
  required: number;
  error?: string;
  /** sent but not confirmed: the hash, so the caller can say so instead of "failed" */
  unconfirmedTx?: string | null;
  /** the relayer paid this transfer's gas (up front, refunded, or both) */
  gasSponsored?: boolean;
  gasRefundTx?: string | null;
};

/**
 * Adopting a ratification: the doc must still say exactly what was put to the
 * vote — an edit made after the request would otherwise ride in on approvals
 * given to something else. The electorate becomes the requested one minus
 * anyone who has left since.
 */
async function adopt(claimed: TreasuryAction, approvals: number, eligible: Set<string>): Promise<ExecuteResult> {
  const required = claimed.requiredApprovals;
  const asked = parseRatified(claimed.ruleText);
  const live = await liveTreasuryText(claimed.roomId).catch(() => null);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);
  let error: string | null = null;
  if (!asked) error = "the request is unreadable";
  else if (!live || !same(asked.rules, live.rules) || !same(asked.payees, live.payees))
    error = "the rules or payees were edited again after this was asked — ask me to adopt the current version";
  else if (parseTreasuryPolicy(asked.rules.join("\n")).unparsed.length) error = "some rule lines can't be read";

  if (error || !asked) {
    await settle(claimed.id, { status: "failed", error: `Not adopted: ${error}.` });
    await postAgentMessage(
      claimed.roomId,
      claimed.agentUserId,
      `⚠️ I didn't adopt the edited rules: ${error}. Nothing changed — I still follow the version we adopted before.`
    );
    return { executed: false, approvals, required, error: error ?? "unreadable" };
  }

  const members = new Set(await humanMemberIds(claimed.roomId));
  const text: RatifiedText = { ...asked, members: asked.members.filter((id) => members.has(id)) };
  await settle(claimed.id, { status: "executed", txHash: null, ruleText: JSON.stringify(text) });

  try {
    const names = await approverNames(claimed.id, eligible);
    const joined = asked.joined?.length ? `, and ${asked.joined.join(", ")} now vote${asked.joined.length === 1 ? "s" : ""}` : "";
    await postAgentMessage(
      claimed.roomId,
      claimed.agentUserId,
      `📜 Adopted: from now on I follow our edited Treasury Rules and Payees${joined} — approved by ${names.join(", ")} (${approvals} of ${plural(required, "verified human")}).`
    );
    const changes = [
      ...(asked.added ?? []).map((l) => `+ “${l}”`),
      ...(asked.removed ?? []).map((l) => `− “${l}”`),
      ...(asked.joined ?? []).map((n) => `+ ${n} votes`),
    ];
    await logActivity(
      claimed.roomId,
      `📜 Adopted edited rules and payees — approved by ${names.join(", ")}${changes.length ? `: ${changes.join("; ")}` : ""}`
    );
  } catch (err) {
    console.error(`treasury: could not announce adoption ${claimed.id}:`, err);
  }
  return { executed: true, txHash: null, approvals, required };
}

/**
 * The claimant's last look before money moves: the request was judged when it
 * was asked, but the adopted rules, the payees and the balance can all have
 * changed while it waited. Returns null when it may pay; otherwise the row has
 * been settled (blocked/failed) or released with a higher bar, and the result
 * says so. A re-check only ever tightens — it never lowers the bar.
 */
async function recheck(
  claimed: TreasuryAction,
  treasury: RelationTreasury | null,
  approvals: number
): Promise<ExecuteResult | null> {
  const required = claimed.requiredApprovals;
  const tell = async (text: string, activity: string) => {
    if (required > 0) await postAgentMessage(claimed.roomId, claimed.agentUserId, text);
    await logActivity(claimed.roomId, activity);
  };
  const block = async (ruleText: string, why: string): Promise<ExecuteResult> => {
    await settle(claimed.id, { status: "blocked", ruleText, error: why });
    const { phrase } = await paymentPhrase(claimed);
    await tell(`⛔ Not paid: ${phrase} — ${why}`, `⛔ Blocked at payment time: ${phrase} — ${why}`);
    return { executed: false, approvals, required, error: why };
  };
  const fail = async (why: string): Promise<ExecuteResult> => {
    await settle(claimed.id, { status: "failed", error: why });
    const { phrase } = await paymentPhrase(claimed);
    await tell(`⚠️ Could not pay ${phrase}: ${why}`, `⚠️ Not paid: ${phrase} — ${why}`);
    return { executed: false, approvals, required, error: why };
  };

  if (!treasury?.adoptedAt)
    return block(claimed.ruleText, "our memory has no adopted Treasury Rules right now, and I don't move money without them.");

  const to = claimed.recipientAddress?.toLowerCase() ?? "";
  const personal = claimed.recipientUserId !== null;
  if (personal) {
    const [owner] = await db
      .select({ address: users.ainAddress })
      .from(users)
      .where(eq(users.id, claimed.recipientUserId!))
      .limit(1);
    if (owner?.address?.toLowerCase() !== to || !(await isHumanMember(claimed.roomId, claimed.recipientUserId!)))
      return block(claimed.ruleText, "that wallet no longer belongs to a member of this room.");
  } else if (!treasury.payees.some((p) => p.address.toLowerCase() === to)) {
    return block(claimed.ruleText, "it is no longer one of the payees we adopted.");
  }

  let balanceUsd: number;
  try {
    balanceUsd = (await treasuryBalance((await ensureAgentWallet(claimed.agentUserId)).address)).usd;
  } catch (err) {
    console.error(`treasury: balance read for ${claimed.id} failed:`, err);
    return fail("I couldn't read the treasury balance to re-check our rules — nothing was sent.");
  }

  const decision = evaluateCommand({
    policy: treasury.policy,
    kind: claimed.kind as TreasuryKind,
    amountUsd: claimed.amountUsd,
    personal,
    balanceUsd,
  });
  if (decision.outcome === "forbidden")
    return block(
      decision.rule?.text ?? decision.reason,
      decision.rule ? `our rules now say “${decision.rule.text}”` : decision.reason
    );
  if (decision.outcome === "insufficient")
    return fail(`that's more than the treasury holds now (${usd(decision.balanceUsd)}) — nothing was sent.`);
  if (decision.outcome === "approval" && decision.required > approvals) {
    // back to pending under the bar that applies now; the approvals so far still count
    await db
      .update(treasuryActions)
      .set({ decidedAt: null, requiredApprovals: decision.required, ruleText: decision.rule.text })
      .where(and(eq(treasuryActions.id, claimed.id), eq(treasuryActions.status, "pending")));
    await postAgentMessage(
      claimed.roomId,
      claimed.agentUserId,
      `⏳ Things changed since this was asked: ${usd(claimed.amountUsd)} · ${claimed.memo} now needs ${plural(decision.required, "verified human")} — our rules say “${decision.rule.text}”. ${approvals} so far.`
    );
    return { executed: false, approvals, required: decision.required };
  }
  return null;
}

/**
 * Pays out once DISTINCT approvers among the voters reach the action's bar
 * (or at once when the bar is 0), after re-checking it against the rules and
 * balance in force now. Safe to call from any number of concurrent approvals
 * or status polls: only the caller whose UPDATE claims the pending row acts.
 * A ratification is adopted instead of paid.
 *
 * Once claimed, the row always ends "executed", "unconfirmed" (sent, receipt
 * not seen — the hash is kept), "blocked" or "failed", or goes back to
 * pending with a higher bar. A process that dies mid-transfer is marked failed
 * by treasuryStatus after CLAIM_ABANDONED_MS.
 *
 * `executed` means THIS call moved the money (or adopted the text). The chat
 * announcement is posted only for quorum-approved actions (required > 0); an
 * auto action is executed by the skill, which answers in chat itself. The
 * activity line is always kept.
 */
export async function executeIfQuorum(actionId: string): Promise<ExecuteResult> {
  const [action] = await db.select().from(treasuryActions).where(eq(treasuryActions.id, actionId)).limit(1);
  if (!action) return { executed: false, approvals: 0, required: 0, error: "not-found" };
  const required = action.requiredApprovals;
  if (action.status !== "pending" || action.decidedAt)
    return { executed: false, txHash: action.txHash, approvals: 0, required };
  if (isExpired(action)) {
    await expire(action);
    return { executed: false, approvals: 0, required, error: MSG.expired };
  }

  const treasury = await loadRelationTreasury(action.roomId);
  const eligible = await voters(action.roomId, treasury?.electorate ?? []);
  const approvals = await countedApprovals(actionId, eligible);
  if (approvals < required) return { executed: false, approvals, required };

  const [claimed] = await db
    .update(treasuryActions)
    .set({ decidedAt: new Date() })
    .where(
      and(eq(treasuryActions.id, actionId), eq(treasuryActions.status, "pending"), isNull(treasuryActions.decidedAt))
    )
    .returning();
  if (!claimed) return { executed: false, approvals, required };

  if (claimed.kind === RATIFY_KIND) return adopt(claimed, approvals, eligible);
  const stopped = await recheck(claimed, treasury, approvals);
  if (stopped) return stopped;

  let txHash: `0x${string}` | null = null;
  let sentTx: string | null = null;
  let gasRefundTx: `0x${string}` | null = null;
  let gasSponsored = false;
  let error: string | null = null;
  try {
    const to = claimed.recipientAddress;
    if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) error = "This request has no valid recipient address.";
    else
      ({ txHash, gasRefundTx, gasSponsored } = await transferUsd(
        claimed.agentUserId,
        to as `0x${string}`,
        claimed.amountUsd
      ));
  } catch (err) {
    error = errorText(err);
    // wallet.ts attaches the hash when a transaction went out: it may land
    const sent = (err as { txHash?: unknown } | null)?.txHash;
    if (typeof sent === "string" && /^0x[0-9a-fA-F]{64}$/.test(sent)) sentTx = sent;
  }
  const failure = error ?? "transfer failed";

  try {
    await settle(
      actionId,
      txHash
        ? { status: "executed", txHash }
        : sentTx
          ? { status: "unconfirmed", txHash: sentTx, error: failure }
          : { status: "failed", error: failure }
    );
  } catch (err) {
    // left for the abandonment sweep; the hash is the one fact worth keeping
    const tx = txHash ?? sentTx;
    console.error(`treasury: could not record the outcome of ${actionId}${tx ? ` (SENT, tx ${tx})` : ""}:`, err);
    throw err;
  }

  // the money is settled; everything below is telling people about it
  try {
    const { phrase } = await paymentPhrase(claimed);
    const names = await approverNames(actionId, eligible);
    const approvedBy =
      required > 0 ? `approved by ${names.join(", ")} (${approvals} of ${plural(required, "verified human")})` : "";

    if (txHash) {
      const gas = gasSponsored ? " · gas sponsored by the relayer" : "";
      if (required > 0)
        await postAgentMessage(claimed.roomId, claimed.agentUserId, `✅ Paid ${phrase} — ${approvedBy}. tx ${txHash}${gas}`);
      await logActivity(
        claimed.roomId,
        `Paid ${phrase} — ${required > 0 ? approvedBy : "within what the agent may pay on its own"} — tx ${txHash}${gas}${gasRefundTx ? ` (refund tx ${gasRefundTx})` : ""}`
      );
    } else if (sentTx) {
      if (required > 0)
        await postAgentMessage(
          claimed.roomId,
          claimed.agentUserId,
          `⏳ I sent ${phrase}, but couldn't confirm it yet (tx ${sentTx}) — it may still land. It's marked unconfirmed in the treasury panel; please don't ask for it again until it settles.`
        );
      await logActivity(claimed.roomId, `⏳ Sent, not confirmed yet: ${phrase} — tx ${sentTx}`);
    } else if (required > 0) {
      await postAgentMessage(
        claimed.roomId,
        claimed.agentUserId,
        `⚠️ Could not pay ${phrase}: ${failure.replace(/\.?$/, ".")} It's marked failed in the treasury panel.`
      );
    }
  } catch (err) {
    console.error(`treasury: could not announce the outcome of ${actionId}:`, err);
  }

  return txHash
    ? { executed: true, txHash, approvals, required, gasSponsored, gasRefundTx }
    : { executed: false, approvals, required, error: failure, unconfirmedTx: sentTx };
}

/** Marks claims whose process died (see CLAIM_ABANDONED_MS) failed; returns the ids it marked. */
async function settleAbandoned(rows: TreasuryAction[]): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - CLAIM_ABANDONED_MS);
  const stale = rows.filter((a) => a.status === "pending" && a.decidedAt && a.decidedAt < cutoff).map((a) => a.id);
  if (!stale.length) return new Set();
  const marked = await db
    .update(treasuryActions)
    .set({ status: "failed", error: ABANDONED })
    .where(
      and(inArray(treasuryActions.id, stale), eq(treasuryActions.status, "pending"), lt(treasuryActions.decidedAt, cutoff))
    )
    .returning({ id: treasuryActions.id });
  return new Set(marked.map((m) => m.id));
}

/** An unconfirmed payment the chain has since decided: the row follows the receipt. */
async function settleUnconfirmed(a: TreasuryAction): Promise<Partial<TreasuryAction> | null> {
  if (!a.txHash) return null;
  const seen = await receiptStatus(a.txHash as `0x${string}`);
  if (!seen) return null;
  const next =
    seen === "success"
      ? { status: "executed", error: null }
      : { status: "failed", error: `The payment reverted on Sepolia (tx ${a.txHash}) — nothing was sent.` };
  const [done] = await db
    .update(treasuryActions)
    .set(next)
    .where(and(eq(treasuryActions.id, a.id), eq(treasuryActions.status, "unconfirmed")))
    .returning({ id: treasuryActions.id });
  if (!done) return null;
  const { phrase } = await paymentPhrase(a);
  if (seen === "success") {
    await postAgentMessage(a.roomId, a.agentUserId, `✅ The payment of ${phrase} confirmed after all — tx ${a.txHash}`);
    await logActivity(a.roomId, `Paid ${phrase} — confirmed late — tx ${a.txHash}`);
  } else {
    await postAgentMessage(a.roomId, a.agentUserId, `⚠️ The payment of ${phrase} reverted on Sepolia — nothing was sent (tx ${a.txHash}).`);
    await logActivity(a.roomId, `⚠️ Reverted: ${phrase} — tx ${a.txHash}`);
  }
  return next;
}

// ── status (the panel) ──────────────────────────────────────────────────────

const STATUSES = new Set(["pending", "executed", "blocked", "failed", "cancelled", "unconfirmed"]);

/**
 * The panel's view of the room's treasury. Each poll also does the upkeep no
 * single request owns: marks abandoned claims failed, lapses expired requests,
 * follows unconfirmed payments to their receipt, and restarts execution of a
 * request that reached its quorum but was never claimed (its starter died, or
 * threw before the claim) — executeIfQuorum's claim keeps that to one payment.
 */
export async function treasuryStatus(roomId: string, viewerId: string): Promise<TreasuryStatus> {
  const treasury = await loadRelationTreasury(roomId);

  const [bot] = await db
    .select({ agentUserId: chatRoomBots.agentUserId })
    .from(chatRoomBots)
    .innerJoin(users, eq(users.id, chatRoomBots.agentUserId))
    .where(and(eq(chatRoomBots.roomId, roomId), eq(users.isAgent, true)))
    .orderBy(asc(chatRoomBots.importedAt))
    .limit(1);

  let address: string | null = null;
  let balance: { eth: string; usd: number } | null = null;
  if (treasury && bot) {
    try {
      address = (await ensureAgentWallet(bot.agentUserId)).address;
      balance = await displayBalance(address as `0x${string}`);
    } catch (err) {
      // an RPC outage must not take the panel down; the rules still show
      console.error("treasury: wallet/balance unavailable:", err);
    }
  }

  const memberRows = await db
    .select({ userId: users.id, displayName: users.displayName, worldSub: users.worldSub })
    .from(chatRoomMembers)
    .innerJoin(users, eq(users.id, chatRoomMembers.userId))
    .where(and(eq(chatRoomMembers.roomId, roomId), eq(users.isAgent, false)))
    .orderBy(asc(chatRoomMembers.joinedAt));
  const seats = await db
    .select({ userId: treasurySeats.userId, level: treasurySeats.verificationLevel })
    .from(treasurySeats)
    .where(eq(treasurySeats.roomId, roomId));
  const seatBy = new Map(seats.map((s) => [s.userId, s.level]));
  const mySeated = seatBy.has(viewerId);
  const electorate = new Set(treasury?.electorate ?? []);
  const eligible = new Set(memberRows.map((m) => m.userId).filter((id) => seatBy.has(id) && electorate.has(id)));

  const actionRows = await db
    .select()
    .from(treasuryActions)
    .where(eq(treasuryActions.roomId, roomId))
    .orderBy(desc(treasuryActions.createdAt))
    .limit(20);
  try {
    const abandoned = await settleAbandoned(actionRows);
    for (const a of actionRows)
      if (abandoned.has(a.id)) Object.assign(a, { status: "failed", error: ABANDONED });
    const now = Date.now();
    for (const a of actionRows) {
      if (isExpired(a, now) && (await expire(a)))
        Object.assign(a, { status: "cancelled", decidedAt: new Date(), error: `Expired: not approved within ${TTL_HOURS} hours.` });
      else if (a.status === "unconfirmed") {
        const next = await settleUnconfirmed(a);
        if (next) Object.assign(a, next);
      }
    }
  } catch (err) {
    console.error("treasury: status upkeep failed:", err);
  }
  const actionIds = actionRows.map((a) => a.id);
  const approvalRows = actionIds.length
    ? await db
        .select({
          actionId: treasuryApprovals.actionId,
          userId: treasuryApprovals.userId,
          approverKey: treasuryApprovals.approverKey,
          displayName: users.displayName,
          at: treasuryApprovals.createdAt,
        })
        .from(treasuryApprovals)
        .innerJoin(users, eq(users.id, treasuryApprovals.userId))
        .where(inArray(treasuryApprovals.actionId, actionIds))
        .orderBy(asc(treasuryApprovals.createdAt))
    : [];
  const approvalsBy = new Map<string, typeof approvalRows>();
  for (const r of approvalRows) {
    const list = approvalsBy.get(r.actionId) ?? [];
    list.push(r);
    approvalsBy.set(r.actionId, list);
  }

  const nameBy = new Map(memberRows.map((m) => [m.userId, m.displayName]));
  const missing = [
    ...new Set(actionRows.flatMap((a) => [a.requestedBy, ...(a.recipientUserId ? [a.recipientUserId] : [])])),
  ].filter((id) => !nameBy.has(id));
  if (missing.length) {
    const rows = await db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, missing));
    for (const r of rows) nameBy.set(r.id, r.name);
  }
  const payeeName = new Map((treasury?.payees ?? []).map((p) => [p.address.toLowerCase(), p.name]));

  // v4 first, as the seat route checks it: the mode shown is the mode that verifies
  const v4 = worldIdV4Config();

  const actions = actionRows.map((a) => {
    const all = approvalsBy.get(a.id) ?? [];
    const pending = a.status === "pending";
    // a pending request shows the approvals that count; a decided one, who approved it
    const shown = pending ? all.filter((x) => eligible.has(x.userId)) : all;
    const counted = new Set(shown.map((x) => x.approverKey)).size;
    const status = (STATUSES.has(a.status) ? a.status : "failed") as TreasuryStatus["actions"][number]["status"];
    const ratified = a.kind === RATIFY_KIND ? parseRatified(a.ruleText) : null;
    if (pending && !a.decidedAt && a.requiredApprovals > 0 && counted >= a.requiredApprovals)
      void executeIfQuorum(a.id).catch((err: unknown) => console.error(`treasury: restarting ${a.id} failed:`, err));
    return {
      id: a.id,
      kind: a.kind as TreasuryKind | typeof RATIFY_KIND,
      amountUsd: a.amountUsd,
      memo: a.memo,
      status,
      requiredApprovals: a.requiredApprovals,
      ruleText: a.kind === RATIFY_KIND ? ratified?.bar ?? "" : a.ruleText,
      recipient:
        a.kind === RATIFY_KIND
          ? null
          : {
              label:
                (a.recipientAddress && payeeName.get(a.recipientAddress.toLowerCase())) ??
                (a.recipientUserId && nameBy.has(a.recipientUserId) ? `${nameBy.get(a.recipientUserId)}'s wallet` : null),
              address: a.recipientAddress,
            },
      changes: ratified
        ? { added: ratified.added ?? [], removed: ratified.removed ?? [], joined: ratified.joined ?? [] }
        : null,
      requestedBy: { userId: a.requestedBy, displayName: nameBy.get(a.requestedBy) ?? "Unknown" },
      approvals: shown.map((x) => ({ userId: x.userId, displayName: x.displayName, at: x.at.toISOString() })),
      txHash: a.txHash,
      error: a.error,
      createdAt: a.createdAt.toISOString(),
      expiresAt: pending ? new Date(a.createdAt.getTime() + REQUEST_TTL_MS).toISOString() : null,
      canApprove:
        status === "pending" &&
        a.decidedAt === null &&
        mySeated &&
        electorate.has(viewerId) &&
        !all.some((x) => x.userId === viewerId),
    };
  });

  return {
    enabled: treasury !== null,
    address,
    balanceUsd: balance?.usd ?? null,
    balanceEth: balance?.eth ?? null,
    usdPerEth: USD_PER_ETH,
    purpose: treasury?.purpose ?? "",
    rulesPageId: treasury?.rulesPageId ?? null,
    rules: treasury?.policy.rules.map((r) => r.text) ?? [],
    adoptedAt: treasury?.adoptedAt ?? null,
    proposal: treasury?.proposal
      ? {
          added: treasury.proposal.added,
          removed: treasury.proposal.removed,
          reordered: treasury.proposal.reordered,
          joined: treasury.proposal.joined.map((id) => nameBy.get(id) ?? "a new member"),
        }
      : null,
    members: memberRows.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      seated: seatBy.has(m.userId),
      seatLevel: seatBy.get(m.userId) ?? null,
      worldVerified: m.worldSub !== null,
      voting: electorate.has(m.userId),
    })),
    mySeated,
    actions,
    seatMode: v4
      ? "world-id-v4"
      : worldIdConfigured() && worldIdRpContext() && process.env.NEXT_PUBLIC_WORLD_ID_APP_ID
        ? "world-id"
        : "dev-simulator",
    seatEnvironment: v4?.environment ?? null,
    seatAction: TREASURY_SEAT_ACTION,
    rpContext: worldIdRpContext(),
    idpMode: idpMode(),
  };
}
