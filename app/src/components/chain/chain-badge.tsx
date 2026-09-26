/**
 * Where treasury money lives or moves, said the same way on every surface: the chain
 * (the pot is on Ethereum Sepolia, swaps and their WETH on Base) and Uniswap for a swap.
 * Brand and chain names are proper nouns, so they are not translated.
 */

export type TreasuryChain = "base" | "sepolia";

const CHAINS: Record<TreasuryChain, { label: string; dot: string; explorer: string }> = {
  base: { label: "Base", dot: "#0052FF", explorer: "https://basescan.org" },
  sepolia: { label: "Ethereum Sepolia", dot: "#8A92B2", explorer: "https://sepolia.etherscan.io" },
};

const UNISWAP_PINK = "#FF007A";

export function chainLabel(chain: TreasuryChain): string {
  return CHAINS[chain].label;
}

export function explorerTxUrl(chain: TreasuryChain, txHash: string): string {
  return `${CHAINS[chain].explorer}/tx/${txHash}`;
}

export function explorerAddressUrl(chain: TreasuryChain, address: string): string {
  return `${CHAINS[chain].explorer}/address/${address}`;
}

const BADGE =
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[11px] font-medium leading-4";

/** "● Base" / "● Ethereum Sepolia" */
export function ChainBadge({ chain, className = "" }: { chain: TreasuryChain; className?: string }) {
  const c = CHAINS[chain];
  return (
    <span data-chain={chain} className={`${BADGE} border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300 ${className}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}

/** "● Uniswap" — on a swap, next to its ChainBadge; the Route line says which way it went. */
export function UniswapBadge({ className = "" }: { className?: string }) {
  return (
    <span data-venue="uniswap-v3" className={`${BADGE} border-pink-200 text-pink-700 dark:border-pink-900 dark:text-pink-300 ${className}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: UNISWAP_PINK }} />
      Uniswap
    </span>
  );
}
