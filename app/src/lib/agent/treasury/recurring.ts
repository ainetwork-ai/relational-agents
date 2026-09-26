import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { formatUnits } from "viem";
import { db } from "@/lib/db";
import { chatRoomBots, treasuryActions, treasuryApprovals, users } from "@/lib/db/schema";
import { createTreasuryAction, txLink, voters } from "./approvals";
import { INVEST_CHAIN, investConfig, investViaUniswap, investedPosition, usdcForUsd, type InvestResult } from "./invest";
import { appendTreasuryActivity, humanMemberIds, latestAdoption, loadRelationTreasury } from "./memory";
import { ROUTE_WORDS, type SwapRoute } from "./swap-route";
import { failureMarks, type FailureMarks } from "./uniswap-api";
import { evaluateCommand } from "./policy";
import {
  decideRun,
  exposureUsd,
  isoWeekKey,
  nextWeekStart,
  parseAuthority,
  parseRun,
  SKIP_REASON_TEXT,
  relationDay,
  termsDigest,
  validateTerms,
  weekStart,
  windowFor,
  type RecurringBuyRecord,
  type RecurringBuyTerms,
  type RecurringRunRecord,
  type RecurringSkipReason,
} from "./recurring-record";
import {
  RECURRING_BUY_KIND,
  RECURRING_RUN_KIND,
  REQUEST_TTL_MS,
  type RecurringBuyStatus,
  type TreasuryPolicy,
} from "./types";
import { ensureAgentWallet, treasuryBalance } from "./wallet";

/**
 * Recurring buy — the database and chain half (the rules themselves are in
 * recurring-record.ts).
 *
 * A relation adopts ONE standing authority by quorum, through the same
 * request → World ID approvals → executeIfQuorum flow as any treasury action
 * (approvals.ts adopts it; it never pays itself). Afterwards a run buys at
 * most once a week (the relation's week, recurring-record.ts) inside the approved terms by calling
 * investViaUniswap — the swap an approved investment makes — and leaves one
 * history row, bought or skipped.
 *
 * Real money moves only when investing is configured AND
 * TREASURY_RECURRING_REAL=1; otherwise a run is a rehearsal that decides the
 * same way and writes nothing. Runs of one room hold a Postgres advisory lock
 * and re-read the history after taking it, so two asks in the same week can't
 * both buy. What reaches chat, docs and rows is fixed text: viem's errors can
 * carry the RPC URL, so they only reach the server log, as one masked line.
 */

const WEEK_MS = 7 * 86_400_000;
const HISTORY_MAX = 26;
/** a run nobody asked for; its skips are not recorded */
const SCHEDULE = "schedule";
/** investViaUniswap's refusal when the Base wallet is short (invest.ts) */
const INSUFFICIENT_USDC = /USDC, less than the .* this investment needs/;
const TX_HASH = /\b0x[0-9a-fA-F]{64}\b/;

/** A request the asker may not make. `message` is a fixed English sentence, safe to show as is. */
export class RecurringBuyRefusal extends Error {}

// ── formatting ──────────────────────────────────────────────────────────────

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const isoAt = (ms: number) => new Date(ms).toISOString();
const unixS = (d: Date) => Math.floor(d.getTime() / 1000);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "$20 of ETH weekly for 26 weeks" */
export function termsPhrase(terms: Pick<RecurringBuyTerms, "weeklyUsd" | "weeks">): string {
  return `${usd(terms.weeklyUsd)} of ETH weekly for ${plural(terms.weeks, "week")}`;
}

