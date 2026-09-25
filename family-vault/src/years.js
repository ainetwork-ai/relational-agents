// Act 2 in fast-forward: six market sessions spread across ~17 years of
// jumped time, so the ledger's value chart actually draws a childhood.
import { parseUnits } from "viem";
import { USDC, WETH } from "./config.js";
import { publicClient, market, erc20Abi, dealUSDC, dealWETH, dealETH, increaseTime } from "./clients.js";
import { marketSwap } from "./market.js";
import { readFileSync } from "node:fs";
import { STATE_FILE } from "./config.js";

const st = JSON.parse(readFileSync(STATE_FILE, "utf8"));

await dealETH(market.account.address, 10n ** 19n);
await dealUSDC(market.account.address, parseUnits("500", 6));
await dealWETH(market, parseUnits("0.2", 18));
for (const token of [USDC, WETH]) {
  const h = await market.writeContract({
    address: token, abi: erc20Abi, functionName: "approve", args: [st.router, 2n ** 256n - 1n],
  });
  await publicClient.waitForTransactionReceipt({ hash: h });
}

const YEAR = 31_536_000n;
const sessions = [
  [[USDC, WETH, "18"], [USDC, WETH, "12"]],
  [[WETH, USDC, "0.007"], [USDC, WETH, "20"]],
  [[USDC, WETH, "15"], [WETH, USDC, "0.005"]],
  [[USDC, WETH, "22"], [USDC, WETH, "9"]],
  [[WETH, USDC, "0.008"], [USDC, WETH, "17"]],
  [[USDC, WETH, "13"], [WETH, USDC, "0.004"]],
];

let age = 0;
for (const legs of sessions) {
  await increaseTime(YEAR * 29n / 10n); // ~2.9 years
  age += 2.9;
  for (const [tin, tout, amt] of legs) {
    await marketSwap(tin, tout, parseUnits(amt, tin === USDC ? 6 : 18));
    await new Promise((r) => setTimeout(r, 1400)); // let the watcher journal it
  }
  console.log(`Yuna is ~${age.toFixed(1)} — a few fills passed through the vault`);
}
console.log("seventeen-odd years of market flow, done");
