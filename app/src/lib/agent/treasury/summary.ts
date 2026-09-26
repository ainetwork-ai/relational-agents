import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chatRoomBots,
  chatRoomMembers,
  chatRooms,
  treasuryActions,
  treasuryApprovals,
  treasurySeats,
  users,
  type TreasuryAction,
} from "@/lib/db/schema";
import { loadRelationTreasury } from "./memory";
import { parseAuthority, parseRun } from "./recurring-record";
import { recurringBuyStatus } from "./recurring";
import { RATIFY_KIND, RECURRING_BUY_KIND, RECURRING_RUN_KIND, REQUEST_TTL_MS } from "./types";

/**
 * Money state per relation, for the sidebar (GET /api/treasury/summary).
 *
 * Polled every 30 s by every open sidebar, so it is READ-ONLY and chain-free:
 * no treasuryStatus (its polls sweep abandoned claims, lapse requests and
 * restart executions), no RPC, no key minting. It reads treasury_actions /
 * treasury_approvals / treasury_seats directly and applies the same
 * definitions approvals.ts uses:
 *   pending   status "pending", not claimed (decidedAt null), not past its TTL
 *   my vote   I am in the electorate the rules in force were adopted with and
 *             hold a seat in the room (canApprove in treasuryStatus)
 */