/** "0.00003721" — WETH as chat says it: four significant digits */
export function wethShort(whole: string): string {
  return Number(whole).toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

/**
 * What the room reads above a queued recurring buy: one line — the card
 * posted under it carries the terms, the route and the Approve button. The
 * chat command and the treasurer post it. `askedBy` names the member the
 * agent posts for.
 */
export function queuedLines(input: { record: RecurringBuyRecord; required: number; rule: string; askedBy?: string }): string[] {
  return [`Queued${input.askedBy ? ` at ${input.askedBy}'s request` : ""}: a recurring buy — needs ${plural(input.required, "verified human")}.`];
}

/** The room's one-line receipt after a real weekly buy; the explorer link is drawn short in chat. */
export function boughtLine(run: { weeklyUsd: number; wethOut: string; txHash: string; route: SwapRoute }, askedBy?: string): string {
  return `Bought this week's ETH${askedBy ? ` at ${askedBy}'s request` : ""}: ${usd(run.weeklyUsd)} → ${wethShort(run.wethOut)} WETH · ${ROUTE_WORDS[run.route]} · tx ${INVEST_CHAIN.explorer}/tx/${run.txHash}`;
}

/** "0x1a2b3c4d…9f0e" — the terms' fingerprint as approvers and members see it */
export function digestShort(digest: string): string {
  return `${digest.slice(0, 10)}…${digest.slice(-4)}`;
}

/** An error as one line for the server log: viem's shortMessage (the RPC URL is in its details), URLs masked anyway. */
export function logLine(err: unknown): string {
  const e = err as { shortMessage?: unknown; message?: unknown } | null;
  const text =
    typeof e?.shortMessage === "string" ? e.shortMessage : typeof e?.message === "string" ? e.message : String(err);
  return text.split("\n")[0].replace(/https?:\/\/\S+/g, "<url>").slice(0, 160);
}

// ── the record, as stored ───────────────────────────────────────────────────

/** Real buys: investing configured (TREASURY_INVEST=uniswap-base) and TREASURY_RECURRING_REAL=1. */
export function realRunsEnabled(): boolean {
  return investConfig() !== null && process.env.TREASURY_RECURRING_REAL === "1";
}

/** The most the authority can spend, from the terms its digest covers — never the stored exposureUsd, which it doesn't. */
export function authorityExposure(record: RecurringBuyRecord): number {
  return exposureUsd(record.terms.weeklyUsd, record.terms.weeks);
}

/** The stored authority, only while its terms still hash to the digest the approvers were shown. */
export function verifiedAuthority(ruleText: string): RecurringBuyRecord | null {
  const record = parseAuthority(ruleText);
  return record && termsDigest(record.terms) === record.digest.toLowerCase() ? record : null;
}

/** The rule line behind an authority row, for lists that would otherwise print its rule_text (JSON). */
export function authorityRule(ruleText: string): string {
  return parseAuthority(ruleText)?.rule ?? "";
}

/** What the approval page shows for a recurring buy — never the stored JSON. */
export interface RecurringBuyCardTerms {
  weeklyUsd: number;
  weeks: number;
  exposureUsd: number;
  /** the wallet that signs every buy, and its page on the Base explorer */
  agentAddress: string;
  agentAddressUrl: string;
  digestShort: string;
  rule: string;
  startsAt: string;
  expiresAt: string;
}

/** null when the terms don't read or no longer match their digest — such a request can't be approved. */
export function recurringCardTerms(ruleText: string): RecurringBuyCardTerms | null {
  const record = verifiedAuthority(ruleText);
  if (!record) return null;
  const { terms } = record;
  return {
    weeklyUsd: terms.weeklyUsd,
    weeks: terms.weeks,
    exposureUsd: authorityExposure(record),
    agentAddress: terms.agentAddress,
    agentAddressUrl: `${INVEST_CHAIN.explorer}/address/${terms.agentAddress}`,
    digestShort: digestShort(record.digest),
    rule: record.rule,
    startsAt: isoAt(terms.startsAt * 1000),
    expiresAt: isoAt(terms.expiresAt * 1000),
  };
}

export type AuthorityVerdict =
  | { kind: "allowed" }
  /** `rule` is the line that forbids it; null when the rules can't be read (see `why`) */
  | { kind: "forbidden"; rule: string | null; why: string }
  | { kind: "insufficient"; balanceUsd: number }
  /** allowed only with more approvals than it has */
  | { kind: "raise"; required: number; rule: string };

/**
 * The authority judged as it was asked: an investment of its whole exposure,
 * against `policy`. Only ever tighter than before — `approvals` are the ones
 * it already has, and a bar they meet is met.
 */
export function judgeAuthority(input: {
  record: RecurringBuyRecord;
  policy: TreasuryPolicy;
  balanceUsd: number;
  approvals: number;
}): AuthorityVerdict {
  const decision = evaluateCommand({
    policy: input.policy,
    kind: "investment",
    amountUsd: authorityExposure(input.record),
    personal: false,
    balanceUsd: input.balanceUsd,
  });
  if (decision.outcome === "forbidden")
    return {
      kind: "forbidden",
      rule: decision.rule?.text ?? null,
      why: decision.rule ? `our rules now say “${decision.rule.text}”` : decision.reason,
    };
  if (decision.outcome === "insufficient") return { kind: "insufficient", balanceUsd: decision.balanceUsd };
  if (decision.outcome === "approval" && decision.required > input.approvals)
    return { kind: "raise", required: decision.required, rule: decision.rule.text };
  return { kind: "allowed" };
}

// ── reading the room ────────────────────────────────────────────────────────

export interface RecurringBuyAuthority {
  actionId: string;
  status: string;
  record: RecurringBuyRecord;
  /** a pending request: the approvals that count now; a decided one: who approved it */
  approvedBy: string[];
  /** distinct humans behind approvedBy */
  approvals: number;
  required: number;
  createdAt: Date;
  decidedAt: Date | null;
}

async function displayName(userId: string): Promise<string> {
  const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.name ?? "A member";
}

/** Who votes: the members at the adoption in force, or the members now if nothing was adopted (as loadRelationTreasury says). */
async function electorate(roomId: string): Promise<string[]> {
  return (await latestAdoption(roomId))?.text.members ?? humanMemberIds(roomId);
}

/**
 * Every recurring buy the room asked for, newest request first. A row whose
 * record doesn't read, or names another room or agent than the row it sits
 * in, is left out: it authorises nothing.
 */
export async function roomRecurringBuys(roomId: string): Promise<RecurringBuyAuthority[]> {
  const rows = await db
    .select()
    .from(treasuryActions)
    .where(and(eq(treasuryActions.roomId, roomId), eq(treasuryActions.kind, RECURRING_BUY_KIND)))
    .orderBy(desc(treasuryActions.createdAt));
  const read = rows.flatMap((row) => {
    const record = parseAuthority(row.ruleText);
    return record && record.terms.roomId === row.roomId && record.terms.agentUserId === row.agentUserId
      ? [{ row, record }]
      : [];
  });
  if (!read.length) return [];

  const approvalRows = await db
    .select({
      actionId: treasuryApprovals.actionId,
      userId: treasuryApprovals.userId,
      approverKey: treasuryApprovals.approverKey,
      name: users.displayName,
    })
    .from(treasuryApprovals)
    .innerJoin(users, eq(users.id, treasuryApprovals.userId))
    .where(inArray(treasuryApprovals.actionId, read.map((r) => r.row.id)))
    .orderBy(asc(treasuryApprovals.createdAt));
  // whose approval counts is approvals.ts's call, and only a waiting request needs it
  const eligible = read.some((r) => r.row.status === "pending")
    ? await voters(roomId, await electorate(roomId))
    : new Set<string>();

  return read.map(({ row, record }) => {
    const counted = approvalRows.filter(
      (a) => a.actionId === row.id && (row.status !== "pending" || eligible.has(a.userId))
    );
    return {
      actionId: row.id,
      status: row.status,
      record,
      approvedBy: counted.map((a) => a.name),
      approvals: new Set(counted.map((a) => a.approverKey)).size,
      required: row.requiredApprovals,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    };
  });
}

function isLive(a: RecurringBuyAuthority, now: Date): boolean {
  return a.status === "executed" && a.record.revokedAt === undefined && now.getTime() < a.record.terms.expiresAt * 1000;
}

/** Waiting for approvals and not lapsed (approvals.ts sweeps a lapsed one on the panel's next poll). */
function isOpenRequest(a: RecurringBuyAuthority, now: Date): boolean {
  return a.status === "pending" && !(a.decidedAt === null && a.createdAt.getTime() + REQUEST_TTL_MS < now.getTime());
}

/** The latest adoption among `list` — by claim time, as memory.ts orders ratifications. */
function newestAdopted(list: RecurringBuyAuthority[]): RecurringBuyAuthority | null {
  return [...list].sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0] ?? null;
}

/** The authority in force: adopted, not stopped or superseded, its window not over. */
export async function liveRecurringBuy(roomId: string, now = new Date()): Promise<RecurringBuyAuthority | null> {
  return newestAdopted((await roomRecurringBuys(roomId)).filter((a) => isLive(a, now)));
}

/** The room's recorded runs, newest first. */
async function roomRuns(roomId: string): Promise<RecurringRunRecord[]> {
  const rows = await db
    .select({ ruleText: treasuryActions.ruleText })
    .from(treasuryActions)
    .where(and(eq(treasuryActions.roomId, roomId), eq(treasuryActions.kind, RECURRING_RUN_KIND)))
    .orderBy(desc(treasuryActions.createdAt));
  return rows.flatMap((r) => parseRun(r.ruleText) ?? []);
}

/**
 * Do the rules in force now still allow this authority with the approvals it
 * got? Judged as at adoption, except that a pot now smaller than the exposure
 * is judged as holding exactly the exposure: evaluateCommand would stop at
 * "insufficient" and never say which bar applies, and at a 100% share every
 * share rule applies — never a lower bar than the real share would set.
 * Throws when the pot can't be read; a run then does nothing.
 */
export async function rulesStillAllow(roomId: string, record: RecurringBuyRecord, approvalsGot: number): Promise<boolean> {
  const treasury = await loadRelationTreasury(roomId);
  if (!treasury?.adoptedAt) return false;
  const pot = (await treasuryBalance((await ensureAgentWallet(record.terms.agentUserId)).address)).usd;
  const balanceUsd = Math.max(pot, authorityExposure(record));
  return judgeAuthority({ record, policy: treasury.policy, balanceUsd, approvals: approvalsGot }).kind === "allowed";
}

/** The swap would go where the approvers were told: the same chain, signed by the key behind the address they saw. */
async function executesAsApproved(record: RecurringBuyRecord): Promise<boolean> {
  if (INVEST_CHAIN.chainId !== record.terms.chainId) return false;
  const { address } = await ensureAgentWallet(record.terms.agentUserId);
  return address.toLowerCase() === record.terms.agentAddress.toLowerCase();
}

// ── writing ─────────────────────────────────────────────────────────────────

function logActivity(roomId: string, line: string): Promise<void> {
  return appendTreasuryActivity(roomId, [line]).catch((err: unknown) =>
    console.error("recurring: activity append failed:", err)
  );
}

/**
 * Runs `fn` holding the room's recurring-buy lock: a transaction-scoped
 * advisory lock, so it spans processes and is released with a dead one. The
 * transaction only scopes the lock — what `fn` writes commits on its own, so
 * a history row never depends on the lock's connection outliving a swap.
 */
async function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const box: { done: boolean; value?: T } = { done: false };
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recurring:${roomId}`}))`);
      box.value = await fn();
      box.done = true;
    });
  } catch (err) {
    if (!box.done) throw err;
    // fn finished and recorded what it did; only the lock's release failed, and it goes with its connection
    console.error(`recurring: releasing the lock of room ${roomId} failed:`, logLine(err));
  }
  return box.value as T;
}

