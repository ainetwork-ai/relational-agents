import { keccak256, toBytes } from "viem";

/**
 * Recurring buy — the pure rules. A relation adopts ONE standing authority
 * ("recurring-buy" action) by quorum; afterwards the agent may buy at most once
 * per ISO week inside it, and every run — bought or skipped — is one
 * "recurring-buy-run" history row. This module holds the records stored in
 * those rows' `ruleText` and the decision whether a run may buy now. No IO and
 * no clock: `now` is always passed in (recurring.ts does the reading/writing).
 */

export interface RecurringBuyTerms {
  v: 1;
  roomId: string;
  agentUserId: string;
  /** derived on the server from agentKey(agentUserId); same EOA on Sepolia and Base */
  agentAddress: `0x${string}`;
  /** Base — fixed on the server, never from the caller */
  chainId: 8453;
  tokenIn: "USDC";
  tokenOut: "WETH";
  /** story dollars (demo scale applies inside investViaUniswap) */
  weeklyUsd: number;
  weeks: number;
  /** unix seconds, Monday 00:00 UTC of the first ISO week the buy may run in */
  startsAt: number;
  /** unix seconds, Monday 00:00 UTC after the last week → at most `weeks` buys */
  expiresAt: number;
  /** ms timestamp at proposal */
  nonce: number;
}

export interface RecurringBuyRecord {
  terms: RecurringBuyTerms;
  /** termsDigest(terms) at proposal — what the approvers saw (shortened) */
  digest: `0x${string}`;
  /** the rule line that set the bar, verbatim */
  rule: string;
  exposureUsd: number;
  proposedBy: string;
  revokedAt?: number;
  revokedBy?: string;
  revokedReason?: "stopped" | "superseded";
}

export type RecurringSkipReason =
  | "stopped"
  | "not-started"
  | "expired"
  | "rules-changed"
  | "already-bought-this-week"
  | "insufficient-usdc"
  | "swap-failed";

/** Why a week was skipped, as a clause ("Skipped 2026-W40: already bought this week") — the one wording chat, the panel and the Treasury page show. */
export const SKIP_REASON_TEXT: Record<RecurringSkipReason, string> = {
  stopped: "the recurring buy was stopped",
  "not-started": "its first week hasn't started",
  expired: "its weeks are over",
  "rules-changed": "our rules or its terms changed since it was approved",
  "already-bought-this-week": "already bought this week",
  "insufficient-usdc": "the agent's Base wallet holds too little USDC",
  "swap-failed": "the swap didn't go through",
};

export interface RecurringRunRecord {
  v: 1;
  authorityId: string;
  isoWeek: string;
  outcome: "bought" | "skipped";
  reason?: RecurringSkipReason;
  /** bigint as decimal strings, token units */
  usdcIn?: string;
  wethOut?: string;
  txHash?: `0x${string}`;
  txUrl?: string;
  /** userId who asked, or "schedule" */
  by: string;
  at: number;
}

const DAY_MS = 86_400_000;
const WEEK_S = 7 * 86_400;
const MAX_WEEKLY_USD = 10_000;
const MAX_WEEKS = 52;

const SKIP_REASONS: ReadonlySet<string> = new Set(Object.keys(SKIP_REASON_TEXT));

function assertValidDate(date: Date): void {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new RangeError("invalid Date");
}

/** Monday 00:00 UTC of the ISO week `date` falls in (ISO weeks start on Monday). */
export function mondayUtc(date: Date): Date {
  assertValidDate(date);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(midnight - daysSinceMonday * DAY_MS);
}

/** ISO 8601 week key in UTC, e.g. "2026-W40". The ISO year is the year of the
 *  week's Thursday, so Fri 2027-01-01 belongs to 2026-W53. */
