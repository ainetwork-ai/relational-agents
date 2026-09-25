// Relation Treasury — policy + matcher checks. Pure; no DB, no chain.
//   cd app && npx tsx --tsconfig scripts/tsconfig.json scripts/treasury-selftest.mts
import assert from "node:assert/strict";
import { describeRule, evaluateCommand, parsePayees, parseTreasuryPolicy } from "@/lib/agent/treasury/policy";
import { matchTreasuryCommand, mentionsMoney } from "@/lib/agent/treasury/match";
import type { EvaluateInput, TreasuryPolicy } from "@/lib/agent/treasury/types";

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

const DEMO_RULES = [
  "Shared expenses under $50: the agent may pay on its own.",
  "Shared expenses from $50 to $200: 2 verified members approve.",
  "Shared expenses over $200: 3 verified members approve.",
  "Investing idle funds: 3 verified members approve.",
  "Moving more than 30% of the treasury at once: 4 verified members approve.",
  "Sending treasury money to a member's personal wallet: not allowed.",
];
const PERSONAL = DEMO_RULES[5];

// OKF bulleted_list blocks come back without the dash; the doc as typed has it
const policy = parseTreasuryPolicy(DEMO_RULES.join("\n"));
const dashed = parseTreasuryPolicy(DEMO_RULES.map((r) => `- ${r}`).join("\n"));

const ev = (p: TreasuryPolicy, over: Partial<EvaluateInput>) =>
  evaluateCommand({ policy: p, kind: "expense", amountUsd: 0, personal: false, balanceUsd: 1000, ...over });

// ── policy: parsing ─────────────────────────────────────────────────────────

check("six demo rules parse, nothing unparsed", () => {
  assert.deepEqual(policy.unparsed, []);
  assert.equal(policy.rules.length, 6);
  assert.deepEqual(dashed, policy);
  assert.deepEqual(policy.rules.map((r) => r.text), DEMO_RULES);
});

check("demo rules parse to the documented shapes", () => {
  const [under50, mid, over200, invest, share, personal] = policy.rules;
  assert.equal(under50.kind, "expense");
  assert.deepEqual([under50.minUsd, under50.maxUsd, under50.approvals], [0, 50, 0]);
  assert.equal(mid.minUsd, 50);
  assert.ok(mid.maxUsd > 200 && mid.maxUsd < 200.001); // $200 inclusive
  assert.equal(mid.approvals, 2);
  assert.ok(over200.minUsd > 200 && over200.minUsd < 200.001); // $200 exclusive
  assert.equal(over200.maxUsd, Infinity);
  assert.equal(over200.approvals, 3);
  assert.deepEqual([invest.kind, invest.minUsd, invest.maxUsd, invest.approvals], ["investment", 0, Infinity, 3]);
  assert.deepEqual([share.kind, share.minSharePct, share.approvals], ["any", 30, 4]);
  assert.deepEqual([personal.kind, personal.personal, personal.forbidden], ["withdrawal", true, true]);
  assert.match(describeRule(mid), /\$50–\$200 → 2 approvals/);
});