/**
 * One history row, inserted once and already executed. Retried like
 * approvals.ts settle(): after a buy this row is what keeps a second buy out
 * of the same week. Never throws — the chain has done what it did either way;
 * a row that can't be written is logged with its hash.
 */
async function recordRun(authority: RecurringBuyAuthority, run: RecurringRunRecord, now: Date): Promise<void> {
  const { terms } = authority.record;
  const bought = run.outcome === "bought";
  const memo = bought
    ? `bought ${usd(terms.weeklyUsd)} of ETH · ${run.isoWeek}`
    : `skipped ${run.isoWeek} · ${SKIP_REASON_TEXT[run.reason ?? "swap-failed"]}`;
  for (let attempt = 1; ; attempt++) {
    try {
      await db.insert(treasuryActions).values({
        roomId: terms.roomId,
        agentUserId: terms.agentUserId,
        // requested_by is a user: a scheduled run is the agent's own
        requestedBy: run.by === SCHEDULE ? terms.agentUserId : run.by,
        kind: RECURRING_RUN_KIND,
        amountUsd: bought ? terms.weeklyUsd : 0,
        memo,
        ruleText: JSON.stringify(run),
        requiredApprovals: 0,
        status: "executed",
        txHash: run.txHash ?? null,
        createdAt: now,
        decidedAt: now,
      });
      return;
    } catch (err) {
      if (attempt >= 3) {
        console.error(
          `recurring: could not record the ${run.isoWeek} run of ${authority.actionId}${run.txHash ? ` (SENT, tx ${run.txHash})` : ""}: ${logLine(err)}`
        );
        return;
      }
      await sleep(attempt * 1_000);
    }
  }
}

