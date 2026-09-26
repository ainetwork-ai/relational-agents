import "server-only";
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { agentKey } from "./wallet";

/**
 * Investing idle funds — the "investment" kind, once its quorum is met — is a
 * Uniswap v3 swap on Base, USDC → WETH, signed by the treasury agent's own key
 * (the same address as its Sepolia pot). The WETH stays in the agent's wallet;
 * the relation's memory names that wallet as the "Savings (idle funds)" payee.
 *
 * Addresses mirror uniswap/src/chains/base.js (verified against the Uniswap
 * deployments page on 2026-09-25). They are repeated here because the Docker
 * build context is app/ alone.
 *
 * Demo scale: the pot is testnet money at $200,000/ETH; an investment of $X in
 * the story swaps X × TREASURY_INVEST_USDC_PER_USD real USDC (default 0.005 —
 * "$200" = 1 USDC). Off unless TREASURY_INVEST=uniswap-base, in which case an
 * approved investment is a transfer to the payee as before.
 */
export const INVEST_CHAIN = {
  chainId: 8453,
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
  weth: "0x4200000000000000000000000000000000000006" as const,
  quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as const,
  swapRouter02: "0x2626664c2603336E57B271c5C0b26F421741e481" as const,
  feeTier: 500, // the USDC/WETH 0.05% pool
  explorer: "https://basescan.org",
};

export interface InvestConfig {
  rpc: string;
  /** real USDC per story dollar */
  usdcPerUsd: number;
  slippageBps: number;
}

export function investConfig(): InvestConfig | null {
  if (process.env.TREASURY_INVEST !== "uniswap-base") return null;
  const usdcPerUsd = Number(process.env.TREASURY_INVEST_USDC_PER_USD ?? "0.005");
  const slippageBps = Number(process.env.TREASURY_INVEST_SLIPPAGE_BPS ?? "50");
  if (!(usdcPerUsd > 0) || !(slippageBps >= 0 && slippageBps < 10_000)) return null;
  return { rpc: process.env.BASE_RPC_URL ?? "https://mainnet.base.org", usdcPerUsd, slippageBps };
}

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const quoter = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const router = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
]);

const publicClient = (cfg: InvestConfig) => createPublicClient({ chain: base, transport: http(cfg.rpc) });

/** USDC (6 decimals) for a story amount at demo scale. */
export function usdcForUsd(cfg: InvestConfig, usd: number): bigint {
  return BigInt(Math.round(usd * cfg.usdcPerUsd * 1e6));
}

async function quote(cfg: InvestConfig, tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint): Promise<bigint> {
  const { result } = await publicClient(cfg).simulateContract({
    address: INVEST_CHAIN.quoterV2,
    abi: quoter,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: INVEST_CHAIN.feeTier, sqrtPriceLimitX96: BigInt(0) }],
  });
  return result[0];
}

const trim = (s: string) => s.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");

export interface InvestResult {
  txHash: Hex;
  usdcIn: bigint;
  wethOut: bigint;
  txUrl: string;
  /** one line for the chat and the activity page */
  note: string;
}

/** Swap the story amount's worth of real USDC into WETH, from the agent's wallet, on Base. */
export async function investViaUniswap(agentUserId: string, amountUsd: number): Promise<InvestResult> {
  const cfg = investConfig();
  if (!cfg) throw new Error("investing is not configured on this server (TREASURY_INVEST)");
  const amountIn = usdcForUsd(cfg, amountUsd);
  if (amountIn <= BigInt(0)) throw new Error("this investment rounds to nothing at demo scale");

  const account = privateKeyToAccount(await agentKey(agentUserId));
  const client = publicClient(cfg);
  const wallet = createWalletClient({ account, chain: base, transport: http(cfg.rpc) });

  const held = await client.readContract({ address: INVEST_CHAIN.usdc, abi: erc20, functionName: "balanceOf", args: [account.address] });
  if (held < amountIn)
    throw new Error(
      `the agent's Base wallet holds ${formatUnits(held, 6)} USDC, less than the ${formatUnits(amountIn, 6)} this investment needs`
    );

  const expected = await quote(cfg, INVEST_CHAIN.usdc, INVEST_CHAIN.weth, amountIn);
  const amountOutMinimum = (expected * BigInt(10_000 - cfg.slippageBps)) / BigInt(10_000);

  // a plain ERC-20 approval for exactly this buy, only when the router lacks it
  const allowance = await client.readContract({ address: INVEST_CHAIN.usdc, abi: erc20, functionName: "allowance", args: [account.address, INVEST_CHAIN.swapRouter02] });
  if (allowance < amountIn) {
    const approveHash = await wallet.writeContract({ address: INVEST_CHAIN.usdc, abi: erc20, functionName: "approve", args: [INVEST_CHAIN.swapRouter02, amountIn] });
    await client.waitForTransactionReceipt({ hash: approveHash });
  }

  const txHash = await wallet.writeContract({
    address: INVEST_CHAIN.swapRouter02,
    abi: router,
    functionName: "exactInputSingle",
    args: [{ tokenIn: INVEST_CHAIN.usdc, tokenOut: INVEST_CHAIN.weth, fee: INVEST_CHAIN.feeTier, recipient: account.address, amountIn, amountOutMinimum, sqrtPriceLimitX96: BigInt(0) }],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    const err = new Error("the swap reverted on Base") as Error & { txHash: Hex };
    err.txHash = txHash;
    throw err;
  }
  // what THIS swap delivered: the WETH Transfer to the agent in its own receipt
  const wethOut = parseEventLogs({ abi: erc20, logs: receipt.logs, eventName: "Transfer" })
    .filter((l) => l.address.toLowerCase() === INVEST_CHAIN.weth.toLowerCase() && l.args.to.toLowerCase() === account.address.toLowerCase())
    .reduce((sum, l) => sum + l.args.value, BigInt(0));

  return {
    txHash,
    usdcIn: amountIn,
    wethOut,
    txUrl: `${INVEST_CHAIN.explorer}/tx/${txHash}`,
    note: `${trim(formatUnits(amountIn, 6))} USDC → ${trim(formatUnits(wethOut, 18))} WETH via Uniswap v3 on Base (demo scale: $1 = ${cfg.usdcPerUsd} USDC)`,
  };
}

export interface InvestedPosition {
  address: `0x${string}`;
  weth: bigint;
  usdcIdle: bigint;
  /** the WETH priced through the same pool, in USDC */
  wethAsUsdc: bigint;
  /** the same, back at story scale */
  wethAsStoryUsd: number;
  chain: "base";
}

/** What the agent holds on Base right now, priced through the pool it bought from. */
export async function investedPosition(agentUserId: string): Promise<InvestedPosition | null> {
  const cfg = investConfig();
  if (!cfg) return null;
  const address = privateKeyToAccount(await agentKey(agentUserId)).address;
  const client = publicClient(cfg);
  const [weth, usdcIdle] = await Promise.all([
    client.readContract({ address: INVEST_CHAIN.weth, abi: erc20, functionName: "balanceOf", args: [address] }),
    client.readContract({ address: INVEST_CHAIN.usdc, abi: erc20, functionName: "balanceOf", args: [address] }),
  ]);
  const wethAsUsdc = weth > BigInt(0) ? await quote(cfg, INVEST_CHAIN.weth, INVEST_CHAIN.usdc, weth) : BigInt(0);
  return { address, weth, usdcIdle, wethAsUsdc, wethAsStoryUsd: Number(formatUnits(wethAsUsdc, 6)) / cfg.usdcPerUsd, chain: "base" };
}
