import { createPublicClient, createWalletClient, http, erc20Abi } from "viem";
import { quoterV2Abi, swapRouter02Abi } from "./abi.js";

/**
 * Uniswap v3 through the periphery contracts, over any RPC the chain template names.
 * quote → QuoterV2 (eth_call, no state). execute → ERC-20 approve + SwapRouter02.exactInputSingle.
 */
export function routerProvider(chain) {
  const pub = createPublicClient({ chain: chain.viemChain, transport: http(chain.rpc) });
  const { quoterV2, swapRouter02, v3FeeTier } = chain.uniswap;

  async function quote(intent) {
    const { result } = await pub.simulateContract({
      address: quoterV2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: intent.tokenIn, tokenOut: intent.tokenOut, amountIn: intent.amountIn,
               fee: v3FeeTier, sqrtPriceLimitX96: 0n }],
    });
    const [amountOut, , ticksCrossed, gasEstimate] = result;
    return {
      provider: "router",
      amountIn: intent.amountIn,
      amountOutExpected: amountOut,
      route: `v3 ${v3FeeTier / 10_000}% single hop`,
      raw: { ticksCrossed: Number(ticksCrossed), gasEstimate },
      intent,
    };
  }

  async function execute(quote, account) {
    throw new Error("execute: not implemented yet (Task 2)");
  }

  return { quote, execute, pub };
}