/**
 * Writes a revocation into an authority's record unless one is already there
 * — a compare-and-set on the stored text, so the first stop wins. True when
 * this call wrote it.
 */
async function revoke(
  actionId: string,
  mark: { revokedAt: number; revokedReason: "stopped" | "superseded"; revokedBy?: string }
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .select({ ruleText: treasuryActions.ruleText })
      .from(treasuryActions)
      .where(eq(treasuryActions.id, actionId))
      .limit(1);
    const record = row ? parseAuthority(row.ruleText) : null;
    if (!row || !record || record.revokedAt !== undefined) return false;
    const [done] = await db
      .update(treasuryActions)
      .set({ ruleText: JSON.stringify({ ...record, ...mark }) })
      .where(and(eq(treasuryActions.id, actionId), eq(treasuryActions.ruleText, row.ruleText)))
      .returning({ id: treasuryActions.id });
    if (done) return true;
  }
  return false;
}

// ── propose ─────────────────────────────────────────────────────────────────

export type ProposeResult =
  | { ok: true; actionId: string; required: number; rule: string; record: RecurringBuyRecord }
  | { ok: false; reason: string };

/**
 * Queues a recurring buy for approval — the one way an authority comes to
 * exist. What the approvers are shown is fixed here, on the server: the
 * agent's address comes from its key, chain and pair are constants, and the
 * window starts this ISO week. The bar is what an investment of the whole
 * exposure needs now, and never "the agent may do it alone": a standing
 * authority is not something the agent grants itself. Appends the request's
 * Treasury Activity line; the caller only answers the asker.
 */