export function isoWeekKey(date: Date): string {
  const thursday = new Date(mondayUtc(date).getTime() + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / (7 * DAY_MS)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** The current week counts as week 1, so a buy can run right after adoption. */
export function windowFor(now: Date, weeks: number): { startsAt: number; expiresAt: number; weeksTouched: number } {
  const startsAt = Math.floor(mondayUtc(now).getTime() / 1000);
  return { startsAt, expiresAt: startsAt + weeks * WEEK_S, weeksTouched: weeks };
}

/** The most the authority can ever spend — what the rule bar is judged against. */
export function exposureUsd(weeklyUsd: number, weeksTouched: number): number {
  return Math.round(weeklyUsd * weeksTouched * 100) / 100;
}

export function validateTerms(input: { weeklyUsd: number; weeks: number }): { ok: true } | { ok: false; reason: string } {
  const { weeklyUsd, weeks } = input;
  if (typeof weeklyUsd !== "number" || !Number.isFinite(weeklyUsd) || weeklyUsd <= 0) {
    return { ok: false, reason: "The weekly amount must be more than $0." };
  }
  if (weeklyUsd > MAX_WEEKLY_USD) {
    return { ok: false, reason: `The weekly amount can be at most $${MAX_WEEKLY_USD.toLocaleString("en-US")}.` };
  }
  if (Math.abs(weeklyUsd * 100 - Math.round(weeklyUsd * 100)) > 1e-6) {
    return { ok: false, reason: "The weekly amount can have at most 2 decimals (cents)." };
  }
  if (typeof weeks !== "number" || !Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) {
    return { ok: false, reason: `The number of weeks must be a whole number from 1 to ${MAX_WEEKS}.` };
  }
  return { ok: true };
}

/** JSON with object keys sorted at every level, so the digest does not depend
 *  on the order a record was built or read back in. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Fingerprint of the terms people approved; a stored record whose terms no
 *  longer hash to its digest was edited after approval and must not buy. */
export function termsDigest(terms: RecurringBuyTerms): `0x${string}` {
  return keccak256(toBytes(canonicalJson(terms)));
}

// ── parsing: the rows are free-text JSON, so every field is checked ─────────

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function isOptional<T>(v: unknown, guard: (x: unknown) => x is T): v is T | undefined {
  return v === undefined || guard(v);
}
const isAddress = (v: unknown): v is `0x${string}` => isStr(v) && /^0x[0-9a-fA-F]{40}$/.test(v);
const isHash = (v: unknown): v is `0x${string}` => isStr(v) && /^0x[0-9a-fA-F]{64}$/.test(v);
const isUintString = (v: unknown): v is string => isStr(v) && /^\d+$/.test(v);
const isIsoWeek = (v: unknown): v is string => isStr(v) && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(v);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseTerms(t: unknown): RecurringBuyTerms | null {
  if (!isObj(t)) return null;
  if (t.v !== 1 || t.chainId !== 8453 || t.tokenIn !== "USDC" || t.tokenOut !== "WETH") return null;
  if (!isNonEmptyStr(t.roomId) || !isNonEmptyStr(t.agentUserId) || !isAddress(t.agentAddress)) return null;
  if (!isNum(t.weeklyUsd) || !isNum(t.weeks) || !validateTerms({ weeklyUsd: t.weeklyUsd, weeks: t.weeks }).ok) return null;
  if (!isNum(t.startsAt) || !isNum(t.expiresAt) || t.expiresAt <= t.startsAt || !isNum(t.nonce)) return null;
  return {
    v: 1,
    roomId: t.roomId,
    agentUserId: t.agentUserId,
    agentAddress: t.agentAddress,
    chainId: 8453,
    tokenIn: "USDC",
    tokenOut: "WETH",
    weeklyUsd: t.weeklyUsd,
    weeks: t.weeks,
    startsAt: t.startsAt,
    expiresAt: t.expiresAt,
    nonce: t.nonce,
  };
}

/** The authority row's `ruleText`; null on anything malformed. */
export function parseAuthority(ruleText: string): RecurringBuyRecord | null {
  const r = parseJson(ruleText);
  if (!isObj(r)) return null;
  const terms = parseTerms(r.terms);
  if (!terms) return null;
  if (!isHash(r.digest) || !isStr(r.rule) || !isNum(r.exposureUsd) || !isNonEmptyStr(r.proposedBy)) return null;
  if (!isOptional(r.revokedAt, isNum) || !isOptional(r.revokedBy, isStr)) return null;
  if (r.revokedReason !== undefined && r.revokedReason !== "stopped" && r.revokedReason !== "superseded") return null;
  const record: RecurringBuyRecord = {
    terms,
    digest: r.digest,
    rule: r.rule,
    exposureUsd: r.exposureUsd,
    proposedBy: r.proposedBy,
  };
  if (r.revokedAt !== undefined) record.revokedAt = r.revokedAt;
  if (r.revokedBy !== undefined) record.revokedBy = r.revokedBy;
  if (r.revokedReason !== undefined) record.revokedReason = r.revokedReason;
  return record;
}

/** A history row's `ruleText`; null on anything malformed. */
export function parseRun(ruleText: string): RecurringRunRecord | null {
  const r = parseJson(ruleText);
  if (!isObj(r)) return null;
  if (r.v !== 1 || !isNonEmptyStr(r.authorityId) || !isIsoWeek(r.isoWeek)) return null;
  if (r.outcome !== "bought" && r.outcome !== "skipped") return null;
  if (r.reason !== undefined && !(isStr(r.reason) && SKIP_REASONS.has(r.reason))) return null;
  if (r.outcome === "skipped" && r.reason === undefined) return null;
  if (!isOptional(r.usdcIn, isUintString) || !isOptional(r.wethOut, isUintString)) return null;
  if (!isOptional(r.txHash, isHash) || !isOptional(r.txUrl, isStr)) return null;
  if (r.outcome === "bought" && r.txHash === undefined) return null;
  if (!isNonEmptyStr(r.by) || !isNum(r.at)) return null;
  const run: RecurringRunRecord = {
    v: 1,
    authorityId: r.authorityId,
    isoWeek: r.isoWeek,
    outcome: r.outcome,
    by: r.by,
    at: r.at,
  };
  if (r.reason !== undefined) run.reason = r.reason as RecurringSkipReason;
  if (r.usdcIn !== undefined) run.usdcIn = r.usdcIn;
  if (r.wethOut !== undefined) run.wethOut = r.wethOut;
  if (r.txHash !== undefined) run.txHash = r.txHash;
  if (r.txUrl !== undefined) run.txUrl = r.txUrl;
  return run;
}

/**
 * May this authority buy now? The refusal order is part of the contract: a
 * stop outranks everything (the members said no), then the window, then the
 * rules/terms, and only then the once-a-week limit. A skip that carries a
 * txHash occupies its week like a buy — a broadcast swap that failed may still
 * have moved money.
 */
export function decideRun(input: {
  record: RecurringBuyRecord;
  runs: RecurringRunRecord[];
  rulesStillAllow: boolean;
  now: Date;
}): { ok: true; isoWeek: string } | { ok: false; reason: RecurringSkipReason; isoWeek: string } {
  const { record, runs, rulesStillAllow, now } = input;
  const isoWeek = isoWeekKey(now);
  const nowS = Math.floor(now.getTime() / 1000);
  const refuse = (reason: RecurringSkipReason) => ({ ok: false as const, reason, isoWeek });

  if (record.revokedAt !== undefined) return refuse("stopped");
  if (nowS < record.terms.startsAt) return refuse("not-started");
  if (nowS >= record.terms.expiresAt) return refuse("expired");
  if (!rulesStillAllow || termsDigest(record.terms) !== record.digest.toLowerCase()) return refuse("rules-changed");
  const occupied = runs.some((r) => r.isoWeek === isoWeek && (r.outcome === "bought" || r.txHash !== undefined));
  if (occupied) return refuse("already-bought-this-week");
  return { ok: true, isoWeek };
}
