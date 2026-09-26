// Recurring buy — the chat shapes (match.ts). Pure; no DB, no chain.
//   cd app && npx tsx --tsconfig scripts/tsconfig.json scripts/recurring-chat-selftest.mts
import assert from "node:assert/strict";
import { matchTreasuryCommand, mentionsMoney, mentionsRecurringMoney } from "@/lib/agent/treasury/match";
import { TREASURY_KO } from "@/i18n/content/agent";
import { TREASURY_SELFTEST as KO } from "@/i18n/content/scripts";

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

const AGENT = "Tokyo Trip agent";
const m = (text: string) => matchTreasuryCommand(text, AGENT);
/** refused: not read as any command, and answered with the recurring "nothing was moved" */
const refusedAsRecurring = (text: string) => {
  assert.equal(m(text), null, `matched: ${text}`);
  assert.ok(mentionsRecurringMoney(text, AGENT), `not refused as recurring: ${text}`);
};

// ── propose ─────────────────────────────────────────────────────────────────

check("buy $10 of ETH every week for 26 weeks is a proposal, not a $10 expense", () => {
  assert.deepEqual(m("@agent buy $10 of ETH every week for 26 weeks"), {
    kind: "recurring-propose",
    weeklyUsd: 10,
    weeks: 26,
  });
});

check("proposal phrasings", () => {
  const cases: [string, number, number][] = [
    ["@agent buy $20 of ETH weekly for 26 weeks", 20, 26],
    ["@agent buy $20 of ETH each week for 26 weeks.", 20, 26],
    ["@Tokyo Trip agent please buy $12.50 of ether every week for 8 weeks", 12.5, 8],
    ["@agent invest $20 in ETH every week for 26 weeks", 20, 26],
    ["@agent invest 20 dollars into ethereum weekly for 4 weeks", 20, 4],
    ["@agent set up a recurring buy of $20 of ETH every week for 26 weeks", 20, 26],
    ["@agent start a weekly buy of $1,000 in ETH for 52 weeks", 1000, 52],
    ["@agent recurring buy of USD 20 of ETH for the next 10 weeks!", 20, 10],
    ["@agent can you buy $20 of ETH every week for 1 week?", 20, 1],
    ["@agent buy $20 of ETH a week for 26 weeks, please", 20, 26],
  ];
  for (const [text, weeklyUsd, weeks] of cases)
    assert.deepEqual(m(text), { kind: "recurring-propose", weeklyUsd, weeks }, text);
});

check("out-of-range terms still read — the proposal refuses them with its own reason", () => {
  assert.deepEqual(m("@agent buy $20 of ETH every week for 0 weeks"), { kind: "recurring-propose", weeklyUsd: 20, weeks: 0 });
  assert.deepEqual(m("@agent buy $20 of ETH every week for 60 weeks"), { kind: "recurring-propose", weeklyUsd: 20, weeks: 60 });
});

// ── run, stop, status ───────────────────────────────────────────────────────

check("run shapes", () => {
  for (const text of [
    "@agent buy this week's ETH",
    "@agent buy this week’s ETH now",
    "@agent run the recurring buy",
    "@agent run the weekly buy now.",
    "@agent please run our recurring buy",
  ])
    assert.deepEqual(m(text), { kind: "recurring-run" }, text);
});

check("stop shapes", () => {
  for (const text of [
    "@agent stop the recurring buy",
    "@agent cancel the weekly buy",
    "@agent end our recurring buy.",
    "@agent pause the recurring buy",
    "@agent stop the recurring ETH buy now",
  ])
    assert.deepEqual(m(text), { kind: "recurring-stop" }, text);
});

check("status shapes", () => {
  for (const text of [
    "@agent how is the recurring buy doing?",
    "@agent how's the weekly buy going",
    "@agent recurring buy status",
    "@agent weekly buy status?",
    "@agent status of the recurring buy",
  ])
    assert.deepEqual(m(text), { kind: "recurring-status" }, text);
});