export async function proposeRecurringBuy(input: {
  roomId: string;
  agentUserId: string;
  requesterId: string;
  weeklyUsd: number;
  weeks: number;
  now?: Date;
}): Promise<ProposeResult> {
  const now = input.now ?? new Date();
  const valid = validateTerms({ weeklyUsd: input.weeklyUsd, weeks: input.weeks });
  if (!valid.ok) return { ok: false, reason: `${valid.reason} Nothing was queued.` };

  const treasury = await loadRelationTreasury(input.roomId);
  if (!treasury) return { ok: false, reason: "This room has no treasury — nothing was queued." };
  if (!(await humanMemberIds(input.roomId)).includes(input.requesterId))
    return { ok: false, reason: "Only members of this room can use its treasury — nothing was queued." };
  if (!treasury.adoptedAt)
    return { ok: false, reason: "Our Treasury Rules were never adopted, so I move no money yet — nothing was queued." };
  if (!treasury.electorate.includes(input.requesterId))
    return {
      ok: false,
      reason: "You joined after our rules were adopted, so you can't direct the treasury yet — nothing was queued.",
    };
  // the wallet named in the terms is the room's own agent's, whoever calls this
  const [bot] = await db
    .select({ id: chatRoomBots.agentUserId })
    .from(chatRoomBots)
    .where(and(eq(chatRoomBots.roomId, input.roomId), eq(chatRoomBots.agentUserId, input.agentUserId)))
    .limit(1);
  if (!bot) return { ok: false, reason: "Only this room's own agent can hold its recurring buy — nothing was queued." };
  const asker = await displayName(input.requesterId);

  let agentAddress: `0x${string}`;
  let balanceUsd: number;
  try {
    agentAddress = (await ensureAgentWallet(input.agentUserId)).address;
    balanceUsd = (await treasuryBalance(agentAddress)).usd;
  } catch (err) {
    console.error("recurring: wallet/balance read for a proposal failed:", logLine(err));
    return { ok: false, reason: "I can't read the treasury balance right now — nothing was queued." };
  }

  const { startsAt, expiresAt, weeksTouched } = windowFor(now, input.weeks);
  const exposure = exposureUsd(input.weeklyUsd, weeksTouched);
  const decision = evaluateCommand({
    policy: treasury.policy,
    kind: "investment",
    amountUsd: exposure,
    personal: false,
    balanceUsd,
  });
  if (decision.outcome === "forbidden")
    return {
      ok: false,
      reason: `I won't set that up. ${decision.rule ? `Our treasury rules say: “${decision.rule.text}”` : decision.reason}`,
    };
  if (decision.outcome === "insufficient")
    return {
      ok: false,
      reason: `At most ${usd(exposure)} in all is more than the treasury holds — we have ${usd(decision.balanceUsd)}. Nothing was queued.`,
    };
  if (decision.outcome === "auto")
    return {
      ok: false,
      reason: `Our rules would let me invest ${usd(exposure)} on my own (“${decision.rule.text}”), but a standing authority is never something I grant myself — nothing was queued.`,
    };

  const terms: RecurringBuyTerms = {
    v: 1,
    roomId: input.roomId,
    agentUserId: input.agentUserId,
    agentAddress,
    chainId: 8453,
    tokenIn: "USDC",
    tokenOut: "WETH",
    weeklyUsd: input.weeklyUsd,
    weeks: input.weeks,
    startsAt,
    expiresAt,
    nonce: now.getTime(),
  };
  const record: RecurringBuyRecord = {
    terms,
    digest: termsDigest(terms),
    rule: decision.rule.text,
    exposureUsd: exposure,
    proposedBy: input.requesterId,
  };
  const required = decision.required;

  // under the room's lock, so two asks at once can't both queue one
  return withRoomLock(input.roomId, async (): Promise<ProposeResult> => {
    const existing = await roomRecurringBuys(input.roomId);
    if (existing.some((a) => isOpenRequest(a, now)))
      return {
        ok: false,
        reason: "A recurring buy is already waiting for approval — approve it or stop it first. Nothing was queued.",
      };
    if (existing.some((a) => isLive(a, now)))
      return {
        ok: false,
        reason: "We already have a recurring buy running — stop it first to set up a different one. Nothing was queued.",
      };
    const action = await createTreasuryAction({
      roomId: input.roomId,
      agentUserId: input.agentUserId,
      requestedBy: input.requesterId,
      kind: RECURRING_BUY_KIND,
      amountUsd: exposure,
      memo: `recurring buy · ${usd(terms.weeklyUsd)} of ETH weekly · ${plural(terms.weeks, "week")}`,
      ruleText: JSON.stringify(record),
      requiredApprovals: required,
      status: "pending",
    });
    await logActivity(
      input.roomId,
      `${asker} asked: recurring buy · ${termsPhrase(terms)}, up to ${usd(exposure)} — needs ${plural(required, "human")} to approve`
    );
    return { ok: true, actionId: action.id, required, rule: record.rule, record };
  });
}

/**
 * On adopting `keepId`: every other live authority in the room that was
 * adopted before it is revoked as superseded — one recurring buy at a time.
 * Only earlier ones, so two adoptions finishing together can't revoke each
 * other. Returns how many it revoked.
 */
export async function supersedeOlderAuthorities(
  roomId: string,
  keepId: string,
  keepDecidedAt: Date,
  now = new Date()
): Promise<number> {
  const older = (await roomRecurringBuys(roomId)).filter(
    (a) => a.actionId !== keepId && isLive(a, now) && a.decidedAt !== null && a.decidedAt.getTime() < keepDecidedAt.getTime()
  );
  let revoked = 0;
  for (const a of older) if (await revoke(a.actionId, { revokedAt: unixS(now), revokedReason: "superseded" })) revoked++;
  return revoked;
}

