import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { mandateTypedData } from "../src/mandate/typedData.js";
import { verifyApproval } from "../src/mandate/verifyApproval.js";

const grandmother = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"); // anvil #4
const CHAIN_ID = 8453;

const terms = (over = {}) => ({
  id: "m-1", roomId: "room-tanaka", agent: "0x000000000000000000000000000000000000dEaD", kind: "standing",
  tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  tokenOut: "0x4200000000000000000000000000000000000006",
  perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week",
  expiresAt: 1798761600, nonce: 1, ...over,
});
const signedBy = async (signer, m) => ({
  method: "wallet-signature", subject: signer.address, verifiedAt: 1758700000,
  ref: await signer.signTypedData(mandateTypedData(m, CHAIN_ID)),
});

test("a mandate whose signature recovers to its own subject verifies", async () => {
  const m = terms();
  assert.equal(await verifyApproval({ ...m, approval: await signedBy(grandmother, m) }, CHAIN_ID), true);
});

// The passbook is a plain file this agent's own process writes, so these are the shapes that make
// "the family signed this" false while `if (!m.approval)` still reads it as true.
test("an approval that does not verify is refused", async () => {
  const m = terms();
  const real = await signedBy(grandmother, m);

  const overCap = await signedBy(grandmother, terms({ perRunCap: 50_000_000n }));
  assert.equal(await verifyApproval({ ...m, approval: { ...real, ref: overCap.ref } }, CHAIN_ID), false,
    "a signature over terms the family never agreed to is not this mandate's approval");
  assert.equal(await verifyApproval({ ...m, approval: { ...real, ref: "0xsig" } }, CHAIN_ID), false,
    "a ref that is not a signature recovers nothing");
  assert.equal(await verifyApproval({ ...m, approval: { ...real, subject: grandmother.address.replace(/.$/, "0") } }, CHAIN_ID), false,
    "the subject named must be the address that signed");
  assert.equal(await verifyApproval({ ...m, approval: {} }, CHAIN_ID), false, "an empty approval approves nothing");
  assert.equal(await verifyApproval({ ...m, approval: true }, CHAIN_ID), false, "nor does a bare truthy flag");
  assert.equal(await verifyApproval(m, CHAIN_ID), false, "nor does an absent one");
});

// Another method (a World ID step-up, say) plugs in by writing the same field. Until this package
// knows how to check it, it is not an approval — unknown must not read as approved.
test("a method this slice cannot check is refused, not trusted", async () => {
  const m = terms();
  const real = await signedBy(grandmother, m);
  assert.equal(await verifyApproval({ ...m, approval: { ...real, method: "world-id" } }, CHAIN_ID), false);
  assert.equal(await verifyApproval({ ...m, approval: { ...real, method: undefined } }, CHAIN_ID), false);
});

// The subject is compared as an address, so the case a wallet or a chain happens to hand back
// must not decide whether the family's own mandate is honoured.
test("the subject comparison does not compare hex case", async () => {
  const m = terms();
  const real = await signedBy(grandmother, m);
  assert.equal(await verifyApproval({ ...m, approval: { ...real, subject: real.subject.toLowerCase() } }, CHAIN_ID), true);
});
