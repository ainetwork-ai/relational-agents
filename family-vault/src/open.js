// Act 3 — eighteen years pass (evm_increaseTime), the child claims:
// the policy docks, and principal + accrued spread transfer on-chain.
import { readFileSync } from "node:fs";
import { formatUnits } from "viem";
import { USDC, WETH, EIGHTEEN_YEARS, STATE_FILE } from "./config.js";
import { publicClient, child, artifact, erc20Abi, increaseTime } from "./clients.js";

const st = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const vaultAbi = artifact("FamilyVault").abi;

if (process.env.SKIP_JUMP !== "1") {
  await increaseTime(EIGHTEEN_YEARS + 3600n);
  console.log("… eighteen years pass …");
}

const before = await Promise.all([USDC, WETH].map((t) =>
  publicClient.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [child.account.address] })
));

const hash = await child.writeContract({
  address: st.vault, abi: vaultAbi, functionName: "claim", args: [],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });

const after = await Promise.all([USDC, WETH].map((t) =>
  publicClient.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [child.account.address] })
));

console.log(`CapsuleOpened · tx ${receipt.transactionHash}`);
console.log(`the child received ${formatUnits(after[0] - before[0], 6)} USDC + ${formatUnits(after[1] - before[1], 18)} WETH`);