// ── run ─────────────────────────────────────────────────────────────────────

export type RecurringRunResult =
  /** weeklyUsd in story dollars (the terms'); usdcIn / wethOut in whole tokens ("0.1", "0.0000254") */
  | { outcome: "bought"; isoWeek: string; weeklyUsd: number; usdcIn: string; wethOut: string; txHash: string; txUrl: string; route: SwapRoute }
  | { outcome: "skipped"; isoWeek: string; reason: RecurringSkipReason }
  | { outcome: "rehearsal"; isoWeek: string; wouldBuyUsd: number }
  | { outcome: "none"; reason: "no-recurring-buy" };

const NONE: RecurringRunResult = { outcome: "none", reason: "no-recurring-buy" };

/** Only a voting member directs the treasury; throws a RecurringBuyRefusal otherwise. */
async function assertVoter(roomId: string, userId: string): Promise<void> {
  if (!(await humanMemberIds(roomId)).includes(userId))
    throw new RecurringBuyRefusal("Only members of this room can run its recurring buy — nothing was bought.");
  if (!(await electorate(roomId)).includes(userId))
    throw new RecurringBuyRefusal(
      "You joined after our rules were adopted, so you can't direct the treasury yet — nothing was bought."
    );
}

/**
 * Which authority a run is about, and whether it may buy now. The live one,
 * else the latest adopted (so a stopped or finished one says so rather than
 * "none"). decideRun is asked twice when needed: a stop or the window refuses
 * before the rules in its order, so the chain is only read when they don't.
 */
async function decide(
  roomId: string,
  now: Date
): Promise<{ authority: RecurringBuyAuthority; decision: ReturnType<typeof decideRun> } | null> {
  const authorities = await roomRecurringBuys(roomId);
  const authority =
    newestAdopted(authorities.filter((a) => isLive(a, now))) ??
    newestAdopted(authorities.filter((a) => a.status === "executed"));
  if (!authority) return null;
  const runs = (await roomRuns(roomId)).filter((r) => r.authorityId === authority.actionId);
  const asked = { record: authority.record, runs, now };
  const early = decideRun({ ...asked, rulesStillAllow: true });
  if (!early.ok && early.reason !== "already-bought-this-week") return { authority, decision: early };
  const allow =
    (await executesAsApproved(authority.record)) &&
    (await rulesStillAllow(roomId, authority.record, authority.approvals));
  return { authority, decision: decideRun({ ...asked, rulesStillAllow: allow }) };
}

/**
 * The hash of a transaction the failed buy sent, if any: invest.ts attaches
 * it when the swap reverted, and viem names it when a receipt wait times out.
 * Either way money may have moved, so the run occupies its week.
 */
function sentTxHash(err: unknown): `0x${string}` | undefined {
  const e = err as { txHash?: unknown; shortMessage?: unknown; message?: unknown } | null;
  if (typeof e?.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(e.txHash)) return e.txHash as `0x${string}`;
  for (const text of [e?.shortMessage, e?.message]) {
    const found = typeof text === "string" ? text.match(TX_HASH) : null;
    if (found) return found[0] as `0x${string}`;
  }
  return undefined;
}

