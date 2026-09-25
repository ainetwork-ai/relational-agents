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

test("router.quote: 20 USDC → WETH on the Base fork returns a positive amount", async (t) => {
  const chain = chainByName("base");
  if (!(await forkUp(chain.rpc))) return t.skip("fork not running");
  const swap = swapProvider("router", chain);
  const q = await swap.quote({
    chainId: chain.chainId,
    tokenIn: chain.tokens.USDC.address,
    tokenOut: chain.tokens.WETH.address,
    amountIn: 20_000_000n,
    recipient: "0x0000000000000000000000000000000000000001",
    slippageBps: 50,
  });
  assert.equal(q.provider, "router");
  assert.equal(q.amountIn, 20_000_000n);
  assert.ok(q.amountOutExpected > 0n, "expected some WETH");
  assert.ok(q.amountOutExpected < 10n ** 18n, "20 USDC is less than 1 ETH");
});
