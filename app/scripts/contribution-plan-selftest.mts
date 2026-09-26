// The pure rules of members' recurring contributions (contribution-plan.ts): the plan id the app
// derives matches the contract's, and what each period of a plan shows.
//   cd app && npx tsx --tsconfig scripts/tsconfig.json scripts/contribution-plan-selftest.mts
import assert from "node:assert/strict";
import { stringToHex } from "viem";
import {
  CONTRIBUTION_CHAIN,
  contributionPlanId,
  contributionSalt,
  isDue,
  periodCount,
  periodStates,
  type PlanOnChain,
} from "@/lib/agent/treasury/contribution-plan";

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

const WEEK = 7 * 24 * 3600;
const T0 = 1_790_451_053; // the mainnet plan's startedAt
const plan = (over: Partial<PlanOnChain> = {}): PlanOnChain => ({
  member: "0xD063Ad19b315d0BDAA152E44269fce32A976E9e0",
  pot: "0xe03F48C1a42868707bAa9202991eCEb8BC34Cf2a",
  token: CONTRIBUTION_CHAIN.usdc,
  amountPerPeriod: BigInt(100_000),
  period: WEEK,
  startedAt: T0,
  until: T0 + 3 * WEEK - 68,
  stoppedAt: 0,
  pulled: BigInt(0),
  ...over,
});

check("the plan id is the contract's: the mainnet plan started with salt \"tokyo-trip\"", () => {
  const p = plan();
  const salt = stringToHex("tokyo-trip", { size: 32 });
  assert.equal(contributionPlanId(p.member, p.pot, p.token, salt), "0xe413603acb09c3e580f17f4bf87be03f685447f0bb65c369c7a6e637767f4b91");
});

check("the app's salt names the room member, and differs per room and per member", () => {
  const a = contributionSalt("room-1", "user-a");
  assert.notEqual(a, contributionSalt("room-1", "user-b"));
  assert.notEqual(a, contributionSalt("room-2", "user-a"));
  assert.equal(a, contributionSalt("room-1", "user-a"));
});

check("a member's next salts differ from the first, and the first is the one plans already carry", () => {
  const first = contributionSalt("room-1", "user-a");
  assert.equal(contributionSalt("room-1", "user-a", 0), first);
  assert.notEqual(contributionSalt("room-1", "user-a", 1), first);
  assert.notEqual(contributionSalt("room-1", "user-a", 1), contributionSalt("room-1", "user-a", 2));
});

check("three weeks less a minute is three periods; the last one is short", () => {
  assert.equal(periodCount(plan()), 3);
  assert.equal(periodCount(plan({ until: T0 + 3 * WEEK })), 3);
  assert.equal(periodCount(plan({ until: T0 + 3 * WEEK + 1 })), 4);
});

check("period states: collected, due, upcoming — then missed once a period ends unpulled", () => {
  const p = plan({ pulled: BigInt(1) });
  assert.deepEqual(periodStates(p, T0 + 60).map((v) => v.state), ["collected", "upcoming", "upcoming"]);
  assert.deepEqual(periodStates(p, T0 + WEEK + 60).map((v) => v.state), ["collected", "due", "upcoming"]);
  assert.deepEqual(periodStates(p, T0 + 2 * WEEK + 60).map((v) => v.state), ["collected", "missed", "due"]);
  assert.deepEqual(periodStates(p, T0 + 4 * WEEK).map((v) => v.state), ["collected", "missed", "missed"]);
  assert.equal(periodStates(p, T0).at(1)?.startsAt, T0 + WEEK);
});

check("a stop: periods not pulled before it ended are stopped, not missed", () => {
  const p = plan({ pulled: BigInt(1), stoppedAt: T0 + WEEK + 3600 });
  assert.deepEqual(periodStates(p, T0 + 4 * WEEK).map((v) => v.state), ["collected", "stopped", "stopped"]);
  assert.equal(isDue(p, T0 + WEEK + 7200), false);
});

check("due: running, before its end, this period not pulled", () => {
  assert.equal(isDue(plan(), T0 + 60), true);
  assert.equal(isDue(plan({ pulled: BigInt(1) }), T0 + 60), false);
  assert.equal(isDue(plan({ pulled: BigInt(1) }), T0 + WEEK), true);
  assert.equal(isDue(plan(), T0 + 3 * WEEK), false, "ended");
});

console.log(`contribution-plan-selftest: ${passed} checks passed`);
