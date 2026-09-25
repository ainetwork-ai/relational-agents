import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, parseEther } from "viem";
import { chainByName } from "../src/chains/index.js";
import { swapProvider } from "../src/swap/index.js";
import { giveEth, wrapEth } from "../src/fork.js";

const ANVIL_KEY_9 = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6"; // anvil #9
const ANVIL_KEY_8 = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97"; // anvil #8

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
  const wethToUsdc = (recipient, amountIn) => ({ chainId: chain.chainId, tokenIn: WETH, tokenOut: USDC,
    amountIn, recipient, slippageBps: 50 });
  const before = await swap.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const q = await swap.quote(wethToUsdc(account.address, parseEther("0.5")));

  // Another trader sells into the same pool between our quote and our swap, so the fill can no longer
  // equal the quoted figure. Without this the fork is quiet, quoted and filled come out bit-identical,
  // and the balance assertion below would pass just as well for a receipt that echoed the quote.
  // 2 WETH is sized to move the fill measurably (~2bps) while staying inside the 0.5% bound asserted below.
  const perturber = privateKeyToAccount(ANVIL_KEY_8);
  await giveEth(swap.pub, perturber.address, "5");
  await wrapEth(chain, perturber, parseEther("2"));
  await swap.execute(await swap.quote(wethToUsdc(perturber.address, parseEther("2"))), perturber);

  const r = await swap.execute(q, account);
  const after = await swap.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });

  assert.match(r.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(r.amountIn, parseEther("0.5"));
  assert.notEqual(r.amountOut, q.amountOutExpected, "the perturbing swap must have moved the price");
  assert.equal(after - before, r.amountOut, "receipt amountOut must equal the balance change");
  assert.ok(r.amountOut >= q.amountOutExpected * 9950n / 10000n, "within 0.5% of the quote");
  assert.ok(r.price > 0);
  // `price` is tokenIn per whole tokenOut, so for this direction it is WETH per whole USDC.
  // Asserting only `> 0` would let an inverted ratio or a wrong decimals lookup through.
  assert.ok(Math.abs(r.price - 0.5 / (Number(r.amountOut) / 1e6)) < 1e-9, `price must be WETH per whole USDC, got ${r.price}`);
});
