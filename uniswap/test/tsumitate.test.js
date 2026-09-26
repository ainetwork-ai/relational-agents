import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { fileLedger } from "../src/ledger/file.js";
import { mandateTypedData } from "../src/mandate/typedData.js";
import { runOnce } from "../src/tsumitate.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const agent = { address: "0x1111111111111111111111111111111111111111" };
const chain = { chainId: 8453, tokens: { USDC: { address: USDC, decimals: 6 }, WETH: { address: WETH, decimals: 18 } } };
const grandmother = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"); // anvil #4

// Every fixture carries a real signature over its own eleven fields, because `runOnce` recovers it
// before it does anything else: a made-up `ref` would be refused as approval-invalid and no test
// below would ever reach what it is about. `terms` is the unsigned half, for tests that need to
// sign one thing and store another.
const terms = (over = {}) => ({ id: "m-1", roomId: "r", agent: agent.address, kind: "standing",
  tokenIn: USDC, tokenOut: WETH, perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week",
  expiresAt: 1798761600, nonce: 1, ...over });
const approvalOf = async (m) => ({ method: "wallet-signature", subject: grandmother.address,
  verifiedAt: 1, ref: await grandmother.signTypedData(mandateTypedData(m, chain.chainId)) });
const mandate = async (over = {}) => { const m = terms(over); return { ...m, approval: await approvalOf(m) }; };

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
const revertingSwap = (thrown) => { const s = fakeSwap(); return { ...s,
  execute: async () => { s.calls.execute++; throw thrown; } }; };

const fresh = () => fileLedger(join(mkdtempSync(join(tmpdir(), "tsumitate-")), "passbook.json"));
const raw = (ledger) => JSON.parse(readFileSync(ledger.path, "utf8"));
const friday = new Date("2026-09-25T09:00:00Z"), saturday = new Date("2026-09-26T09:00:00Z"), nextMonday = new Date("2026-09-28T09:00:00Z");

test("first run of the week buys the per-run amount and records it", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate()); const swap = fakeSwap();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.equal(r.outcome, "bought"); assert.equal(r.periodKey, "2026-W39");
  assert.equal(r.receipt.amountIn, 20_000_000n);
  const v = await ledger.view();
  assert.deepEqual(v.boughtPeriods, { "m-1": ["2026-W39"] });
  assert.equal(swap.calls.execute, 1);
  const entry = raw(ledger).entries.at(-1);
  assert.equal(entry.kind, "buy");
  assert.equal(entry.txHash, "0x" + "ab".repeat(32), "the family's receipt is the tx hash");
  assert.equal(typeof entry.price, "number", "price stays a number on disk, not a bigint string");
  assert.equal(entry.who, agent.address);
  assert.equal(entry.at, friday.toISOString());
});

test("second run in the same week skips without quoting; next week buys again", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate()); const swap = fakeSwap();
  await runOnce({ ledger, swap, account: agent, chain, now: friday });
  const again = await runOnce({ ledger, swap, account: agent, chain, now: saturday });
  assert.deepEqual(again, { outcome: "skipped", reason: "period-already-bought", periodKey: "2026-W39" });
  assert.equal(swap.calls.quote, 1, "a refused run must not ask for a quote");
  const next = await runOnce({ ledger, swap, account: agent, chain, now: nextMonday });
  assert.equal(next.outcome, "bought"); assert.equal(next.periodKey, "2026-W40");
});

test("a revoked mandate skips and the skip is in the passbook with its reason", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate()); await ledger.revoke("m-1", 1758700000);
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.equal(r.reason, "revoked");
  assert.equal(raw(ledger).entries.at(-1).kind, "skip"); assert.equal(raw(ledger).entries.at(-1).reason, "revoked");
});

// Re-signing is the normal end of a mandate's life — a revoke during a rehearsal, an expiry after
// 90 days — and the replacement is appended after the one it replaces. Choosing the first standing
// mandate in the file therefore refused every run from then on, with no CLI path back: there is no
// delete command and `addMandate` refuses a duplicate id.
test("a revoked mandate does not hide the one signed to replace it", async () => {
  const ledger = fresh();
  await ledger.addMandate(await mandate());
  await ledger.revoke("m-1", 1758700000);
  await ledger.addMandate(await mandate({ id: "m-2", nonce: 2 }));
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.equal(r.outcome, "bought");
  assert.equal(raw(ledger).entries.at(-1).mandateId, "m-2");
});

