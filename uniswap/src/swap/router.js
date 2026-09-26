import { createPublicClient, createWalletClient, http, erc20Abi, parseEventLogs } from "viem";
import { quoterV2Abi, swapRouter02Abi } from "./abi.js";
import { sameAddress } from "../address.js";

/**
 * Uniswap v3 through the periphery contracts, over any RPC the chain template names.
 * quote → QuoterV2 (eth_call, no state). execute → ERC-20 approve + SwapRouter02.exactInputSingle.
 */
export function routerProvider(chain) {
  const pub = createPublicClient({ chain: chain.viemChain, transport: http(chain.rpc) });
  const { quoterV2, swapRouter02, v3FeeTier } = chain.uniswap;

  async function quote(intent) {
    // The intent names its chain and the provider is bound to one. Refuse rather than quote the
    // wrong book: the mismatch would otherwise ride out in the quote and be signed by execute().
    if (intent.chainId !== chain.chainId)
      throw new Error(`intent chainId ${intent.chainId} ≠ provider chain ${chain.chainId} (${chain.name})`);
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

  // `priced` is a quote from quote() above — named so it does not shadow that function.
  async function execute(priced, account) {
    const { intent } = priced;
    const wallet = createWalletClient({ account, chain: chain.viemChain, transport: http(chain.rpc) });
    const decimalsOf = (addr) =>
      Object.values(chain.tokens).find((t) => sameAddress(t.address, addr))?.decimals ?? 18;

    // 1. allowance for the router — a plain ERC-20 approval, exactly the amount of this buy
    const approveHash = await wallet.writeContract({ address: intent.tokenIn, abi: erc20Abi,
      functionName: "approve", args: [swapRouter02, intent.amountIn] });
    await pub.waitForTransactionReceipt({ hash: approveHash });

    // 2. the swap; slippage is enforced by the router through amountOutMinimum
    const amountOutMinimum = priced.amountOutExpected * BigInt(10_000 - intent.slippageBps) / 10_000n;
    const txHash = await wallet.writeContract({ address: swapRouter02, abi: swapRouter02Abi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: intent.tokenIn, tokenOut: intent.tokenOut, fee: v3FeeTier,
               recipient: intent.recipient, amountIn: intent.amountIn, amountOutMinimum,
               sqrtPriceLimitX96: 0n }] });
    // The swap is broadcast from here on, so every failure below is ambiguous — a timeout or an
    // undecodable receipt does not mean the tokens stayed put. Carry the hash out with the error so
    // the caller can file a refusal that names the transaction instead of one that denies it.
    try {
      const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error(`swap reverted: ${txHash}`);

      // 3. what THIS swap moved, taken from its own Transfer logs. A balance read either side of the
      //    swap would also count anything else that credited the recipient in the same window — two
      //    buys sharing a recipient would each report the other's fill, into the family's passbook.
      const credits = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: "Transfer" })
        .filter((log) => sameAddress(log.address, intent.tokenOut) && sameAddress(log.args.to, intent.recipient));
      if (credits.length === 0)
        throw new Error(`swap ${txHash} credited no ${intent.tokenOut} to ${intent.recipient}`);
      const amountOut = credits.reduce((sum, log) => sum + log.args.value, 0n);
      const inWhole = Number(intent.amountIn) / 10 ** decimalsOf(intent.tokenIn);
      const outWhole = Number(amountOut) / 10 ** decimalsOf(intent.tokenOut);
      return { txHash, amountIn: intent.amountIn, amountOut, price: inWhole / outWhole,
               route: priced.route, provider: "router" };
    } catch (err) {
      if (err && typeof err === "object") err.txHash = txHash;
      throw err;
    }
  }

  return { quote, execute, pub };
}