export interface TreasurySummaryRoom {
  roomId: string;
  roomName: string;
  /** the pot if cheaply known; null here, since the only cache of it is private to wallet.ts */
  balanceUsd: number | null;
  /** pending requests in the room */
  pendingTotal: number;
  /** pending requests I may approve and have not */
  pendingForMe: number;
  recurring: null | {
    state: "live" | "pending";
    weeklyUsd: number;
    weeks: number;
    weekIndex?: number;
    nextRunAt?: string | null;
    boughtThisWeek?: boolean;
  };
  /** the newest treasury action, as one short English line */
  latest: null | { at: string; line: string };
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Approvable right now — the same test treasuryStatus applies before offering "Approve". */
function isOpen(a: Pick<TreasuryAction, "status" | "decidedAt" | "createdAt">, now: number): boolean {
  return a.status === "pending" && a.decidedAt === null && a.createdAt.getTime() + REQUEST_TTL_MS >= now;
}

/** One line for a treasury action row, whatever its kind and state. */
export function describeTreasuryAction(a: TreasuryAction, now: number): string {
  if (a.kind === RECURRING_RUN_KIND) {
    const run = parseRun(a.ruleText);
    if (!run) return "Recurring buy run";
    return run.outcome === "bought"
      ? `Bought ${usd(a.amountUsd)} of ETH (${run.isoWeek})`
      : `Skipped the recurring buy (${run.isoWeek})`;
  }
  if (a.kind === RECURRING_BUY_KIND) {
    const record = parseAuthority(a.ruleText);
    const terms = record ? ` · ${usd(record.terms.weeklyUsd)} weekly for ${record.terms.weeks} weeks` : "";
    if (a.status === "executed") return `${record?.revokedAt ? "Recurring buy stopped" : "Recurring buy adopted"}${terms}`;
    if (isOpen(a, now)) return `Recurring buy waiting for approval${terms}`;
    if (a.status === "pending" && a.decidedAt === null) return `Recurring buy expired${terms}`;
    return `Recurring buy not adopted${terms}`;
  }
  if (a.kind === RATIFY_KIND) {
    if (a.status === "executed") return "Treasury rules adopted";
    if (isOpen(a, now)) return "Rules change waiting for approval";
    return "Rules change not adopted";
  }
  const what = `${usd(a.amountUsd)}${a.memo ? ` · ${a.memo}` : ""}`;
  if (isOpen(a, now)) return `Waiting for approval: ${what}`;
  switch (a.status) {
    case "executed":
      return a.kind === "investment" ? `Invested ${what}` : `Paid ${what}`;
    case "unconfirmed":
      return `Sent, not confirmed yet: ${what}`;
    case "blocked":
      return `Refused: ${what}`;
    case "cancelled":
      return `Expired: ${what}`;
    case "pending":
      return a.decidedAt ? `Sending: ${what}` : `Expired: ${what}`;
    default:
      return `Failed: ${what}`;
  }
}

async function recurringOf(roomId: string): Promise<TreasurySummaryRoom["recurring"]> {
  try {
    const status = await recurringBuyStatus(roomId);
    if (status?.live) {
      const l = status.live;
      return {
        state: "live",
        weeklyUsd: l.weeklyUsd,
        weeks: l.weeks,
        weekIndex: l.weekIndex,
        nextRunAt: l.nextRunAt,
        boughtThisWeek: l.thisWeek === "bought",
      };
    }
    if (status?.pending) return { state: "pending", weeklyUsd: status.pending.weeklyUsd, weeks: status.pending.weeks };
    return null;
  } catch (err) {
    console.error("treasury summary: recurring status unavailable:", err);
    return null;
  }
}

/** Every relation the viewer is a human member of whose agent holds a treasury (Rules in its doc). */
export async function treasurySummary(viewerId: string, now = Date.now()): Promise<TreasurySummaryRoom[]> {
  const [viewer] = await db.select({ isAgent: users.isAgent }).from(users).where(eq(users.id, viewerId)).limit(1);
  if (!viewer || viewer.isAgent) return [];

  const memberOf = await db
    .select({ roomId: chatRooms.id, name: chatRooms.name })
    .from(chatRoomMembers)
    .innerJoin(chatRooms, eq(chatRooms.id, chatRoomMembers.roomId))
    .where(eq(chatRoomMembers.userId, viewerId));
  if (!memberOf.length) return [];

  // a treasury needs the room's agent: rooms without one are skipped before any doc read
  const botRooms = new Set(
    (
      await db
        .select({ roomId: chatRoomBots.roomId })
        .from(chatRoomBots)
        .innerJoin(users, eq(users.id, chatRoomBots.agentUserId))
        .where(and(inArray(chatRoomBots.roomId, memberOf.map((r) => r.roomId)), eq(users.isAgent, true)))
    ).map((r) => r.roomId)
  );
  const candidates = memberOf.filter((r) => botRooms.has(r.roomId));
  const treasuries = await Promise.all(candidates.map((r) => loadRelationTreasury(r.roomId)));
  const rooms = candidates
    .map((r, i) => ({ ...r, treasury: treasuries[i] }))
    .filter((r): r is typeof r & { treasury: NonNullable<typeof r.treasury> } => r.treasury !== null);
  if (!rooms.length) return [];
  const roomIds = rooms.map((r) => r.roomId);

  const [pendingRows, mySeats] = await Promise.all([
    db
      .select({
        id: treasuryActions.id,
        roomId: treasuryActions.roomId,
        status: treasuryActions.status,
        decidedAt: treasuryActions.decidedAt,
        createdAt: treasuryActions.createdAt,
      })
      .from(treasuryActions)
      .where(
        and(inArray(treasuryActions.roomId, roomIds), eq(treasuryActions.status, "pending"), isNull(treasuryActions.decidedAt))
      ),
    db
      .select({ roomId: treasurySeats.roomId })
      .from(treasurySeats)
      .where(and(inArray(treasurySeats.roomId, roomIds), eq(treasurySeats.userId, viewerId))),
  ]);
  const open = pendingRows.filter((a) => isOpen(a, now));
  const approvedByMe = new Set(
    open.length
      ? (
          await db
            .select({ actionId: treasuryApprovals.actionId })
            .from(treasuryApprovals)
            .where(and(inArray(treasuryApprovals.actionId, open.map((a) => a.id)), eq(treasuryApprovals.userId, viewerId)))
        ).map((r) => r.actionId)
      : []
  );
  const seatedIn = new Set(mySeats.map((s) => s.roomId));

  return Promise.all(
    rooms.map(async (r): Promise<TreasurySummaryRoom> => {
      const [latestRow, recurring] = await Promise.all([
        db
          .select()
          .from(treasuryActions)
          .where(eq(treasuryActions.roomId, r.roomId))
          .orderBy(desc(treasuryActions.createdAt))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        recurringOf(r.roomId),
      ]);
      const roomOpen = open.filter((a) => a.roomId === r.roomId);
      const iVote = seatedIn.has(r.roomId) && r.treasury.electorate.includes(viewerId);
      return {
        roomId: r.roomId,
        roomName: r.name,
        balanceUsd: null,
        pendingTotal: roomOpen.length,
        pendingForMe: iVote ? roomOpen.filter((a) => !approvedByMe.has(a.id)).length : 0,
        recurring,
        latest: latestRow
          ? { at: (latestRow.decidedAt ?? latestRow.createdAt).toISOString(), line: describeTreasuryAction(latestRow, now) }
          : null,
      };
    })
  );
}
