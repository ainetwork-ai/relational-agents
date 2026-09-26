import type { TreasuryChain } from "@/components/chain/chain-badge";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";

/** One person (or the room's agent) as the Treasury page names them. */
export interface TreasuryRoomPerson {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
}

/** A swap on Uniswap v3 on Base, in whole tokens ("0.1", "0.0000372"). */
export interface SwapAmounts {
  usdcIn: string;
  wethOut: string;
}

/**
 * The agent's wallet beyond what `status` carries (app/api/treasury/[roomId]/agent-wallet.ts).
 * The pot on Ethereum Sepolia is status.balanceEth / balanceUsd; the recurring buy's swaps are
 * status.recurring.history.
 */
export interface TreasuryWallet {
  /** USDC and WETH on Base, dollars at demo scale. "off": this server does not use Base; "unavailable": Base can't be read now */
  base:
    | { state: "off" }
    | { state: "unavailable" }
    | { state: "ready"; usdc: string; weth: string; usdcUsd: number; wethUsd: number };
  /** real USDC per story dollar on Base, the demo scale (0.005: "$1" = 0.005 USDC) */
  usdcPerUsd: number;
  /** an executed investment's swap, by action id, as its receipt on Base reads; absent when it can't be read */
  swaps: Record<string, SwapAmounts>;
  /** false for a chain this server runs as a local fork: no public explorer has its transactions */
  explorable: Record<TreasuryChain, boolean>;
}

/** GET /api/treasury/[roomId] — what /treasury/[roomId] renders. */
export interface TreasuryRoomResponse {
  status: TreasuryStatus;
  /** members in join order, then the room's agents; docPageId opens the relation's doc (/p/<id>) */
  room: { id: string; name: string; members: TreasuryRoomPerson[]; docPageId: string | null };
  me: { id: string; displayName: string };
  wallet: TreasuryWallet;
}

export type TreasuryAction = TreasuryStatus["actions"][number];
export type RecurringLive = NonNullable<NonNullable<TreasuryStatus["recurring"]>["live"]>;
export type RecurringPending = NonNullable<NonNullable<TreasuryStatus["recurring"]>["pending"]>;
export type RecurringRun = NonNullable<TreasuryStatus["recurring"]>["history"][number];
