// Every address this package knows about lives here. Verified against
// developers.uniswap.org/docs/protocols/v3/deployments (Base mainnet column) on 2026-09-25.
import { base as viemBase } from "viem/chains";

const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8547";

export const base = {
  chainId: 8453,
  name: "base",
  rpc,
  viemChain: { ...viemBase, rpcUrls: { default: { http: [rpc] } } },
  tokens: {
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  },
  uniswap: {
    quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    swapRouter02: "0x2626664c2603336E57B271c5C0b26F421741e481",
    v3FeeTier: 500, // the USDC/WETH 0.05% pool — the quote spike on 2026-09-25 crossed it
  },
  explorerTx: (hash) => `https://basescan.org/tx/${hash}`,
};
