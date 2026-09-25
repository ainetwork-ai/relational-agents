import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLedger } from "../src/ledger/file.js";
import { runOnce } from "../src/tsumitate.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const agent = { address: "0x1111111111111111111111111111111111111111" };
const chain = { chainId: 8453, tokens: { USDC: { address: USDC, decimals: 6 }, WETH: { address: WETH, decimals: 18 } } };
const approved = { method: "wallet-signature", subject: "0xgrandmother", verifiedAt: 1, ref: "0xsig" };
const mandate = (over = {}) => ({ id: "m-1", roomId: "r", agent: agent.address, kind: "standing",
  tokenIn: USDC, tokenOut: WETH, perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week",
  expiresAt: 1798761600, nonce: 1, approval: approved, ...over });

// A swap provider that never touches a chain: 1 USDC → 0.0004 WETH, always fills the quote.
const fakeSwap = () => {
  const calls = { quote: 0, execute: 0 };
  return { calls,
    quote: async (i) => { calls.quote++; return { provider: "fake", amountIn: i.amountIn, amountOutExpected: i.amountIn * 400_000_000n, route: "fake", raw: null, intent: i }; },
    execute: async (q) => { calls.execute++; return { txHash: "0x" + "ab".repeat(32), amountIn: q.amountIn, amountOut: q.amountOutExpected, price: 2500, route: "fake", provider: "fake" }; } };
};
// The same provider with one thing wrong — the branches that are not the happy path.
const dryPool = () => { const s = fakeSwap(); return { ...s,
  quote: async (i) => { s.calls.quote++; return { provider: "fake", amountIn: i.amountIn, amountOutExpected: 0n, route: "fake", raw: null, intent: i }; } }; };
const revertingSwap = (message) => { const s = fakeSwap(); return { ...s,
  execute: async () => { s.calls.execute++; throw new Error(message); } }; };

const fresh = () => fileLedger(join(mkdtempSync(join(tmpdir(), "tsumitate-")), "passbook.json"));
const raw = (ledger) => JSON.parse(readFileSync(ledger.path, "utf8"));
const friday = new Date("2026-09-25T09:00:00Z"), saturday = new Date("2026-09-26T09:00:00Z"), nextMonday = new Date("2026-09-28T09:00:00Z");

test("first run of the week buys the per-run amount and records it", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate()); const swap = fakeSwap();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.equal(r.outcome, "bought"); assert.equal(r.periodKey, "2026-W39");
  assert.equal(r.receipt.amountIn, 20_000_000n);
  const v = await ledger.view();
  assert.deepEqual(v.boughtPeriods, { "m-1": ["2026-W39"] });
  assert.equal(swap.calls.execute, 1);
});

test("second run in the same week skips without quoting; next week buys again", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate()); const swap = fakeSwap();
  await runOnce({ ledger, swap, account: agent, chain, now: friday });
  const again = await runOnce({ ledger, swap, account: agent, chain, now: saturday });
  assert.deepEqual(again, { outcome: "skipped", reason: "period-already-bought", periodKey: "2026-W39" });
  assert.equal(swap.calls.quote, 1, "a refused run must not ask for a quote");
  const next = await runOnce({ ledger, swap, account: agent, chain, now: nextMonday });
  assert.equal(next.outcome, "bought"); assert.equal(next.periodKey, "2026-W40");
});

test("a revoked mandate skips and the skip is in the passbook with its reason", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate()); await ledger.revoke("m-1", 1758700000);
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.equal(r.reason, "revoked");
  assert.equal(raw(ledger).entries.at(-1).kind, "skip"); assert.equal(raw(ledger).entries.at(-1).reason, "revoked");
});

test("no mandate for this agent → no-mandate, nothing recorded", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate({ agent: "0x2222222222222222222222222222222222222222" }));
  const swap = fakeSwap();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.deepEqual(r, { outcome: "no-mandate" });
  assert.deepEqual(raw(ledger).entries, [], "a run that found no mandate decided nothing to write");
  assert.equal(swap.calls.quote, 0);
});