check("grammar variants", () => {
  const p = parseTreasuryPolicy(
    [
      "Shared expenses less than $1,200: the agent may pay on its own.",
      "Shared expenses between $50.5 and $75: two verified members approve.",
      "Shared expenses above $1,200: 5 members approve.",
      "Shared expenses more than $300: 3 verified members approve.",
      "Shared expenses of any amount: 1 verified member approves.",
      "Withdrawals: not allowed.",
      "Any transfer over $500: 4 verified members approve.",
    ].join("\n")
  );
  // "1 verified member approves" is not the grammar's verb form — reported, not guessed
  assert.deepEqual(p.unparsed, ["Shared expenses of any amount: 1 verified member approves."]);
  const [lt, between, above, moreThan, withdrawals, anyTransfer] = p.rules;
  assert.deepEqual([lt.minUsd, lt.maxUsd], [0, 1200]);
  assert.equal(between.minUsd, 50.5);
  assert.ok(between.maxUsd > 75 && between.maxUsd < 75.001);
  assert.equal(between.approvals, 2);
  assert.ok(above.minUsd > 1200 && above.approvals === 5);
  assert.ok(moreThan.minUsd > 300 && moreThan.maxUsd === Infinity);
  assert.deepEqual([withdrawals.kind, withdrawals.forbidden, withdrawals.minUsd, withdrawals.maxUsd], ["withdrawal", true, 0, Infinity]);
  assert.deepEqual([anyTransfer.kind, anyTransfer.approvals], ["any", 4]);
  assert.ok(anyTransfer.minUsd > 500);

  const anyAmount = parseTreasuryPolicy("Shared expenses of any amount: 2 verified members approve.");
  assert.deepEqual(anyAmount.unparsed, []);
  assert.deepEqual([anyAmount.rules[0].minUsd, anyAmount.rules[0].maxUsd], [0, Infinity]);
});

check("a condition the grammar can't express is reported, not dropped", () => {
  for (const line of [
    "Shared expenses under $50 on weekends: the agent may pay on its own.",
    "Shared expenses under $50: the agent may pay on its own unless Bea objects.",
    "Hotel stuff: 2 verified members approve.",
    "Shared expenses under $50",
    "Shared expenses under $50 and over $10: the agent may pay on its own.",
    "Expenses and investments: 2 verified members approve.",
    "Shared expenses under 50: the agent may pay on its own.",
  ])
    assert.deepEqual(parseTreasuryPolicy(line).unparsed, [line], line);
});

check("a destination the grammar can't read is reported, never dropped (it would widen the rule)", () => {
  for (const line of [
    // dropping "to a member's wallet" would leave "payments under $20: auto" — every expense
    "Payments to a member's wallet under $20: the agent may pay on its own.",
    "Transfers from the treasury to our joint account: the agent may pay on its own.",
    "Sending money to the hotel: 2 verified members approve.",
    "Sending money to members: not allowed.",
  ])
    assert.deepEqual(parseTreasuryPolicy(line).unparsed, [line], line);
  // a member's wallet, said without "personal", is still a member's wallet
  const p = parseTreasuryPolicy(
    [
      "Sending treasury money to a member's wallet: not allowed.",
      "Withdrawals to their own wallet: 4 verified members approve.",
      "Personal wallet withdrawals: not allowed.",
    ].join("\n")
  );
  assert.deepEqual(p.unparsed, []);
  for (const r of p.rules) assert.deepEqual([r.kind, r.personal], ["withdrawal", true], r.text);
  // …so the $180 hotel deposit is not caught by it
  const hotel = ev(parseTreasuryPolicy([...DEMO_RULES.slice(0, 5), "Sending treasury money to a member's wallet: not allowed."].join("\n")), {
    amountUsd: 180,
  });
  assert.equal(hotel.outcome, "approval");
});

check("payees", () => {
  const addr = "0x" + "aB".repeat(20);
  assert.deepEqual(parsePayees(`- Hotel Gracery Shinjuku: ${addr}\nRamen Place: 0x123\n\nnot a payee`), [
    { name: "Hotel Gracery Shinjuku", address: addr },
  ]);
});

// ── policy: evaluation (balance $1,000) ─────────────────────────────────────

check("$30 expense → auto", () => {
  const d = ev(policy, { amountUsd: 30 });
  assert.equal(d.outcome, "auto");
  assert.equal(d.outcome === "auto" && d.rule.text, DEMO_RULES[0]);
});

check("$50 and $200 are the mid band's edges", () => {
  for (const amountUsd of [50, 200]) {
    const d = ev(policy, { amountUsd });
    assert.equal(d.outcome, "approval");
    assert.equal(d.outcome === "approval" && d.required, 2);
  }
});

