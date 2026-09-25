// End-to-end demo: a small trading session against the shipped strategy.
// Run ship.js once first. Each fill lands in the journal via the watcher.
import { runSwap } from "./swap.js";
import { USDC, WETH } from "./config.js";

const session = [
  { tokenIn: USDC, tokenOut: WETH, amountHuman: "100" },
  { tokenIn: USDC, tokenOut: WETH, amountHuman: "250" },
  { tokenIn: WETH, tokenOut: USDC, amountHuman: "0.08" },
  { tokenIn: USDC, tokenOut: WETH, amountHuman: "500" },
];

for (const leg of session) {
  await runSwap(leg);
  await new Promise((r) => setTimeout(r, 1500)); // let the watcher journal each fill
}
console.log("session complete — check the Swap Journal dashboard");