test("a mandate id names a mandate, not a permission: another agent's is no-mandate", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate({ agent: "0x2222222222222222222222222222222222222222" }));
  const swap = fakeSwap();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday, mandateId: "m-1" });
  assert.deepEqual(r, { outcome: "no-mandate" });
  assert.deepEqual(raw(ledger).entries, [], "spending under someone else's mandate must leave no line either");
  assert.equal(swap.calls.quote, 0);
});

test("a mandate id picks that mandate, not the first standing one", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate()); await ledger.addMandate(mandate({ id: "m-2" }));
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday, mandateId: "m-2" });
  assert.equal(r.outcome, "bought");
  assert.equal(raw(ledger).entries.at(-1).mandateId, "m-2");
  assert.deepEqual((await ledger.view()).boughtPeriods, { "m-2": ["2026-W39"] });
});

test("agent matching is case-insensitive on both paths (a chain hands back lowercase)", async () => {
  const mixed = { address: "0xaBcDeF0123456789aBcDeF0123456789aBcDeF01" };
  const stored = mandate({ agent: mixed.address.toLowerCase() });
  const scanned = fresh(); await scanned.addMandate(stored);
  const byScan = await runOnce({ ledger: scanned, swap: fakeSwap(), account: mixed, chain, now: friday });
  assert.equal(byScan.outcome, "bought", "the agent scan must not compare hex case");
  const named = fresh(); await named.addMandate(stored);
  const byId = await runOnce({ ledger: named, swap: fakeSwap(), account: mixed, chain, now: friday, mandateId: "m-1" });
  assert.equal(byId.outcome, "bought", "the owner check must not compare hex case either");
});

test("the buy entry says where the decision came from", async () => {
  const standing = fresh(); await standing.addMandate(mandate());
  await runOnce({ ledger: standing, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.equal(raw(standing).entries.at(-1).decisionOrigin, "autonomous");
  const oneoff = fresh(); await oneoff.addMandate(mandate({ id: "m-2", kind: "oneoff" }));
  await runOnce({ ledger: oneoff, swap: fakeSwap(), account: agent, chain, now: friday, mandateId: "m-2" });
  assert.equal(raw(oneoff).entries.at(-1).decisionOrigin, "human_mediated");
});

test("a dry pool is a recorded skip, not a zero-amount buy", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate()); const swap = dryPool();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.deepEqual(r, { outcome: "skipped", reason: "no-liquidity", periodKey: "2026-W39" });
  assert.equal(swap.calls.execute, 0, "nothing may be signed against an empty quote");
  const last = raw(ledger).entries.at(-1);
  assert.equal(last.kind, "skip"); assert.equal(last.reason, "no-liquidity");
  assert.deepEqual((await ledger.view()).boughtPeriods, {}, "a skip must not consume the week");
});

test("a swap that throws is an outcome: skipped, with the error in the passbook", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate());
  const r = await runOnce({ ledger, swap: revertingSwap("router reverted"), account: agent, chain, now: friday });
  assert.equal(r.outcome, "skipped"); assert.equal(r.reason, "swap-failed");
  assert.equal(r.periodKey, "2026-W39"); assert.equal(r.error, "router reverted");
  const last = raw(ledger).entries.at(-1);
  assert.equal(last.kind, "skip");
  assert.ok(last.reason.startsWith("swap-failed:"), `the passbook reason was "${last.reason}"`);
  assert.ok(last.reason.includes("router reverted"), "the family reads why, not just that");
  assert.deepEqual((await ledger.view()).boughtPeriods, {}, "a failed swap leaves the week open to retry");
});

test("a quote that throws is an outcome too, and nothing is signed", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate());
  const swap = { quote: async () => { throw new Error("rpc down"); },
    execute: async () => { throw new Error("execute must not be reached"); } };
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.equal(r.outcome, "skipped"); assert.equal(r.reason, "swap-failed"); assert.equal(r.error, "rpc down");
  assert.equal(raw(ledger).entries.at(-1).reason, "swap-failed: rpc down");
});

test("a malformed mandate is an error, not an outcome: it propagates and writes nothing", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate({ kind: "one-off" }));
  await assert.rejects(
    () => runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday, mandateId: "m-1" }),
    /unknown mandate kind "one-off"/);
  assert.deepEqual(raw(ledger).entries, []);
});
