// Act 1 — the 100th-day deposit: $1,000 into the capsule with a memo,
// then the operating policy ships to the official Aqua registry.
import { readFileSync } from "node:fs";
import { parseUnits, formatUnits } from "viem";
import { USDC, WETH, STATE_FILE } from "./config.js";
import { publicClient, parent, artifact, erc20Abi, dealUSDC, dealWETH } from "./clients.js";

const st = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const vaultAbi = artifact("FamilyVault").abi;
const MEMO = process.env.MEMO ?? "For Yuna's 100th day. Open at 18 — love, Mom & Dad.";

const USDC_IN = parseUnits("500", 6);
const WETH_IN = parseUnits("0.2", 18); // ≈ $500 at 2,500

await dealUSDC(parent.account.address, USDC_IN);
await dealWETH(parent, WETH_IN);

const w = async (functionName, args, address = st.vault, abi = vaultAbi) => {
  const hash = await parent.writeContract({ address, abi, functionName, args });
  return publicClient.waitForTransactionReceipt({ hash });
};

await w("approve", [st.vault, USDC_IN], USDC, erc20Abi);
await w("approve", [st.vault, WETH_IN], WETH, erc20Abi);
await w("deposit", [USDC, USDC_IN, MEMO]);
await w("deposit", [WETH, WETH_IN, ""]);

const CAP_BPS = Number(process.env.CAP_BPS ?? 500);
await w("shipPolicy", [USDC, WETH, USDC_IN, WETH_IN, CAP_BPS]);

const strategyHash = await publicClient.readContract({
  address: st.vault, abi: vaultAbi, functionName: "strategyHash",
});
console.log(`deposited ${formatUnits(USDC_IN, 6)} USDC + ${formatUnits(WETH_IN, 18)} WETH`);
console.log(`memo: "${MEMO}"`);
console.log(`policy shipped to official Aqua · cap ${CAP_BPS / 100}%/fill · strategy ${strategyHash}`);