async function runLocked(roomId: string, by: string, now: Date): Promise<RecurringRunResult> {
  const decided = await decide(roomId, now);
  if (!decided) return NONE;
  const { authority, decision } = decided;
  const { terms } = authority.record;
  const isoWeek = decision.isoWeek;
  const base = { v: 1 as const, authorityId: authority.actionId, isoWeek, by, at: unixS(now) };
  const skip = async (reason: RecurringSkipReason, marks: FailureMarks = {}): Promise<RecurringRunResult> => {
    const { txHash: sent, ...rest } = marks;
    // a skip carrying a hash is kept even when nobody asked: it occupies its week
    if (by !== SCHEDULE || sent || rest.orderHash)
      await recordRun(
        authority,
        { ...base, outcome: "skipped", reason, ...(sent ? { txHash: sent, txUrl: `${INVEST_CHAIN.explorer}/tx/${sent}` } : {}), ...rest },
        now
      );
    return { outcome: "skipped", isoWeek, reason };
  };
  if (!decision.ok) return skip(decision.reason);

  const cfg = investConfig();
  if (!cfg) return skip("swap-failed");
  // read first, so a short wallet is told apart from a failed swap without parsing invest.ts's words
  const held = await investedPosition(terms.agentUserId)
    .then((p) => p?.usdcIdle ?? null)
    .catch(() => null);
  if (held !== null && held < usdcForUsd(cfg, terms.weeklyUsd)) return skip("insufficient-usdc");

  let bought: InvestResult;
  try {
    // this run's row can hold an order still open (orderHash), so the Trading API may answer with UniswapX
    bought = await investViaUniswap(terms.agentUserId, terms.weeklyUsd, { allowOrders: true });
  } catch (err) {
    const marks = failureMarks(err);
    const sent = marks.txHash ?? sentTxHash(err);
    const order = sent ? undefined : marks.orderHash;
    console.error(
      `recurring: the ${isoWeek} buy of ${authority.actionId} failed${sent ? ` after sending tx ${sent}` : order ? ` after placing order ${order}` : ""}: ${logLine(err)}`
    );
    const week = `Recurring buy, week of ${relationDay(weekStart(now))}`;
    if (sent)
      await logActivity(roomId, `${week}: swap sent, not completed · ${txLink(sent, INVEST_CHAIN.explorer)} — this week counts as used`);
    else if (order)
      await logActivity(roomId, `${week}: UniswapX order placed, not filled yet (order ${order}) — this week counts as used`);
    const message = (err as { message?: unknown } | null)?.message;
    const short = !sent && !order && typeof message === "string" && INSUFFICIENT_USDC.test(message);
    return skip(short ? "insufficient-usdc" : "swap-failed", { ...marks, txHash: sent, orderHash: order });
  }

  await recordRun(
    authority,
    {
      ...base,
      outcome: "bought",
      usdcIn: bought.usdcIn.toString(),
      wethOut: bought.wethOut.toString(),
      txHash: bought.txHash,
      txUrl: bought.txUrl,
      route: bought.route,
      ...(bought.requestId ? { requestId: bought.requestId } : {}),
      ...(bought.fallbackReason ? { fallbackReason: bought.fallbackReason } : {}),
    },
    now
  );
  await logActivity(
    roomId,
    `Recurring buy, week of ${relationDay(weekStart(now))}: ${usd(terms.weeklyUsd)} → ${wethShort(formatUnits(bought.wethOut, 18))} WETH · ${ROUTE_WORDS[bought.route]}${by === SCHEDULE ? "" : ` — asked by ${await displayName(by)}`} · ${txLink(bought.txHash, INVEST_CHAIN.explorer)}`
  );
  return {
    outcome: "bought",
    isoWeek,
    weeklyUsd: terms.weeklyUsd,
    usdcIn: formatUnits(bought.usdcIn, 6),
    wethOut: formatUnits(bought.wethOut, 18),
    txHash: bought.txHash,
    txUrl: bought.txUrl,
    route: bought.route,
  };
}

/**
 * One run of the room's recurring buy: at most one buy per ISO week, inside
 * the adopted terms, re-checked against the rules in force now. A run a human
 * asked for records exactly one history row (bought or skipped, with its
 * reason); a "schedule" run records its buys, and a skip only when a swap was
 * sent. With real runs off it is a rehearsal: the same decision, no quote, no
 * row. `byUserId` must be a voting member (else a RecurringBuyRefusal).
 */
export async function runRecurringBuy(input: {
  roomId: string;
  byUserId: string;
  now?: Date;
}): Promise<RecurringRunResult> {
  if (input.byUserId !== SCHEDULE) await assertVoter(input.roomId, input.byUserId);
  if (!realRunsEnabled()) {
    const decided = await decide(input.roomId, input.now ?? new Date());
    if (!decided) return NONE;
    const { authority, decision } = decided;
    return decision.ok
      ? { outcome: "rehearsal", isoWeek: decision.isoWeek, wouldBuyUsd: authority.record.terms.weeklyUsd }
      : { outcome: "skipped", isoWeek: decision.isoWeek, reason: decision.reason };
  }
  // the clock is read once the lock is held: a run that waited on another sees the week that is
  return withRoomLock(input.roomId, () => runLocked(input.roomId, input.byUserId, input.now ?? new Date()));
}

// ── stop ────────────────────────────────────────────────────────────────────

/**
 * Any human member stops the recurring buy, without a vote: stopping only
 * narrows what the agent may do. The live authority gets revokedAt/revokedBy
 * in its record (the first stop wins); a request still waiting for approval
 * is cancelled instead, so a mistaken one needn't block a new one for a day.
 */
