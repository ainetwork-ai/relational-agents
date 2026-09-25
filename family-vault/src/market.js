// Act 2 — years of quiet market flow. Takers swap against the vault through
// the custom router; every fill pays the capsule a little spread. The order
// itself is read straight off the chain (vault.currentOrder).
import { readFileSync } from "node:fs";
import { decodeAbiParameters, parseUnits, formatUnits } from "viem";
import { USDC, WETH, STATE_FILE } from "./config.js";
import { publicClient, market, artifact, erc20Abi, dealUSDC, dealWETH, dealETH } from "./clients.js";

const st = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const routerAbi = artifact("FamilyVaultSwapVM").abi;
const vaultAbi = artifact("FamilyVault").abi;

// TakerTraits: 20B slice-indexes (all zero) ++ 2B flags
// flags = IS_EXACT_IN (0x0001) | USE_TRANSFER_FROM_AND_AQUA_PUSH (0x0040)
const TAKER_BYTES = `0x${"00".repeat(20)}0041`;

export async function currentOrder() {
  const raw = await publicClient.readContract({
    address: st.vault, abi: vaultAbi, functionName: "currentOrder",
  });
  const [order] = decodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "maker", type: "address" },
      { name: "traits", type: "uint256" },
      { name: "data", type: "bytes" },
    ]}],
    raw
  );
  return order;
}

export async function marketSwap(tokenIn, tokenOut, amountIn) {
  const order = await currentOrder();
  const hash = await market.writeContract({
    address: st.router, abi: routerAbi, functionName: "swap",
    args: [order, tokenIn, tokenOut, amountIn, TAKER_BYTES],
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  await dealETH(market.account.address, 10n ** 19n);
  await dealUSDC(market.account.address, parseUnits("200", 6));
  await dealWETH(market, parseUnits("0.1", 18));
  for (const [token, name] of [[USDC, "USDC"], [WETH, "WETH"]]) {
    const h = await market.writeContract({
      address: token, abi: erc20Abi, functionName: "approve",
      args: [st.router, 2n ** 256n - 1n],
    });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }

  // a small two-way session, every fill within the low-risk cap
  const legs = [
    [USDC, WETH, parseUnits("20", 6), "20 USDC → WETH"],
    [USDC, WETH, parseUnits("15", 6), "15 USDC → WETH"],
    [WETH, USDC, parseUnits("0.008", 18), "0.008 WETH → USDC"],
    [USDC, WETH, parseUnits("24", 6), "24 USDC → WETH"],
    [WETH, USDC, parseUnits("0.006", 18), "0.006 WETH → USDC"],
  ];
  for (const [tin, tout, amt, label] of legs) {
    await marketSwap(tin, tout, amt);
    console.log(`filled: ${label}`);
    await new Promise((r) => setTimeout(r, 800));
  }

  const [u, w] = await Promise.all([USDC, WETH].map((t) =>
    publicClient.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [st.vault] })
  ));
  console.log(`vault now holds ${formatUnits(u, 6)} USDC + ${formatUnits(w, 18)} WETH (never left its wallet)`);
}
