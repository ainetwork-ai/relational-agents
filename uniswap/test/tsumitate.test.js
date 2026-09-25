import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
const fresh = () => fileLedger(join(mkdtempSync(join(tmpdir(), "tsumitate-")), "passbook.json"));
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
  const raw = JSON.parse((await import("node:fs")).readFileSync(ledger.path, "utf8"));
  assert.equal(raw.entries.at(-1).kind, "skip"); assert.equal(raw.entries.at(-1).reason, "revoked");
});

test("no mandate for this agent → no-mandate, nothing recorded", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate({ agent: "0x2222222222222222222222222222222222222222" }));
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.deepEqual(r, { outcome: "no-mandate" });
});