test("an expired mandate does not hide the one signed to replace it", async () => {
  const ledger = fresh();
  await ledger.addMandate(await mandate({ id: "m-old", expiresAt: 1758000000 }));   // before `friday`
  await ledger.addMandate(await mandate({ id: "m-new", nonce: 2 }));
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.equal(r.outcome, "bought");
  assert.equal(raw(ledger).entries.at(-1).mandateId, "m-new");
});

// Order in the file is not age: `addMandate` appends, but a family can sign two mandates in either
// order and the passbook is hand-editable. `nonce` is the signed field that says which is newer.
test("among live mandates the newest nonce wins, whatever the file order", async () => {
  const ledger = fresh();
  await ledger.addMandate(await mandate({ id: "m-early", nonce: 2 }));
  await ledger.addMandate(await mandate({ id: "m-late", nonce: 9 }));
  await ledger.addMandate(await mandate({ id: "m-middle", nonce: 5 }));
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.equal(r.outcome, "bought");
  assert.equal(raw(ledger).entries.at(-1).mandateId, "m-late");
});

// When nothing is live the refusal must still name the state the family is looking at, so a run
// after a revoke reads "revoked" rather than "no-mandate" — the same line the CLI's revoke promised.
test("with no live mandate the newest dead one supplies the reason", async () => {
  const ledger = fresh();
  await ledger.addMandate(await mandate({ id: "m-1", expiresAt: 1758000000 }));
  await ledger.addMandate(await mandate({ id: "m-2", nonce: 2 }));
  await ledger.revoke("m-2", 1758700000);
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.equal(r.outcome, "skipped"); assert.equal(r.reason, "revoked");
  assert.equal(raw(ledger).entries.at(-1).mandateId, "m-2");
});

// The signature is the whole of "the family allowed this", and the file holding it is written by
// this agent's own process. A stored approval is therefore recovered again at run time, not read
// as a flag: terms edited after signing are refused before a quote is asked for.
test("an approval that does not verify is a recorded refusal, not a buy", async () => {
  const ledger = fresh();
  const signed = await mandate();
  await ledger.addMandate({ ...signed, perRunCap: 50_000_000n });   // the signature stayed behind
  const swap = fakeSwap();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.deepEqual(r, { outcome: "skipped", reason: "approval-invalid", periodKey: "2026-W39" });
  assert.equal(swap.calls.quote, 0, "nothing is quoted under a mandate that does not verify");
  const last = raw(ledger).entries.at(-1);
  assert.equal(last.kind, "skip"); assert.equal(last.reason, "approval-invalid");
  assert.equal(last.mandateId, "m-1");
});

test("no mandate for this agent → no-mandate, nothing recorded", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate({ agent: "0x2222222222222222222222222222222222222222" }));
  const swap = fakeSwap();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.deepEqual(r, { outcome: "no-mandate" });
  assert.deepEqual(raw(ledger).entries, [], "a run that found no mandate decided nothing to write");
  assert.equal(swap.calls.quote, 0);
});

test("a mandate id names a mandate, not a permission: another agent's is no-mandate", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate({ agent: "0x2222222222222222222222222222222222222222" }));
  const swap = fakeSwap();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday, mandateId: "m-1" });
  assert.deepEqual(r, { outcome: "no-mandate" });
  assert.deepEqual(raw(ledger).entries, [], "spending under someone else's mandate must leave no line either");
  assert.equal(swap.calls.quote, 0);
});

test("a mandate id picks that mandate, not the first standing one", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate()); await ledger.addMandate(await mandate({ id: "m-2" }));
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday, mandateId: "m-2" });
  assert.equal(r.outcome, "bought");
  assert.equal(raw(ledger).entries.at(-1).mandateId, "m-2");
  assert.deepEqual((await ledger.view()).boughtPeriods, { "m-2": ["2026-W39"] });
});

test("agent matching is case-insensitive on both paths (a chain hands back lowercase)", async () => {
  const mixed = { address: "0xaBcDeF0123456789aBcDeF0123456789aBcDeF01" };
  const stored = await mandate({ agent: mixed.address.toLowerCase() });
  const scanned = fresh(); await scanned.addMandate(stored);
  const byScan = await runOnce({ ledger: scanned, swap: fakeSwap(), account: mixed, chain, now: friday });
  assert.equal(byScan.outcome, "bought", "the agent scan must not compare hex case");
  const named = fresh(); await named.addMandate(stored);
  const byId = await runOnce({ ledger: named, swap: fakeSwap(), account: mixed, chain, now: friday, mandateId: "m-1" });
  assert.equal(byId.outcome, "bought", "the owner check must not compare hex case either");
});

