import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, parseEther } from "viem";
import { chainByName } from "../src/chains/index.js";
import { swapProvider } from "../src/swap/index.js";
import { giveEth, wrapEth } from "../src/fork.js";

const ANVIL_KEY_9 = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6"; // anvil #9

async function forkUp(rpc) {
  try { const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }); return r.ok; }
  catch { return false; }
}

test("router.execute: WETH → USDC on the fork moves the balances it says it moved", async (t) => {
  const chain = chainByName("base");
  if (!(await forkUp(chain.rpc))) return t.skip("fork not running");
  const account = privateKeyToAccount(ANVIL_KEY_9);
  const swap = swapProvider("router", chain);
  await giveEth(swap.pub, account.address, "5");
  await wrapEth(chain, account, parseEther("1"));

  const USDC = chain.tokens.USDC.address, WETH = chain.tokens.WETH.address;
  const before = await swap.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const q = await swap.quote({ chainId: chain.chainId, tokenIn: WETH, tokenOut: USDC,
    amountIn: parseEther("0.5"), recipient: account.address, slippageBps: 50 });
  const r = await swap.execute(q, account);
  const after = await swap.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });

  assert.match(r.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(r.amountIn, parseEther("0.5"));
  assert.equal(after - before, r.amountOut, "receipt amountOut must equal the balance change");
  assert.ok(r.amountOut >= q.amountOutExpected * 9950n / 10000n, "within 0.5% of the quote");
  assert.ok(r.price > 0);
});