check("$180 expense → 2 approvals", () => {
  const d = ev(policy, { amountUsd: 180 });
  assert.equal(d.outcome, "approval");
  if (d.outcome !== "approval") return;
  assert.equal(d.required, 2);
  assert.equal(d.rule.text, DEMO_RULES[1]);
  assert.deepEqual(d.applied.map((r) => r.text), [DEMO_RULES[1]]);
});

check("$300 expense → 3; past 30% of the treasury the share rule (4) wins", () => {
  // exactly 30% is not "more than 30%" — only the over-$200 rule applies
  const at = ev(policy, { amountUsd: 300 });
  assert.equal(at.outcome, "approval");
  if (at.outcome !== "approval") return;
  assert.equal(at.required, 3);
  assert.deepEqual(at.applied.map((r) => r.text), [DEMO_RULES[2]]);

  for (const amountUsd of [300.01, 350]) {
    const d = ev(policy, { amountUsd });
    assert.equal(d.outcome, "approval");
    if (d.outcome !== "approval") return;
    assert.equal(d.required, 4);
    assert.equal(d.rule.text, DEMO_RULES[4]);
    assert.deepEqual(d.applied.map((r) => r.text), [DEMO_RULES[2], DEMO_RULES[4]]);
  }
  // $300 against a smaller treasury is well past 30% → 4
  const small = ev(policy, { amountUsd: 300, balanceUsd: 900 });
  assert.equal(small.outcome === "approval" && small.required, 4);
});

check("investing: $300 of $1,000 → 3 (the scenario's investing scene), $400 → 4", () => {
  const a = ev(policy, { kind: "investment", amountUsd: 300 });
  assert.equal(a.outcome === "approval" && a.required, 3);
  assert.equal(a.outcome === "approval" && a.rule.text, DEMO_RULES[3]);
  const b = ev(policy, { kind: "investment", amountUsd: 400 });
  assert.equal(b.outcome === "approval" && b.required, 4);
});

check("$700 withdrawal to my wallet → forbidden, citing the personal-wallet rule", () => {
  const d = ev(policy, { kind: "withdrawal", amountUsd: 700, personal: true });
  assert.equal(d.outcome, "forbidden");
  if (d.outcome !== "forbidden") return;
  assert.equal(d.rule?.text, PERSONAL);
  assert.equal(d.reason, PERSONAL);
  assert.ok(d.applied.some((r) => r.text === DEMO_RULES[4]));
});

check("money to a member's wallet is forbidden whatever verb asked for it", () => {
  const d = ev(policy, { kind: "expense", amountUsd: 30, personal: true });
  assert.equal(d.outcome, "forbidden");
  assert.equal(d.outcome === "forbidden" && d.rule?.text, PERSONAL);
});

check("a withdrawal no rule covers is refused", () => {
  const d = ev(policy, { kind: "withdrawal", amountUsd: 100, personal: false });
  assert.equal(d.outcome, "forbidden");
  assert.equal(d.outcome === "forbidden" && d.rule, null);
  assert.equal(d.outcome === "forbidden" && d.reason, "No rule we agreed on covers this.");
});

check("$1,200 → insufficient", () => {
  const d = ev(policy, { amountUsd: 1200 });
  assert.deepEqual(d, { outcome: "insufficient", balanceUsd: 1000 });
});

check("more than the treasury holds, to my wallet → refused on the rule, not the balance", () => {
  const d = ev(policy, { kind: "withdrawal", amountUsd: 5000, personal: true });
  assert.equal(d.outcome, "forbidden");
  assert.equal(d.outcome === "forbidden" && d.rule?.text, PERSONAL);
});

