// Recurring buy — the pure rules (ISO weeks, terms, digest, parsing, decideRun). No DB, no chain.
//   cd app && npx tsx --tsconfig scripts/tsconfig.json scripts/recurring-selftest.mts
import assert from "node:assert/strict";
import {
  decideRun,
  exposureUsd,
  isoWeekKey,
  mondayUtc,
  parseAuthority,
  parseRun,
  termsDigest,
  validateTerms,
  windowFor,
  type RecurringBuyRecord,
  type RecurringBuyTerms,
  type RecurringRunRecord,
} from "@/lib/agent/treasury/recurring-record";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const at = (iso: string) => new Date(iso);
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// ── ISO weeks ───────────────────────────────────────────────────────────────

check("ISO week edges", () => {
  assert.equal(isoWeekKey(at("2026-09-27T23:59:59Z")), "2026-W39"); // Sunday closes W39
  assert.equal(isoWeekKey(at("2026-09-28T00:00:00Z")), "2026-W40"); // Monday opens W40
  assert.equal(isoWeekKey(at("2027-01-01T12:00:00Z")), "2026-W53"); // Friday belongs to the previous ISO year
  assert.equal(isoWeekKey(at("2027-01-04T00:00:00Z")), "2027-W01");
  assert.equal(isoWeekKey(at("2025-12-29T00:00:00Z")), "2026-W01"); // Monday before Jan 1 belongs to the next ISO year
  assert.equal(isoWeekKey(at("2026-01-05T00:00:00Z")), "2026-W02");
});

check("ISO week is UTC, not local time", () => {
  // 2026-09-28 08:00 in Tokyo is still Sunday in UTC
  assert.equal(isoWeekKey(at("2026-09-28T08:00:00+09:00")), "2026-W39");
  assert.equal(isoWeekKey(at("2026-09-28T09:00:00+09:00")), "2026-W40");
});

check("isoWeekKey and mondayUtc throw on an invalid Date", () => {
  assert.throws(() => isoWeekKey(new Date("nope")));
  assert.throws(() => mondayUtc(new Date(NaN)));
});

