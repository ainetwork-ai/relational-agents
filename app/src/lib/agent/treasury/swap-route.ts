/**
 * Which way a Base buy went — kept on its history row, said in plain words in
 * chat and Treasury Activity. No IO: the pure run record (recurring-record.ts)
 * checks rows against it.
 */

export const SWAP_ROUTES = ["uniswap-api CLASSIC", "uniswap-api UniswapX", "direct v3"] as const;
export type SwapRoute = (typeof SWAP_ROUTES)[number];

export const isSwapRoute = (v: unknown): v is SwapRoute => (SWAP_ROUTES as readonly unknown[]).includes(v);

/** "… WETH · Uniswap v3 on Base · tx …" — the direct route keeps the words it always had. */
export const ROUTE_WORDS: Record<SwapRoute, string> = {
  "direct v3": "Uniswap v3 on Base",
  "uniswap-api CLASSIC": "the Uniswap API's route on Base",
  "uniswap-api UniswapX": "a UniswapX order on Base",
};
