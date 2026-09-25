import "server-only";
import { and, asc, countDistinct, desc, eq, inArray, isNull } from "drizzle-orm";
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
import { idpMode } from "@/lib/auth/world";
import { appendTreasuryActivity, loadRelationTreasury } from "./memory";
import { USD_PER_ETH, ensureAgentWallet, transferUsd, treasuryBalance } from "./wallet";
import {
  TREASURY_SEAT_ACTION,
  type ApprovalResult,
  type SeatResult,
  type TreasuryKind,
  type TreasuryStatus,
} from "./types";

/**
 * Treasury actions, seats and approvals — the database half of the treasury.
 *
 * Who counts is decided here and only here: a seat is one IDKit nullifier per
 * room, an approval is one World ID pairwise `sub` per action, and quorum is a
 * COUNT(DISTINCT approver_key) in SQL. Execution is claimed by a conditional
 * UPDATE, so concurrent approvals that both reach quorum pay exactly once.
 */

/** An approval proof may not predate the request (small allowance for clock skew). */
const FRESHNESS_SKEW_MS = 5_000;

const MSG = {
  seatSameHuman: "This human already holds a seat in this relation — one human, one seat.",
  notMember: "Only members of this relation can do that.",
  notFound: "That treasury request no longer exists.",
  notPending: "This request has already been decided.",
  notSeated: "Claim your seat first — prove you're a unique human.",
  stale: "That World ID verification predates this request — approvals must be fresh.",
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

async function distinctApprovers(actionId: string): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(treasuryApprovals.approverKey) })
    .from(treasuryApprovals)
    .where(eq(treasuryApprovals.actionId, actionId));
  return Number(row?.n ?? 0);
}

