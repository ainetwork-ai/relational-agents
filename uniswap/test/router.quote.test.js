import { test } from "node:test";
import assert from "node:assert/strict";
import { chainByName } from "../src/chains/index.js";
import { swapProvider } from "../src/swap/index.js";

// Integration: needs `pnpm fork` running on 8547. Skips (does not fail) when it is not.
async function forkUp(rpc) {
  try {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return r.ok;
  } catch { return false; }
}

const intent = (chain, over = {}) => ({
  chainId: chain.chainId,
  tokenIn: chain.tokens.USDC.address,
  tokenOut: chain.tokens.WETH.address,
  amountIn: 20_000_000n,
  recipient: "0x0000000000000000000000000000000000000001",
  slippageBps: 50,
  ...over,
});

test("router.quote: 20 USDC → WETH on the Base fork returns a positive amount", async (t) => {
  const chain = chainByName("base");
  if (!(await forkUp(chain.rpc))) return t.skip("fork not running");
  const swap = swapProvider("router", chain);
  const q = await swap.quote(intent(chain));
  assert.equal(q.provider, "router");
  assert.equal(q.amountIn, 20_000_000n);
  // Bounded tightly enough to tell the QuoterV2 tuple members apart: were `outputs`
  // misordered, gasEstimate (~9e4) or initializedTicksCrossed (~1) would land here and fail.
  assert.ok(
    q.amountOutExpected > 10n ** 15n && q.amountOutExpected < 10n ** 17n,
    `20 USDC should be 1e15..1e17 wei of WETH, got ${q.amountOutExpected}`,
  );
});

// No fork needed: the guard runs before any RPC call.
test("router.quote: refuses an intent addressed to another chain", async () => {
  const chain = chainByName("base");
  const swap = swapProvider("router", chain);
  await assert.rejects(() => swap.quote(intent(chain, { chainId: 1 })), /chainId/);
});
