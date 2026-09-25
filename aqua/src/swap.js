// Taker swaps through the OFFICIAL SwapVM router against the shipped strategy.
// Every fill here emits the onchain events the journal watcher listens to.
import { readFileSync } from "node:fs";
import { parseUnits, formatUnits, decodeFunctionResult } from "viem";
import { Address } from "@1inch/sdk-core";
import { AquaXYCAmmStrategy, Order, MakerTraits, SwapVMContract, TakerTraits, ABI } from "@1inch/swap-vm-sdk";
import { SWAP_VM_AQUA_ROUTER, USDC, WETH, STATE_FILE } from "./config.js";
import { publicClient, taker, erc20Abi } from "./clients.js";

export async function runSwap({ tokenIn = USDC, tokenOut = WETH, amountHuman = "100" } = {}) {
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const decimalsIn = tokenIn === USDC ? 6 : 18;
  const decimalsOut = tokenOut === USDC ? 6 : 18;
  const amount = parseUnits(amountHuman, decimalsIn);

  // the order is deterministic — rebuild it exactly as ship.js did
  const order = Order.new({
    maker: new Address(state.maker),
    program: AquaXYCAmmStrategy.new().build(),
    traits: MakerTraits.default(),
  });

  // taker allows the router to pull tokenIn
  const approve = await taker.writeContract({
    address: tokenIn, abi: erc20Abi, functionName: "approve",
    args: [SWAP_VM_AQUA_ROUTER, 2n ** 256n - 1n],
  });
  await publicClient.waitForTransactionReceipt({ hash: approve });

  const swapVM = new SwapVMContract(new Address(SWAP_VM_AQUA_ROUTER));
  const params = { order, amount, takerTraits: TakerTraits.default(), tokenIn: new Address(tokenIn), tokenOut: new Address(tokenOut) };

  // quote first — the journal stores expected vs executed
  const q = swapVM.quote(params);
  const sim = await publicClient.call({ account: taker.account.address, to: q.to.toString(), data: q.data.toString() });
  const [, expectedOut] = decodeFunctionResult({ abi: ABI.SWAP_VM_ABI, functionName: "quote", data: sim.data });

  // leave the expected amount for the journal watcher (expected vs executed → slippage)
  const { mkdirSync, readFileSync: rf, writeFileSync: wf, existsSync } = await import("node:fs");
  const { dirname } = await import("node:path");

  const s = swapVM.swap(params);
  const hash = await taker.sendTransaction({ to: s.to.toString(), data: s.data.toString() });
  const qFile = new URL("../.state/pending-quotes.json", import.meta.url).pathname;
  mkdirSync(dirname(qFile), { recursive: true });
  const q0 = existsSync(qFile) ? JSON.parse(rf(qFile, "utf8")) : {};
  q0[hash] = { expectedOut: expectedOut.toString(), quotedAt: Date.now() };
  wf(qFile, JSON.stringify(q0, null, 2));
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log(
    `swap ${formatUnits(amount, decimalsIn)} ${tokenIn === USDC ? "USDC" : "WETH"} → ` +
    `~${formatUnits(expectedOut, decimalsOut)} ${tokenOut === USDC ? "USDC" : "WETH"} | tx ${hash} (${receipt.status}) gas ${receipt.gasUsed}`
  );
  return { hash, receipt, expectedOut, amount, tokenIn, tokenOut };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSwap({ amountHuman: process.argv[2] ?? "100" }).catch((e) => { console.error(e); process.exit(1); });
}