check("mondayUtc is Monday 00:00 UTC of the same ISO week", () => {
  assert.equal(mondayUtc(at("2026-09-27T23:59:59Z")).toISOString(), "2026-09-21T00:00:00.000Z");
  assert.equal(mondayUtc(at("2026-09-28T00:00:00Z")).toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(mondayUtc(at("2026-10-01T15:30:00Z")).toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(mondayUtc(at("2027-01-01T12:00:00Z")).toISOString(), "2026-12-28T00:00:00.000Z");
});

check("windowFor: the current week counts, expiry is the Monday after the last week", () => {
  const w = windowFor(at("2026-09-30T10:00:00Z"), 26);
  assert.equal(w.startsAt, sec("2026-09-28T00:00:00Z"));
  assert.equal(w.expiresAt, sec("2027-03-29T00:00:00Z"));
  assert.equal(w.weeksTouched, 26);
  const one = windowFor(at("2026-09-28T00:00:00Z"), 1);
  assert.equal(one.expiresAt - one.startsAt, 7 * 86_400);
});

// ── terms ───────────────────────────────────────────────────────────────────

check("exposure = weekly × weeks, in cents", () => {
  assert.equal(exposureUsd(20, 26), 520);
  assert.equal(exposureUsd(0.1, 3), 0.3);
  assert.equal(exposureUsd(12.34, 52), 641.68);
});

check("validateTerms bounds", () => {
  assert.deepEqual(validateTerms({ weeklyUsd: 20, weeks: 26 }), { ok: true });
  assert.deepEqual(validateTerms({ weeklyUsd: 0.01, weeks: 1 }), { ok: true });
  assert.deepEqual(validateTerms({ weeklyUsd: 10_000, weeks: 52 }), { ok: true });
  assert.deepEqual(validateTerms({ weeklyUsd: 19.99, weeks: 4 }), { ok: true });
  for (const bad of [
    { weeklyUsd: 0, weeks: 4 },
    { weeklyUsd: -5, weeks: 4 },
    { weeklyUsd: NaN, weeks: 4 },
    { weeklyUsd: Infinity, weeks: 4 },
    { weeklyUsd: 10_000.01, weeks: 4 },
    { weeklyUsd: 1.005, weeks: 4 },
    { weeklyUsd: 20, weeks: 0 },
    { weeklyUsd: 20, weeks: 53 },
    { weeklyUsd: 20, weeks: 2.5 },
  ]) {
    const r = validateTerms(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.ok(r.reason.length > 0);
  }
});

const W = windowFor(at("2026-09-28T00:00:00Z"), 26);
const TERMS: RecurringBuyTerms = {
  v: 1,
  roomId: "room-1",
  agentUserId: "agent-1",
  agentAddress: "0x34E1000000000000000000000000000000006252",
  chainId: 8453,
  tokenIn: "USDC",
  tokenOut: "WETH",
  weeklyUsd: 20,
  weeks: 26,
  startsAt: W.startsAt,
  expiresAt: W.expiresAt,
  nonce: 1_790_000_000_000,
};

check("digest: stable across key order, sensitive to the terms", () => {
  const d = termsDigest(TERMS);
  assert.match(d, /^0x[0-9a-f]{64}$/);
  assert.equal(termsDigest({ ...TERMS }), d);
  const reversed = Object.fromEntries(Object.entries(TERMS).reverse()) as unknown as RecurringBuyTerms;
  assert.equal(termsDigest(reversed), d);
  assert.equal(termsDigest(JSON.parse(JSON.stringify(TERMS))), d);
  assert.notEqual(termsDigest({ ...TERMS, weeklyUsd: 21 }), d);
  assert.notEqual(termsDigest({ ...TERMS, weeks: 25 }), d);
  assert.notEqual(termsDigest({ ...TERMS, agentAddress: "0x34E1000000000000000000000000000000006253" }), d);
  assert.notEqual(termsDigest({ ...TERMS, nonce: TERMS.nonce + 1 }), d);
});

const RECORD: RecurringBuyRecord = {
  terms: TERMS,
  digest: termsDigest(TERMS),
  rule: "Investing idle funds: 3 verified members approve.",
  exposureUsd: exposureUsd(TERMS.weeklyUsd, TERMS.weeks),
  proposedBy: "user-chris",
};

// ── parsing ─────────────────────────────────────────────────────────────────

check("parseAuthority round-trips a record, with and without revocation", () => {
  assert.deepEqual(parseAuthority(JSON.stringify(RECORD)), RECORD);
  const revoked: RecurringBuyRecord = { ...RECORD, revokedAt: 1_790_000_100, revokedBy: "user-dana", revokedReason: "stopped" };
  assert.deepEqual(parseAuthority(JSON.stringify(revoked)), revoked);
});

check("parseAuthority: null on anything malformed", () => {
  const bad: unknown[] = [
    "",
    "not json",
    "{",
    "null",
    "[]",
    "42",
    "Investing idle funds: 3 verified members approve.",
    { ...RECORD, terms: undefined },
    { ...RECORD, digest: "0x1234" },
    { ...RECORD, rule: 7 },
    { ...RECORD, proposedBy: "" },
    { ...RECORD, exposureUsd: "520" },
    { ...RECORD, revokedAt: "yesterday" },
    { ...RECORD, revokedReason: "bored" },
    { ...RECORD, terms: { ...TERMS, v: 2 } },
    { ...RECORD, terms: { ...TERMS, chainId: 1 } },
    { ...RECORD, terms: { ...TERMS, tokenOut: "DAI" } },
    { ...RECORD, terms: { ...TERMS, agentAddress: "0xnope" } },
    { ...RECORD, terms: { ...TERMS, weeks: 0 } },
    { ...RECORD, terms: { ...TERMS, weeklyUsd: -1 } },
    { ...RECORD, terms: { ...TERMS, expiresAt: TERMS.startsAt } },
  ];
  for (const b of bad) {
    const text = typeof b === "string" ? b : JSON.stringify(b);
    assert.equal(parseAuthority(text), null, text.slice(0, 80));
  }
});

const TX = `0x${"ab".repeat(32)}` as const;
const run = (over: Partial<RecurringRunRecord>): RecurringRunRecord => ({
  v: 1,
  authorityId: "act-1",
  isoWeek: "2026-W40",
  outcome: "bought",
  usdcIn: "20000000",
  wethOut: "7400000000000000",
  txHash: TX,
  txUrl: `https://basescan.org/tx/${TX}`,
  by: "user-chris",
  at: sec("2026-09-28T09:00:00Z"),
  ...over,
});

check("parseRun round-trips buys and skips", () => {
  const bought = run({});
  assert.deepEqual(parseRun(JSON.stringify(bought)), bought);
  const skipped: RecurringRunRecord = { v: 1, authorityId: "act-1", isoWeek: "2026-W41", outcome: "skipped", reason: "insufficient-usdc", by: "schedule", at: 1 };
  assert.deepEqual(parseRun(JSON.stringify(skipped)), skipped);
});

check("parseRun: null on anything malformed", () => {
  const bad: unknown[] = [
    "",
    "not json",
    "null",
    "[]",
    { ...run({}), v: 2 },
    { ...run({}), authorityId: "" },
    { ...run({}), isoWeek: "2026-40" },
    { ...run({}), isoWeek: "2026-W54" },
    { ...run({}), outcome: "maybe" },
    { ...run({ outcome: "skipped" }), reason: "bored" },
    { ...run({ outcome: "skipped", txHash: undefined }), reason: undefined },
    { ...run({}), txHash: undefined },
    { ...run({}), txHash: "0x12" },
    { ...run({}), usdcIn: "20.5" },
    { ...run({}), usdcIn: 20 },
    { ...run({}), by: "" },
    { ...run({}), at: "now" },
  ];
  for (const b of bad) {
    const text = typeof b === "string" ? b : JSON.stringify(b);
    assert.equal(parseRun(text), null, text.slice(0, 80));
  }
});

// ── decideRun ───────────────────────────────────────────────────────────────

const IN_WINDOW = at("2026-09-30T09:00:00Z"); // 2026-W40, week 1 of the window
const BEFORE = at("2026-09-27T09:00:00Z"); // 2026-W39, before startsAt
const AFTER = new Date(TERMS.expiresAt * 1000); // first second past the last week

const decide = (over: Partial<Parameters<typeof decideRun>[0]>) =>
  decideRun({ record: RECORD, runs: [], rulesStillAllow: true, now: IN_WINDOW, ...over });
const reason = (r: ReturnType<typeof decideRun>) => (r.ok ? "ok" : r.reason);

const STOPPED: RecurringBuyRecord = { ...RECORD, revokedAt: 1, revokedBy: "user-dana", revokedReason: "stopped" };
const TAMPERED: RecurringBuyRecord = { ...RECORD, terms: { ...TERMS, weeklyUsd: 2000 } };
const BOUGHT_THIS_WEEK = [run({ isoWeek: "2026-W40" })];

check("a clean run in the window may buy, and names its week", () => {
  assert.deepEqual(decide({}), { ok: true, isoWeek: "2026-W40" });
  assert.deepEqual(decide({ runs: [run({ isoWeek: "2026-W39" })] }), { ok: true, isoWeek: "2026-W40" });
  // the last second of the last week is still inside
  assert.equal(reason(decide({ now: new Date(TERMS.expiresAt * 1000 - 1000) })), "ok");
  // startsAt itself is inside
  assert.equal(reason(decide({ now: new Date(TERMS.startsAt * 1000) })), "ok");
});

check("each refusal on its own", () => {
  assert.equal(reason(decide({ record: STOPPED })), "stopped");
  assert.equal(reason(decide({ now: BEFORE })), "not-started");
  assert.equal(reason(decide({ now: AFTER })), "expired");
  assert.equal(reason(decide({ rulesStillAllow: false })), "rules-changed");
  assert.equal(reason(decide({ record: TAMPERED })), "rules-changed");
  assert.equal(reason(decide({ runs: BOUGHT_THIS_WEEK })), "already-bought-this-week");
});

check("refusal order: two faults stacked per adjacent pair, the earlier one wins", () => {
  // stopped > not-started
  assert.equal(reason(decide({ record: STOPPED, now: BEFORE })), "stopped");
  // not-started > expired: only an inverted window has both, which parseAuthority rejects, so build it directly
  const invertedTerms = { ...TERMS, startsAt: sec("2026-10-05T00:00:00Z"), expiresAt: sec("2026-09-28T00:00:00Z") };
  const inverted: RecurringBuyRecord = { ...RECORD, terms: invertedTerms, digest: termsDigest(invertedTerms) };
  assert.equal(reason(decide({ record: inverted, now: IN_WINDOW })), "not-started");
  assert.equal(reason(decide({ now: BEFORE, rulesStillAllow: false })), "not-started");
  // expired > rules-changed
  assert.equal(reason(decide({ now: AFTER, rulesStillAllow: false })), "expired");
  assert.equal(reason(decide({ now: AFTER, record: TAMPERED })), "expired");
  // rules-changed > already-bought-this-week
  assert.equal(reason(decide({ rulesStillAllow: false, runs: BOUGHT_THIS_WEEK })), "rules-changed");
  assert.equal(reason(decide({ record: TAMPERED, runs: BOUGHT_THIS_WEEK })), "rules-changed");
  // stopped > expired, and stopped outranks everything at once
  assert.equal(reason(decide({ record: STOPPED, now: AFTER })), "stopped");
  assert.equal(reason(decide({ record: { ...TAMPERED, revokedAt: 1 }, rulesStillAllow: false, runs: BOUGHT_THIS_WEEK })), "stopped");
});

check("a skip with a txHash occupies the week; a skip without one does not", () => {
  const failedBroadcast = run({ outcome: "skipped", reason: "swap-failed", usdcIn: undefined, wethOut: undefined });
  assert.equal(reason(decide({ runs: [failedBroadcast] })), "already-bought-this-week");
  const failedBeforeBroadcast = run({ outcome: "skipped", reason: "swap-failed", txHash: undefined, txUrl: undefined, usdcIn: undefined, wethOut: undefined });
  assert.equal(reason(decide({ runs: [failedBeforeBroadcast] })), "ok");
  const noUsdc = run({ outcome: "skipped", reason: "insufficient-usdc", txHash: undefined, txUrl: undefined, usdcIn: undefined, wethOut: undefined });
  assert.equal(reason(decide({ runs: [noUsdc, failedBeforeBroadcast] })), "ok");
  // a buy last week does not occupy this week
  assert.equal(reason(decide({ runs: [run({ isoWeek: "2026-W39" }), failedBeforeBroadcast] })), "ok");
});

check("refusals still report the week they were asked in", () => {
  const r = decide({ now: AFTER });
  assert.equal(r.isoWeek, isoWeekKey(AFTER));
  assert.equal(decide({ record: STOPPED }).isoWeek, "2026-W40");
});

console.log(`recurring-selftest: ${passed} checks passed`);