// ── recurring wording is never one payment ──────────────────────────────────

check("English recurring wording is refused, never paid once", () => {
  for (const text of [
    "@agent buy $10 of ETH every week", // no number of weeks
    "@agent pay the gym $30 every month",
    "@agent pay the gym $30 monthly",
    "@agent pay $30 for snacks every day", // was paid once, memo "snacks every day"
    "@agent send $20 to Bea weekly",
    "@agent pay $10 a week for the parking",
    "@agent invest $50 in ETH daily",
    "@agent buy ETH every week",
    "@agent buy $10 of ETH each week",
    "@agent pay the hotel $30 per week",
    "@agent don't buy $10 of ETH every week for 26 weeks",
  ])
    refusedAsRecurring(text);
});

check("Korean \"buy ETH for 10,000 won every week\" is refused, not a one-off", () => {
  for (const text of TREASURY_KO.recurringExamples) refusedAsRecurring(text);
  for (const text of TREASURY_KO.recurringNonRequests) {
    assert.equal(m(text), null, text);
    assert.ok(!mentionsRecurringMoney(text, AGENT), text);
  }
});

check("no false alarm on chat that moves nothing", () => {
  for (const text of [
    "@agent what do we do every week?",
    "@agent remind everyone the hotel is $180",
    "@agent book the hotel for a week, $500", // a duration, read as one payment below
    "@agent what's our balance?",
  ])
    assert.ok(!mentionsRecurringMoney(text, AGENT), text);
});

// ── one-off sentences read exactly as before ────────────────────────────────

check("one-off commands are unchanged", () => {
  assert.deepEqual(m("@Tokyo Trip agent pay the hotel deposit, $180"), {
    kind: "expense",
    amountUsd: 180,
    memo: "hotel deposit",
    toSelf: false,
    raw: "@Tokyo Trip agent pay the hotel deposit, $180",
  });
  const cases: [string, string, number, string, boolean][] = [
    ["@agent book the hotel for $180", "expense", 180, "hotel", false],
    ["@agent can you buy the train tickets, USD 60?", "expense", 60, "train tickets", false],
    ["@agent buy 2 museum tickets for $60", "expense", 60, "2 museum tickets", false],
    ["@agent send $700 to my wallet", "withdrawal", 700, "", true],
    ["@agent invest $300 of the idle funds", "investment", 300, "idle funds", false],
    ["@agent book the hotel for a week, $500", "expense", 500, "hotel for a week", false],
    // after a determiner, "weekly"/"monthly" name the thing bought once, not a schedule
    ["@agent buy the weekly pass for $30", "expense", 30, "weekly pass", false],
    ["@agent pay the monthly rent, $900", "expense", 900, "monthly rent", false],
  ];
  for (const [text, kind, amountUsd, memo, toSelf] of cases) {
    const c = m(text);
    assert.ok(c && "amountUsd" in c, text);
    assert.deepEqual([c.kind, c.amountUsd, c.memo, c.toSelf], [kind, amountUsd, memo, toSelf], text);
  }
  const e = m(KO.expense);
  assert.ok(e && "amountUsd" in e);
  assert.deepEqual([e.kind, e.amountUsd, e.memo], ["expense", 180, KO.expenseMemo]);
  assert.deepEqual(m(KO.status), { kind: "status", raw: KO.status });
  assert.deepEqual(m("@agent adopt the new rules"), { kind: "adopt", raw: "@agent adopt the new rules" });
  assert.deepEqual(m("@agent treasury status"), { kind: "status", raw: "@agent treasury status" });
  // still read as money sentences we can't act on, and still not recurring
  for (const text of ["@agent buy 5 museum tickets at $12 each", "@agent pay the hotel $180 per night for 3 nights"]) {
    assert.equal(m(text), null, text);
    assert.ok(mentionsMoney(text, AGENT), text);
  }
});

console.log(`recurring-chat selftest: ${passed} checks passed`);