test("the buy entry says where the decision came from", async () => {
  const standing = fresh(); await standing.addMandate(await mandate());
  await runOnce({ ledger: standing, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.equal(raw(standing).entries.at(-1).decisionOrigin, "autonomous");
  const oneoff = fresh(); await oneoff.addMandate(await mandate({ id: "m-2", kind: "oneoff" }));
  await runOnce({ ledger: oneoff, swap: fakeSwap(), account: agent, chain, now: friday, mandateId: "m-2" });
  assert.equal(raw(oneoff).entries.at(-1).decisionOrigin, "human_mediated");
});

test("a dry pool is a recorded skip, not a zero-amount buy", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate()); const swap = dryPool();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.deepEqual(r, { outcome: "skipped", reason: "no-liquidity", periodKey: "2026-W39" });
  assert.equal(swap.calls.execute, 0, "nothing may be signed against an empty quote");
  const last = raw(ledger).entries.at(-1);
  assert.equal(last.kind, "skip"); assert.equal(last.reason, "no-liquidity");
  assert.deepEqual((await ledger.view()).boughtPeriods, {}, "a skip must not consume the week");
});

test("a swap that throws is an outcome: skipped, with the error in the passbook", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate());
  const r = await runOnce({ ledger, swap: revertingSwap(new Error("router reverted")), account: agent, chain, now: friday });
  assert.equal(r.outcome, "skipped"); assert.equal(r.reason, "swap-failed");
  assert.equal(r.periodKey, "2026-W39"); assert.equal(r.error, "router reverted");
  const last = raw(ledger).entries.at(-1);
  assert.equal(last.kind, "skip");
  assert.ok(last.reason.startsWith("swap-failed:"), `the passbook reason was "${last.reason}"`);
  assert.ok(last.reason.includes("router reverted"), "the family reads why, not just that");
  assert.deepEqual((await ledger.view()).boughtPeriods, {}, "a failed swap leaves the week open to retry");
});

test("a quote that throws is an outcome too, and nothing is signed", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate());
  const swap = { quote: async () => { throw new Error("rpc down"); },
    execute: async () => { throw new Error("execute must not be reached"); } };
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.equal(r.outcome, "skipped"); assert.equal(r.reason, "swap-failed"); assert.equal(r.error, "rpc down");
  assert.equal(raw(ledger).entries.at(-1).reason, "swap-failed: rpc down");
});

test("a swap failure is recorded without the RPC secrets viem puts in err.message", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate());
  // The shape viem's HttpRequestError has: shortMessage is safe, message carries the URL and body.
  const leaky = { shortMessage: "HTTP request failed.",
    message: "HTTP request failed.\nURL: https://rpc.example/v2/SECRET_KEY_123\nRequest body: {}" };
  const r = await runOnce({ ledger, swap: revertingSwap(leaky), account: agent, chain, now: friday });
  const last = raw(ledger).entries.at(-1);
  assert.match(last.reason, /HTTP request failed\./, "the family still reads why");
  assert.ok(!last.reason.includes("SECRET"), `the passbook reason was "${last.reason}"`);
  assert.ok(!JSON.stringify(r).includes("SECRET"), "and the returned result must not carry it either");
  assert.equal(r.reason, "swap-failed");
});

test("a non-Error throw still reads as a reason, not as undefined", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate());
  const r = await runOnce({ ledger, swap: revertingSwap("boom"), account: agent, chain, now: friday });
  assert.equal(raw(ledger).entries.at(-1).reason, "swap-failed: boom");
  assert.equal(r.error, "boom");
});

test("a swap that failed after broadcast carries its tx hash into the passbook", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate());
  const txHash = "0x" + "cd".repeat(32);
  const err = new Error("swap credited no WETH to the recipient"); err.txHash = txHash;
  const r = await runOnce({ ledger, swap: revertingSwap(err), account: agent, chain, now: friday });
  const last = raw(ledger).entries.at(-1);
  assert.equal(last.kind, "skip"); assert.equal(last.txHash, txHash, "money may have moved — name the transaction");
  assert.equal(r.txHash, txHash);
  assert.deepEqual((await ledger.view()).boughtPeriods, {}, "and the period is still not marked bought");
});

test("a malformed mandate is an error, not an outcome: it propagates and writes nothing", async () => {
  const ledger = fresh(); await ledger.addMandate(await mandate({ kind: "one-off" }));
  await assert.rejects(
    () => runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday, mandateId: "m-1" }),
    /unknown mandate kind "one-off"/);
  assert.deepEqual(raw(ledger).entries, []);
});
