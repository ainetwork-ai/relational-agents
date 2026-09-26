import "server-only";
import { createPublicClient, createWalletClient, fallback, formatUnits, http, parseAbi, parseEventLogs, type Hex } from "viem";
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
  /** BASE_RPC_URL first, then public fallbacks — one rate-limited endpoint must not fail an approved swap */
  rpcs: string[];
  /** real USDC per story dollar */
  usdcPerUsd: number;
  slippageBps: number;
}

export function investConfig(): InvestConfig | null {
  if (process.env.TREASURY_INVEST !== "uniswap-base") return null;
  const usdcPerUsd = Number(process.env.TREASURY_INVEST_USDC_PER_USD ?? "0.005");
  const slippageBps = Number(process.env.TREASURY_INVEST_SLIPPAGE_BPS ?? "50");
  if (!(usdcPerUsd > 0) || !(slippageBps >= 0 && slippageBps < 10_000)) return null;
  const rpcs = [...new Set([process.env.BASE_RPC_URL, "https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"].filter((u): u is string => !!u))];
  return { rpcs, usdcPerUsd, slippageBps };
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

const transportFor = (cfg: InvestConfig) => fallback(cfg.rpcs.map((u) => http(u, { timeout: 10_000 })), { rank: false });
const publicClient = (cfg: InvestConfig) => createPublicClient({ chain: base, transport: transportFor(cfg) });

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
  const wallet = createWalletClient({ account, chain: base, transport: transportFor(cfg) });

  const held = await client.readContract({ address: INVEST_CHAIN.usdc, abi: erc20, functionName: "balanceOf", args: [account.address] });
  if (held < amountIn)
    throw new Error(
      `the agent's Base wallet holds ${formatUnits(held, 6)} USDC, less than the ${formatUnits(amountIn, 6)} this investment needs`
    );

  // A plain ERC-20 approval for exactly this buy, only when the router lacks
  // it. Then wait until THIS client can read the allowance: a load-balanced
  // RPC has shown the approval's receipt from one node and estimated the swap
  // on another that had not seen the block yet — an "STF" revert that public
  // nodes hand back with the reason stripped.
  const allowanceNow = () => client.readContract({ address: INVEST_CHAIN.usdc, abi: erc20, functionName: "allowance", args: [account.address, INVEST_CHAIN.swapRouter02] });
  if ((await allowanceNow()) < amountIn) {
    const approveHash = await wallet.writeContract({ address: INVEST_CHAIN.usdc, abi: erc20, functionName: "approve", args: [INVEST_CHAIN.swapRouter02, amountIn] });
    await client.waitForTransactionReceipt({ hash: approveHash });
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) {
      seen = (await allowanceNow()) >= amountIn;
      if (!seen) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!seen) throw new Error("the router's allowance is not visible yet — try the investment again in a minute");
  }

  // quote after the allowance is settled, so the minimum is from a fresh block
  const expected = await quote(cfg, INVEST_CHAIN.usdc, INVEST_CHAIN.weth, amountIn);
  const amountOutMinimum = (expected * BigInt(10_000 - cfg.slippageBps)) / BigInt(10_000);

  // an explicit gas limit: the swap is ordered after the approval by nonce, so
  // it cannot run before it on-chain; estimating it against a lagging node is
  // the one step that could still fail spuriously. ~130k used; 300k is room.
  const txHash = await wallet.writeContract({
    address: INVEST_CHAIN.swapRouter02,
    abi: router,
    functionName: "exactInputSingle",
    args: [{ tokenIn: INVEST_CHAIN.usdc, tokenOut: INVEST_CHAIN.weth, fee: INVEST_CHAIN.feeTier, recipient: account.address, amountIn, amountOutMinimum, sqrtPriceLimitX96: BigInt(0) }],
    gas: BigInt(300_000),
  });
  // The swap is broadcast from here on, so a receipt wait that fails (a timeout, a dropped RPC
  // call) does not mean the USDC stayed put. The error carries the hash, and callers file the
  // attempt as "may have moved" instead of buying again on top of a swap that may have landed.
  const receipt = await client.waitForTransactionReceipt({ hash: txHash }).catch((err: unknown) => {
    if (err && typeof err === "object") (err as { txHash?: Hex }).txHash = txHash;
    throw err;
  });
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

const POSITION_FRESH_MS = 15_000;
const POSITION_STALE_MS = 5 * 60_000;
/** how long a status read waits for the chain before showing the last value, or nothing */
const POSITION_WAIT_MS = 2_500;
const positions = new Map<string, { at: number; value?: InvestedPosition | null; inflight?: Promise<void> }>();

/**
 * The position as the room panel and the Treasury page show it. Its three Base
 * reads take 3–5 s from this host and every open room polls every few seconds,
 * so one read per agent is shared, its value is reused for 15 s, and a poll
 * waits at most POSITION_WAIT_MS — then shows the last value (up to five
 * minutes old), or nothing when there is none yet, while the read finishes in
 * the background. Never for a money decision: those read investedPosition.
 */
export async function displayInvestedPosition(agentUserId: string): Promise<InvestedPosition | null> {
  if (!investConfig()) return null;
  let entry = positions.get(agentUserId);
  if (!entry) positions.set(agentUserId, (entry = { at: 0 }));
  const e = entry;
  if (e.value !== undefined && Date.now() - e.at < POSITION_FRESH_MS) return e.value;
  e.inflight ??= investedPosition(agentUserId)
    .then((value) => {
      e.value = value;
      e.at = Date.now();
    })
    .finally(() => {
      e.inflight = undefined;
    });
  const done = await Promise.race([
    e.inflight.then(
      () => true,
      () => false
    ),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), POSITION_WAIT_MS)),
  ]);
  if (done) return e.value ?? null;
  return e.value !== undefined && Date.now() - e.at < POSITION_STALE_MS ? e.value : null;
}
