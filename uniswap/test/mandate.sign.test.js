import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData, keccak256, toHex } from "viem";
import { mandateTypedData, SPEND_MANDATE_TYPES } from "../src/mandate/typedData.js";
import { recoverMandateSigner } from "../src/mandate/verify.js";

const grandmother = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"); // anvil #4
const CHAIN_ID = 8453;

export const sampleMandate = () => ({
  id: "m-1", roomId: "room-tanaka", agent: "0x000000000000000000000000000000000000dEaD",
  kind: "standing",
  tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  tokenOut: "0x4200000000000000000000000000000000000006",
  perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week",
  expiresAt: 1798761600, nonce: 1,
});

test("a mandate signed by the grandmother recovers to her address", async () => {
  const m = sampleMandate();
  const signature = await grandmother.signTypedData(mandateTypedData(m, CHAIN_ID));
  assert.equal(await recoverMandateSigner(m, CHAIN_ID, signature), grandmother.address);
});

test("changing a cap after signing recovers a different address", async () => {
  const m = sampleMandate();
  const signature = await grandmother.signTypedData(mandateTypedData(m, CHAIN_ID));
  const tampered = { ...m, perRunCap: 50_000_000n };
  assert.notEqual(await recoverMandateSigner(tampered, CHAIN_ID, signature), grandmother.address);
});

// A round-trip test cannot see a change to the struct or the domain: re-signing under the new
// shape recovers the same address, so both tests above stay green while every signature already
// collected becomes invalid. These two hashes are the fixed points that notice.

// keccak256 of the encodeType string — the fingerprint of the field list, its order and its types.
const SPEND_MANDATE_TYPEHASH =
  "0x30048888584c3fc9e482214d76d86616672ee1255a5440c5c4283ff69df2aec9";

// The full EIP-712 digest of sampleMandate() on Base — domain strings, chainId and message
// encoding together. Changing the type list or the domain changes this, and that invalidates
// every mandate a family has already signed. Bump it deliberately, never to make a test pass.
const SAMPLE_MANDATE_DIGEST_BASE =
  "0x0b96b4448850d9e303236147494a3123507affe9bc606361fd4fd7ba444117e8";

test("the SpendMandate struct and the Base digest are pinned", () => {
  const encodeType = `SpendMandate(${SPEND_MANDATE_TYPES.SpendMandate.map((f) => `${f.type} ${f.name}`).join(",")})`;
  assert.equal(keccak256(toHex(encodeType)), SPEND_MANDATE_TYPEHASH);
  assert.equal(hashTypedData(mandateTypedData(sampleMandate(), CHAIN_ID)), SAMPLE_MANDATE_DIGEST_BASE);
});

test("a non-numeric chainId is refused, not quietly dropped", () => {
  // viem builds the domain separator from the fields it recognises, so a string chainId is left
  // out entirely: "8453", "1" and a missing chainId all hash alike, and a Base signature then
  // verifies on any chain. Refusing is the only way to keep the binding.
  assert.throws(() => mandateTypedData(sampleMandate(), "8453"), /chainId must be/);
  assert.throws(() => mandateTypedData(sampleMandate(), undefined), /chainId must be/);
  // A bigint is accepted, and hashes as the number does — so accepting it costs no binding.
  assert.equal(hashTypedData(mandateTypedData(sampleMandate(), 8453n)), SAMPLE_MANDATE_DIGEST_BASE);
});
