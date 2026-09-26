import "server-only";
import { createPublicClient, fallback, formatUnits, http, parseAbi, parseEventLogs, type Hex, type Log } from "viem";
import { base } from "viem/chains";
import { INVEST_CHAIN, investConfig, type InvestConfig } from "@/lib/agent/treasury/invest";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import type { SwapAmounts, TreasuryWallet } from "@/components/treasury-app/room/room-types";

/**
 * The agent's wallet for the Treasury page, read-only: what it holds on Base
 * valued at demo scale, what each investment swap moved, and which chains a
 * public explorer can show. Decides nothing — treasuryStatus already did the
 * reading that money decisions use; this only adds what the page shows.
 */

const LOOPBACK_RPC = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])(:|\/|$)/i;
/** invest.ts's default demo scale ($1 = 0.005 USDC), for a server that does not invest and so has no InvestConfig */
const DEFAULT_USDC_PER_USD = 0.005;
const RECEIPT_TIMEOUT_MS = 8_000;
/** a receipt that could not be read is tried again after this long */
const RETRY_MS = 60_000;

const transfer = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

/** A tx on a local fork exists on no public explorer, so it gets no link. */
function explorable(): TreasuryWallet["explorable"] {
  // the same variables wallet.ts (the pot) and invest.ts (Base) connect with
  return {
    sepolia: !LOOPBACK_RPC.test(process.env.SEPOLIA_RPC ?? ""),
    base: !LOOPBACK_RPC.test(process.env.BASE_RPC_URL ?? ""),
  };
}

function usdcPerUsd(cfg: InvestConfig | null): number {
  if (cfg) return cfg.usdcPerUsd;
  const fromEnv = Number(process.env.TREASURY_INVEST_USDC_PER_USD ?? DEFAULT_USDC_PER_USD);
  return fromEnv > 0 ? fromEnv : DEFAULT_USDC_PER_USD;
}

function baseHoldings(status: TreasuryStatus, cfg: InvestConfig | null): TreasuryWallet["base"] {
  if (!cfg) return { state: "off" };
  const held = status.invested;
  if (!held) return { state: "unavailable" };
  return {
    state: "ready",
    usdc: held.usdcIdle,
    weth: held.weth,
    usdcUsd: Math.round((Number(held.usdcIdle) / cfg.usdcPerUsd) * 100) / 100,
    wethUsd: held.storyUsd,
  };
}

/** What one swap moved for the agent: USDC out of its wallet, WETH into it. */
export function swapOf(logs: Log[], agent: string): SwapAmounts | null {
  const zero = BigInt(0);
  let usdcIn = zero;
  let wethOut = zero;
  for (const log of parseEventLogs({ abi: transfer, logs, eventName: "Transfer" })) {
    const token = log.address.toLowerCase();
    if (token === INVEST_CHAIN.usdc.toLowerCase() && log.args.from.toLowerCase() === agent) usdcIn += log.args.value;
    if (token === INVEST_CHAIN.weth.toLowerCase() && log.args.to.toLowerCase() === agent) wethOut += log.args.value;
  }
  return usdcIn > zero && wethOut > zero ? { usdcIn: formatUnits(usdcIn, 6), wethOut: formatUnits(wethOut, 18) } : null;
}

// receipts never change once mined; a miss is retried after RETRY_MS
const receipts = new Map<string, { at: number; swap: SwapAmounts | null }>();

async function investmentSwaps(status: TreasuryStatus, cfg: InvestConfig | null): Promise<Record<string, SwapAmounts>> {
  const agent = status.address?.toLowerCase();
  // treasuryStatus sets txUrl only on an investment that swapped on Base
  const swaps = status.actions.filter((a) => a.kind === "investment" && a.txHash && a.txUrl);
  if (!cfg || !agent || swaps.length === 0) return {};
  const client = createPublicClient({
    chain: base,
    transport: fallback(cfg.rpcs.map((url) => http(url, { timeout: RECEIPT_TIMEOUT_MS })), { rank: false }),
  });
  const out: Record<string, SwapAmounts> = {};
  await Promise.all(
    swaps.map(async (a) => {
      const hash = a.txHash as Hex;
      let hit = receipts.get(hash);
      if (!hit || (hit.swap === null && Date.now() - hit.at > RETRY_MS)) {
        const swap = await client
          .getTransactionReceipt({ hash })
          .then((r) => swapOf(r.logs, agent))
          .catch(() => null);
        hit = { at: Date.now(), swap };
        receipts.set(hash, hit);
      }
      if (hit.swap) out[a.id] = hit.swap;
    })
  );
  return out;
}

export async function agentWallet(status: TreasuryStatus): Promise<TreasuryWallet> {
  const cfg = investConfig();
  return {
    base: baseHoldings(status, cfg),
    usdcPerUsd: usdcPerUsd(cfg),
    swaps: await investmentSwaps(status, cfg),
    explorable: explorable(),
  };
}