check("one unparsable line → the whole policy fails closed", () => {
  const broken = parseTreasuryPolicy([...DEMO_RULES, "Bea decides about ramen."].join("\n"));
  assert.deepEqual(broken.unparsed, ["Bea decides about ramen."]);
  const d = ev(broken, { amountUsd: 30 });
  assert.equal(d.outcome, "forbidden");
  if (d.outcome !== "forbidden") return;
  assert.equal(d.rule, null);
  assert.match(d.reason, /^I can't read these treasury rules: "Bea decides about ramen\."; I won't move money until they're fixed\.$/);
});

check("non-positive amounts are refused", () => {
  assert.equal(ev(policy, { amountUsd: 0 }).outcome, "forbidden");
  assert.equal(ev(policy, { amountUsd: Number.NaN }).outcome, "forbidden");
});

// ── matcher ─────────────────────────────────────────────────────────────────

const AGENT = "Tokyo Trip agent";
const m = (text: string) => matchTreasuryCommand(text, AGENT);
const money = (text: string) => {
  const c = m(text);
  assert.ok(c && c.kind !== "status" && c.kind !== "adopt", `expected a money command: ${text}`);
  return c as Exclude<typeof c, { kind: "status" } | { kind: "adopt" } | null>;
};

check("@Tokyo Trip agent pay the hotel deposit, $180", () => {
  const c = money("@Tokyo Trip agent pay the hotel deposit, $180");
  assert.deepEqual(
    { kind: c.kind, amountUsd: c.amountUsd, memo: c.memo, toSelf: c.toSelf, raw: c.raw },
    { kind: "expense", amountUsd: 180, memo: "hotel deposit", toSelf: false, raw: "@Tokyo Trip agent pay the hotel deposit, $180" }
  );
});

check("@agent send $700 to my wallet", () => {
  const c = money("@agent send $700 to my wallet");
  assert.deepEqual([c.kind, c.amountUsd, c.toSelf], ["withdrawal", 700, true]);
});

check("@agent what's our balance?", () => {
  assert.deepEqual(m("@agent what's our balance?"), { kind: "status", raw: "@agent what's our balance?" });
});

check("expense phrasings", () => {
  const cases: [string, number, string][] = [
    ["@agent book the hotel for $180", 180, "hotel"],
    ["@agent please reserve the ramen place for 45 dollars", 45, "ramen place"],
    ["@agent can you buy the train tickets, USD 60?", 60, "train tickets"],
    ["@agent send $180 to Hotel Gracery Shinjuku", 180, "Hotel Gracery Shinjuku"],
    ["@Tokyo Trip agent, pay $1,200 for the hotel from the treasury", 1200, "hotel"],
    ["@agent pay 50.5 usd for snacks", 50.5, "snacks"],
    ["@agent deposit $100 for the hotel", 100, "hotel"],
    ["@agent buy 2 museum tickets for $60", 60, "2 museum tickets"],
    ["@agent pay the $180 hotel deposit", 180, "hotel deposit"],
  ];
  for (const [text, amountUsd, memo] of cases) {
    const c = money(text);
    assert.deepEqual([c.kind, c.amountUsd, c.memo, c.toSelf], ["expense", amountUsd, memo, false], text);
  }
});

check("withdrawals and investments", () => {
  const w = money("@agent withdraw $700");
  assert.deepEqual([w.kind, w.toSelf], ["withdrawal", true]);
  const back = money("@agent send $50 back to me");
  assert.deepEqual([back.kind, back.toSelf, back.amountUsd], ["withdrawal", true, 50]);
  const me = money("@agent give me $700");
  assert.deepEqual([me.kind, me.toSelf], ["withdrawal", true]);
  const inv = money("@agent invest $300 of the idle funds");
  assert.deepEqual([inv.kind, inv.amountUsd, inv.memo, inv.toSelf], ["investment", 300, "idle funds", false]);
});

check("Korean", () => {
  const e = money("@agent 호텔 예약금 180달러 보내줘");
  assert.deepEqual([e.kind, e.amountUsd, e.memo, e.toSelf], ["expense", 180, "호텔 예약금", false]);
  const w = money("@agent 700달러 내 지갑으로 보내줘");
  assert.deepEqual([w.kind, w.amountUsd, w.toSelf], ["withdrawal", 700, true]);
  assert.deepEqual(m("@agent 잔액 알려줘"), { kind: "status", raw: "@agent 잔액 알려줘" });
  assert.equal(m("@agent 어제 호텔에 180달러 냈어"), null);
});

check("status phrasings", () => {
  for (const text of ["@agent treasury status", "@agent how much do we have?", "@Tokyo Trip agent balance?", "@agent what's in the treasury?"])
    assert.equal(m(text)?.kind, "status", text);
});

check("negatives — nothing that isn't an imperative with one clear amount", () => {
  for (const text of [
    "I paid $180 for dinner yesterday",
    "@agent I paid $180 for dinner yesterday",
    "@agent we booked the hotel for $180",
    "@agent paid $180 for the hotel",
    "@agent did you pay $180?",
    "@agent should we pay $180 for the hotel?",
    "@agent don't pay the $180 deposit",
    "@agent pay $180 for the hotel tomorrow",
    "@agent pay $30 if Bea agrees",
    "@agent pay the hotel deposit", // no amount
    "@agent pay the hotel 30% of the treasury", // no USD amount
    "@agent pay $180 of the $300 bill", // two amounts
    "@agent pay $1.2k for the hotel", // a shape we'd have to guess at
    "@agent send $180", // to whom?
    "@agent deposit $100", // in or out?
    "@agent send $100 to the treasury", // money coming in
    "@agent move $300 to savings",
    "@agent what should we do with $300?",
    "@agent remind everyone the hotel is $180",
    "the work-life balance on this trip is great",
    "@Bea pay $30 for snacks",
    "",
    // two payments, even when both are $30 — only overlapping matches are one figure
    "@agent pay $30 for the taxi and $30 for snacks",
    "@agent pay the hotel $180 and the ramen place $180",
    // the figure said is not the total, or not US dollars
    "@agent buy 5 museum tickets at $12 each",
    "@agent pay the hotel $180 per night for 3 nights",
    "@agent pay the hotel 2x $90",
    "@agent pay HK$500 for the hotel",
    "@agent pay the hotel $1 800",
    "@agent pay 180 dollars and 50 cents for the hotel",
    // scheduled
    "@agent pay $180 for the hotel on Friday",
    "@agent pay $40 for the taxi after checkout",
    "@agent pay $40 for the taxi once we land",
  ])
    assert.equal(m(text), null, text);
});

check("amount shapes: a trailing comma is punctuation, a short group is not a number", () => {
  const c = money("@agent pay the hotel $180, thanks");
  assert.deepEqual([c.amountUsd, c.memo], [180, "hotel"]);
  assert.equal(money("@agent pay the hotel deposit, $1,800, thanks").amountUsd, 1800);
  assert.equal(money("@agent pay $180 dollars for the hotel").amountUsd, 180);
  assert.equal(money("@agent pay $40 for the taxi at once").amountUsd, 40);
  for (const text of ["@agent pay the hotel $1,20", "@agent pay $180.505 for the hotel", "@agent pay the hotel $1,2000"])
    assert.equal(m(text), null, text);
});

check("adopt, and money sentences the matcher can't read", () => {
  for (const text of ["@agent adopt the new rules", "@agent adopt the rules", "@Tokyo Trip agent please adopt the edited rules.", "@agent adopt the new members"])
    assert.deepEqual(m(text), { kind: "adopt", raw: text }, text);
  assert.equal(m("@agent don't adopt the rules"), null);
  // not read, but about money: answered with "nothing was moved", never by the model
  for (const text of ["@agent can we pay the hotel $180", "@agent I paid $180 for dinner yesterday", "@agent pay the hotel $1.2k"])
    assert.ok(m(text) === null && mentionsMoney(text, AGENT), text);
  for (const text of ["@agent what should we do with $300?", "@agent what's our balance?", "@agent pay the hotel deposit"])
    assert.ok(!mentionsMoney(text, AGENT), text);
});

console.log(`treasury selftest: ${passed} checks passed`);
