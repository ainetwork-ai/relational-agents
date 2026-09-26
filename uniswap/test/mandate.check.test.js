import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMandate } from "../src/mandate/check.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const now = new Date("2026-09-25T09:00:00Z");           // 2026-W39
const approved = { method: "wallet-signature", subject: "0xabc", verifiedAt: 1758700000, ref: "0xsig" };

const mandate = (over = {}) => ({
  id: "m-1", roomId: "r", agent: "0xagent", kind: "standing", tokenIn: USDC, tokenOut: WETH,
  perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week",
  expiresAt: 1798761600, nonce: 1, approval: approved, ...over,
});
const emptyView = () => ({ spentByPeriod: {}, boughtPeriods: {} });
const intent = (amountIn = 20_000_000n, over = {}) => ({ tokenIn: USDC, tokenOut: WETH, amountIn, ...over });

test("standing mandate inside every limit → ok, autonomous, keyed to the ISO week", () => {
  const r = checkMandate(mandate(), emptyView(), intent(), now);
  assert.deepEqual(r, { ok: true, decisionOrigin: "autonomous", periodKey: "2026-W39" });
});

test("one-off mandate → human_mediated", () => {
  const r = checkMandate(mandate({ kind: "oneoff" }), emptyView(), intent(), now);
  assert.equal(r.ok, true); assert.equal(r.decisionOrigin, "human_mediated");
});

test("refusals, in the documented order", () => {
  assert.equal(checkMandate(mandate({ revokedAt: 1 }), emptyView(), intent(), now).reason, "revoked");
  assert.equal(checkMandate(mandate({ expiresAt: 1 }), emptyView(), intent(), now).reason, "expired");
  assert.equal(checkMandate(mandate({ approval: undefined }), emptyView(), intent(), now).reason, "unapproved");
  assert.equal(checkMandate(mandate(), emptyView(), intent(20_000_000n, { tokenOut: USDC }), now).reason, "pair-not-allowed");
  // Both halves of the allowlist, or only one of them is held: with `tokenOut` alone asserted, the
  // `tokenIn` comparison can be deleted and every test still passes.
  assert.equal(checkMandate(mandate(), emptyView(), intent(20_000_000n, { tokenIn: WETH }), now).reason, "pair-not-allowed");
  assert.equal(checkMandate(mandate(), emptyView(), intent(50_000_000n), now).reason, "over-per-run-cap");
  const nearCap = { spentByPeriod: { "m-1": { "2026-W39": 90_000_000n } }, boughtPeriods: {} };
  assert.equal(checkMandate(mandate(), nearCap, intent(), now).reason, "over-per-period-cap");
  const bought = { spentByPeriod: {}, boughtPeriods: { "m-1": ["2026-W39"] } };
  assert.equal(checkMandate(mandate(), bought, intent(), now).reason, "period-already-bought");
});

test("a one-off mandate may run in a period that already had a standing buy", () => {
  const bought = { spentByPeriod: {}, boughtPeriods: { "m-1": ["2026-W39"] } };
  assert.equal(checkMandate(mandate({ kind: "oneoff" }), bought, intent(), now).ok, true);
});

test("a revoked mandate reports revoked even if also expired", () => {
  assert.equal(checkMandate(mandate({ revokedAt: 1, expiresAt: 1 }), emptyView(), intent(), now).reason, "revoked");
});

// Each case above carries a single defect, so it cannot tell the order apart from the set.
// These stack two defects per assertion — one per adjacent pair — so swapping any two
// neighbouring checks in check.js changes an answer here.
test("refusal order is fixed: each adjacent pair reports the earlier reason", () => {
  const wrongPair = { tokenOut: USDC };
  const boughtNearCap = { spentByPeriod: { "m-1": { "2026-W39": 90_000_000n } }, boughtPeriods: { "m-1": ["2026-W39"] } };
  assert.equal(checkMandate(mandate({ revokedAt: 1, expiresAt: 1 }), emptyView(), intent(), now).reason, "revoked");
  assert.equal(checkMandate(mandate({ expiresAt: 1, approval: undefined }), emptyView(), intent(), now).reason, "expired");
  assert.equal(checkMandate(mandate({ approval: undefined }), emptyView(), intent(20_000_000n, wrongPair), now).reason, "unapproved");
  assert.equal(checkMandate(mandate(), emptyView(), intent(50_000_000n, wrongPair), now).reason, "pair-not-allowed");
  assert.equal(checkMandate(mandate(), emptyView(), intent(150_000_000n), now).reason, "over-per-run-cap");
  assert.equal(checkMandate(mandate(), boughtNearCap, intent(), now).reason, "over-per-period-cap");
});

test("an unknown kind throws instead of taking the permissive branch", () => {
  assert.throws(() => checkMandate(mandate({ kind: "one-off" }), emptyView(), intent(), now), /unknown mandate kind/);
});

test("token comparison is case-insensitive (chain-returned addresses are often lowercase)", () => {
  const lower = USDC.toLowerCase(), upper = USDC.toUpperCase().replace("0X", "0x");
  assert.equal(checkMandate(mandate(), emptyView(), intent(20_000_000n, { tokenIn: lower }), now).ok, true);
  assert.equal(checkMandate(mandate(), emptyView(), intent(20_000_000n, { tokenIn: upper }), now).ok, true);
  // WETH's address is all digits, so varying its case is a no-op: to exercise the tokenOut
  // comparison the pair has to run the other way, with the lettered token on the out side.
  const selling = { tokenIn: WETH, tokenOut: USDC };
  assert.equal(checkMandate(mandate(selling), emptyView(), intent(20_000_000n, { ...selling, tokenOut: lower }), now).ok, true);
});

test("a cap includes its boundary; expiry excludes its second", () => {
  const atCap = { spentByPeriod: { "m-1": { "2026-W39": 80_000_000n } }, boughtPeriods: {} };
  assert.equal(checkMandate(mandate(), atCap, intent(), now).ok, true);
  assert.equal(checkMandate(mandate({ expiresAt: Math.floor(now.getTime() / 1000) }), emptyView(), intent(), now).reason, "expired");
});