async function approverNames(actionId: string): Promise<string[]> {
  const rows = await db
    .select({ name: users.displayName })
    .from(treasuryApprovals)
    .innerJoin(users, eq(users.id, treasuryApprovals.userId))
    .where(eq(treasuryApprovals.actionId, actionId))
    .orderBy(asc(treasuryApprovals.createdAt));
  return rows.map((r) => r.name);
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

// ── actions ─────────────────────────────────────────────────────────────────

export async function createTreasuryAction(input: {
  roomId: string;
  agentUserId: string;
  requestedBy: string;
  kind: TreasuryKind;
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
      await notifyConsent({
        recipientIds: seated.map((s) => s.userId),
        actorId: input.requestedBy, // notifyConsent skips the actor — the requester is not pinged
        roomId: input.roomId,
        body: `Treasury: approve ${usd(input.amountUsd)} · ${input.memo} (needs ${plural(input.requiredApprovals, "verified human")})`,
      });
    } catch (err) {
      console.error("treasury: approval notifications failed:", err);
    }
  }
  return action;
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

type BindResult = null | { kind: "sub-taken"; holderId: string | null } | { kind: "sub-mismatch" };

/** account ↔ human: an account is bound to one World ID sub, a sub to one account. */
async function bindWorldSub(userId: string, sub: string): Promise<BindResult> {
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

/**
 * An approval arriving from a validated World ID for Agents step-up. `sub`,
 * `authTime` and `issuedAt` come from the ID token the server itself verified
 * (never the client); `userId` is the session's account.
 */
export async function recordIdpApproval(input: {
  actionId: string;
  userId: string;
  sub: string;
  authTime: number | null;
  issuedAt: number | null;
}): Promise<ApprovalResult> {
  const [action] = await db
    .select()
    .from(treasuryActions)
    .where(eq(treasuryActions.id, input.actionId))
    .limit(1);
  if (!action) return { ok: false, reason: "not-found", message: MSG.notFound };
  if (action.status !== "pending" || action.decidedAt)
    return { ok: false, reason: "not-pending", message: MSG.notPending };
  if (!(await isHumanMember(action.roomId, input.userId)))
    return { ok: false, reason: "not-member", message: MSG.notMember };

  const [seat] = await db
    .select({ id: treasurySeats.id })
    .from(treasurySeats)
    .where(and(eq(treasurySeats.roomId, action.roomId), eq(treasurySeats.userId, input.userId)))
    .limit(1);
  if (!seat) return { ok: false, reason: "not-seated", message: MSG.notSeated };

  // fail-closed: a token without auth_time or iat cannot prove freshness
  const provedAt = input.authTime ?? input.issuedAt;
  if (provedAt === null || provedAt * 1000 < action.createdAt.getTime() - FRESHNESS_SKEW_MS)
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
    return { ok: false, reason: "same-human", message: MSG.subMismatch };
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

  const counted = await distinctApprovers(action.id);
  await postAgentMessage(
    action.roomId,
    action.agentUserId,
    `✅ ${await displayName(input.userId)} approved with World ID — ${Math.min(counted, action.requiredApprovals)} of ${action.requiredApprovals}`
  );

  const result = await executeIfQuorum(action.id);
  return {
    ok: true,
    approvals: result.approvals,
    required: result.required,
    executed: result.executed,
    txHash: result.txHash ?? null,
  };
}

// ── execution ───────────────────────────────────────────────────────────────

/** Who the money went to, as the relation names it. */
async function recipientLabel(action: TreasuryAction): Promise<string> {
  const addr = action.recipientAddress?.toLowerCase();
  if (addr) {
    const treasury = await loadRelationTreasury(action.roomId).catch(() => null);
    const payee = treasury?.payees.find((p) => p.address.toLowerCase() === addr);
    if (payee) return payee.name;
  }
  if (action.recipientUserId) return displayName(action.recipientUserId);
  if (action.recipientAddress) return `${action.recipientAddress.slice(0, 6)}…${action.recipientAddress.slice(-4)}`;
  return action.memo || "the recipient";
}

const MEMO_FILLER = new Set(["the", "a", "an", "our", "to", "for", "of", "at"]);

function errorText(err: unknown): string {
  const e = err as { shortMessage?: unknown; message?: unknown };
  const text =
    typeof e?.shortMessage === "string" ? e.shortMessage : typeof e?.message === "string" ? e.message : String(err);
  return text.split("\n")[0].slice(0, 300);
}

/**
 * Pays out once DISTINCT approvers reach the action's bar (or at once when the
 * bar is 0). Safe to call from any number of concurrent approvals: only the
 * caller whose UPDATE claims the pending row sends money.
 *
 * `executed` means THIS call moved the money. The chat announcement is posted
 * only for quorum-approved actions (required > 0); an auto action is executed
 * by the skill, which answers in chat itself. The activity line is always kept.
 */
export async function executeIfQuorum(actionId: string): Promise<{
  executed: boolean;
  txHash?: string | null;
  approvals: number;
  required: number;
  error?: string;
}> {
  const [action] = await db.select().from(treasuryActions).where(eq(treasuryActions.id, actionId)).limit(1);
  if (!action) return { executed: false, approvals: 0, required: 0, error: "not-found" };

  const approvals = await distinctApprovers(actionId);
  const required = action.requiredApprovals;
  if (action.status !== "pending" || action.decidedAt)
    return { executed: false, txHash: action.txHash, approvals, required };
  if (approvals < required) return { executed: false, approvals, required };

  const [claimed] = await db
    .update(treasuryActions)
    .set({ decidedAt: new Date() })
    .where(
      and(eq(treasuryActions.id, actionId), eq(treasuryActions.status, "pending"), isNull(treasuryActions.decidedAt))
    )
    .returning();
  if (!claimed) return { executed: false, approvals, required };

  let txHash: `0x${string}` | null = null;
  let error: string | null = null;
  const to = claimed.recipientAddress;
  if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
    error = "This request has no valid recipient address.";
  } else {
    try {
      ({ txHash } = await transferUsd(claimed.agentUserId, to as `0x${string}`, claimed.amountUsd));
    } catch (err) {
      error = errorText(err);
    }
  }

  await db
    .update(treasuryActions)
    .set(txHash ? { status: "executed", txHash } : { status: "failed", error })
    .where(eq(treasuryActions.id, actionId));

  const label = await recipientLabel(claimed);
  const amount = usd(claimed.amountUsd);
  // "(hotel deposit)" adds something; "(hotel)" next to "Hotel Gracery Shinjuku" does not
  const named = new Set(label.toLowerCase().split(/[^a-z0-9]+/));
  const adds = claimed.memo
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((w) => w && !named.has(w) && !MEMO_FILLER.has(w));
  const what = adds ? ` (${claimed.memo})` : "";
  const names = await approverNames(actionId);
  const approvedBy =
    required > 0 ? `approved by ${names.join(", ")} (${approvals} of ${plural(required, "verified human")})` : "";

  if (txHash) {
    if (required > 0)
      await postAgentMessage(
        claimed.roomId,
        claimed.agentUserId,
        `✅ Paid ${amount} to ${label}${what} — ${approvedBy}. tx ${txHash}`
      );
    try {
      await appendTreasuryActivity(claimed.roomId, [
        `Paid ${amount} to ${label}${what} — ${required > 0 ? approvedBy : "within what the agent may pay on its own"} — tx ${txHash}`,
      ]);
    } catch (err) {
      console.error("treasury: activity append failed:", err);
    }
    return { executed: true, txHash, approvals, required };
  }

  if (required > 0)
    await postAgentMessage(
      claimed.roomId,
      claimed.agentUserId,
      `⚠️ Could not pay ${amount} to ${label}${what}: ${(error ?? "transfer failed").replace(/\.?$/, ".")} It's marked failed in the treasury panel.`
    );
  return { executed: false, approvals, required, error: error ?? "transfer failed" };
}

// ── status (the panel) ──────────────────────────────────────────────────────

const STATUSES = new Set(["pending", "executed", "blocked", "failed", "cancelled"]);

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
      balance = await treasuryBalance(address as `0x${string}`);
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

  const actionRows = await db
    .select()
    .from(treasuryActions)
    .where(eq(treasuryActions.roomId, roomId))
    .orderBy(desc(treasuryActions.createdAt))
    .limit(20);
  const actionIds = actionRows.map((a) => a.id);
  const approvalRows = actionIds.length
    ? await db
        .select({
          actionId: treasuryApprovals.actionId,
          userId: treasuryApprovals.userId,
          displayName: users.displayName,
          at: treasuryApprovals.createdAt,
        })
        .from(treasuryApprovals)
        .innerJoin(users, eq(users.id, treasuryApprovals.userId))
        .where(inArray(treasuryApprovals.actionId, actionIds))
        .orderBy(asc(treasuryApprovals.createdAt))
    : [];
  const approvalsBy = new Map<string, { userId: string; displayName: string; at: string }[]>();
  for (const r of approvalRows) {
    const list = approvalsBy.get(r.actionId) ?? [];
    list.push({ userId: r.userId, displayName: r.displayName, at: r.at.toISOString() });
    approvalsBy.set(r.actionId, list);
  }

  const nameBy = new Map(memberRows.map((m) => [m.userId, m.displayName]));
  const missing = [...new Set(actionRows.map((a) => a.requestedBy))].filter((id) => !nameBy.has(id));
  if (missing.length) {
    const rows = await db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, missing));
    for (const r of rows) nameBy.set(r.id, r.name);
  }

  return {
    enabled: treasury !== null,
    address,
    balanceUsd: balance?.usd ?? null,
    balanceEth: balance?.eth ?? null,
    usdPerEth: USD_PER_ETH,
    purpose: treasury?.purpose ?? "",
    rulesPageId: treasury?.rulesPageId ?? null,
    rules: treasury?.policy.rules.map((r) => r.text) ?? [],
    members: memberRows.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      seated: seatBy.has(m.userId),
      seatLevel: seatBy.get(m.userId) ?? null,
      worldVerified: m.worldSub !== null,
    })),
    mySeated,
    actions: actionRows.map((a) => {
      const approvals = approvalsBy.get(a.id) ?? [];
      const status = (STATUSES.has(a.status) ? a.status : "failed") as TreasuryStatus["actions"][number]["status"];
      return {
        id: a.id,
        kind: a.kind as TreasuryKind,
        amountUsd: a.amountUsd,
        memo: a.memo,
        status,
        requiredApprovals: a.requiredApprovals,
        ruleText: a.ruleText,
        requestedBy: { userId: a.requestedBy, displayName: nameBy.get(a.requestedBy) ?? "Unknown" },
        approvals,
        txHash: a.txHash,
        error: a.error,
        createdAt: a.createdAt.toISOString(),
        canApprove:
          status === "pending" && a.decidedAt === null && mySeated && !approvals.some((x) => x.userId === viewerId),
      };
    }),
    seatMode:
      worldIdConfigured() && worldIdRpContext() && process.env.NEXT_PUBLIC_WORLD_ID_APP_ID ? "world-id" : "dev-simulator",
    seatAction: TREASURY_SEAT_ACTION,
    rpContext: worldIdRpContext(),
    idpMode: idpMode(),
  };
}