export async function stopRecurringBuy(input: {
  roomId: string;
  byUserId: string;
  now?: Date;
}): Promise<{ ok: true; actionId: string } | { ok: false; reason: string }> {
  const now = input.now ?? new Date();
  if (!(await humanMemberIds(input.roomId)).includes(input.byUserId))
    return { ok: false, reason: "Only members of this room can stop its recurring buy." };
  const authorities = await roomRecurringBuys(input.roomId);
  const live = newestAdopted(authorities.filter((a) => isLive(a, now)));
  const mark = { revokedAt: unixS(now), revokedBy: input.byUserId, revokedReason: "stopped" as const };
  const who = await displayName(input.byUserId);

  if (live) {
    if (!(await revoke(live.actionId, mark)))
      return { ok: false, reason: "The recurring buy was already stopped — I won't buy again under it." };
    await logActivity(input.roomId, `${who} stopped the recurring buy (${termsPhrase(live.record.terms)}).`);
    return { ok: true, actionId: live.actionId };
  }

  const waiting = authorities.find((a) => isOpenRequest(a, now));
  if (!waiting) return { ok: false, reason: "There's no recurring buy running — nothing to stop." };
  // unclaimed only: once its quorum is being counted, adoption owns the row
  const [cancelled] = await db
    .update(treasuryActions)
    .set({
      status: "cancelled",
      decidedAt: now,
      error: `Cancelled by ${who}.`,
      ruleText: JSON.stringify({ ...waiting.record, ...mark }),
    })
    .where(
      and(
        eq(treasuryActions.id, waiting.actionId),
        eq(treasuryActions.status, "pending"),
        isNull(treasuryActions.decidedAt)
      )
    )
    .returning({ id: treasuryActions.id });
  if (!cancelled)
    return { ok: false, reason: "It's being adopted right this moment — ask me to stop it again in a few seconds." };
  await logActivity(
    input.roomId,
    `${who} cancelled the recurring buy request (${termsPhrase(waiting.record.terms)}).`
  );
  return { ok: true, actionId: waiting.actionId };
}

// ── status ──────────────────────────────────────────────────────────────────

function liveView(
  a: RecurringBuyAuthority,
  runs: RecurringRunRecord[],
  now: Date
): NonNullable<RecurringBuyStatus["live"]> {
  const { terms } = a.record;
  const startMs = terms.startsAt * 1000;
  const endMs = terms.expiresAt * 1000;
  const bought = runs.filter((r) => r.outcome === "bought");
  const zero = BigInt(0);
  const usdcIn = bought.reduce((sum, r) => sum + BigInt(r.usdcIn ?? "0"), zero);
  const wethOut = bought.reduce((sum, r) => sum + BigInt(r.wethOut ?? "0"), zero);
  const thisWeek = runs.filter((r) => r.isoWeek === isoWeekKey(now));
  // the next week opens then; a buy runs when a member asks, nothing on a timer
  const next = nextWeekStart(now).getTime();
  return {
    actionId: a.actionId,
    weeklyUsd: terms.weeklyUsd,
    weeks: terms.weeks,
    weekIndex: Math.min(terms.weeks, Math.max(1, Math.floor((now.getTime() - startMs) / WEEK_MS) + 1)),
    startsAt: isoAt(startMs),
    expiresAt: isoAt(endMs),
    nextRunAt: next < endMs ? isoAt(next) : null,
    approvedBy: a.approvedBy,
    approvals: a.approvals,
    required: a.required,
    rule: a.record.rule,
    digestShort: digestShort(a.record.digest),
    boughtWeeks: bought.length,
    investedUsd: Math.round(bought.length * terms.weeklyUsd * 100) / 100,
    usdcIn: formatUnits(usdcIn, 6),
    wethOut: formatUnits(wethOut, 18),
    // USDC (6 decimals) per WETH (18), to the cent: usdcIn × 10^12 / wethOut, × 100
    avgPriceUsdcPerEth: wethOut > zero ? Number((usdcIn * BigInt(10) ** BigInt(14)) / wethOut) / 100 : null,
    thisWeek: thisWeek.some((r) => r.outcome === "bought") ? "bought" : thisWeek.length ? "skipped" : "open",
  };
}

/**
 * The room's recurring buy for the panel, the Treasury page and the
 * treasurer: the authority in force, a request waiting for approvals, and the
 * recorded runs. Reads only the database — never the chain.
 */
export async function recurringBuyStatus(roomId: string, now = new Date()): Promise<RecurringBuyStatus> {
  const [authorities, runs] = await Promise.all([roomRecurringBuys(roomId), roomRuns(roomId)]);
  const live = newestAdopted(authorities.filter((a) => isLive(a, now)));
  const pending = authorities.find((a) => isOpenRequest(a, now)) ?? null;
  return {
    live: live ? liveView(live, runs.filter((r) => r.authorityId === live.actionId), now) : null,
    pending: pending
      ? {
          actionId: pending.actionId,
          weeklyUsd: pending.record.terms.weeklyUsd,
          weeks: pending.record.terms.weeks,
          exposureUsd: authorityExposure(pending.record),
          approvals: pending.approvals,
          required: pending.required,
          rule: pending.record.rule,
          expiresAt: isoAt(pending.createdAt.getTime() + REQUEST_TTL_MS),
        }
      : null,
    history: runs.slice(0, HISTORY_MAX).map((r) => ({
      at: isoAt(r.at * 1000),
      isoWeek: r.isoWeek,
      outcome: r.outcome,
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.usdcIn ? { usdcIn: formatUnits(BigInt(r.usdcIn), 6) } : {}),
      ...(r.wethOut ? { wethOut: formatUnits(BigInt(r.wethOut), 18) } : {}),
      ...(r.txUrl ? { txUrl: r.txUrl } : {}),
      ...(r.route ? { route: r.route } : {}),
    })),
    realRuns: realRunsEnabled(),
  };
}
