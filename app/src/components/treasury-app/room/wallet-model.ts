/**
 * What the agent's one address holds, chain by chain: the shared pot's ETH on
 * Ethereum Sepolia, USDC and the WETH it bought on Base. Dollars at demo scale.
 * Pure: status and the wallet in, rows out.
 */

import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import type { Chain } from "./activity-model";
import { tokenAmount } from "./room-model";
import type { TreasuryWallet } from "./room-types";

export type Token = "ETH" | "USDC" | "WETH";

export interface Holding {
  token: Token;
  /** whole tokens as the chain holds them ("0.005") */
  amount: string;
  /** demo-scale dollars; null when the price is unknown */
  usd: number | null;
  /** bought through Uniswap v3 */
  uniswap: boolean;
}

export interface ChainHoldings {
  chain: Chain;
  /** "off": this server does not use the chain; "unavailable": it can't be read right now */
  state: "ready" | "off" | "unavailable";
  rows: Holding[];
}

/** Ethereum Sepolia first — the pot — then Base. */
export function walletHoldings(status: TreasuryStatus, wallet: TreasuryWallet): ChainHoldings[] {
  const sepolia: ChainHoldings =
    status.balanceEth === null
      ? { chain: "sepolia", state: "unavailable", rows: [] }
      : { chain: "sepolia", state: "ready", rows: [{ token: "ETH", amount: status.balanceEth, usd: status.balanceUsd, uniswap: false }] };
  const b = wallet.base;
  const base: ChainHoldings =
    b.state === "ready"
      ? {
          chain: "base",
          state: "ready",
          rows: [
            { token: "USDC", amount: b.usdc, usd: b.usdcUsd, uniswap: false },
            { token: "WETH", amount: b.weth, usd: b.wethUsd, uniswap: true },
          ],
        }
      : { chain: "base", state: b.state, rows: [] };
  return [sepolia, base];
}

/** What one demo-scale dollar is on each chain: "0.000005 ETH · 0.005 USDC". */
export function dollarAtDemoScale(status: TreasuryStatus, wallet: TreasuryWallet): string {
  return [
    status.usdPerEth > 0 ? `${tokenAmount(1 / status.usdPerEth)} ETH` : null,
    `${tokenAmount(wallet.usdcPerUsd)} USDC`,
  ]
    .filter(Boolean)
    .join(" · ");
}
