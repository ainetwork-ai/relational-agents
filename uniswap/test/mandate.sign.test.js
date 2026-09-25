import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { mandateTypedData } from "../src/mandate/typedData.js";
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
