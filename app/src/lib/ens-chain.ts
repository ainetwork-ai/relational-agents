// app/src/lib/ens-chain.ts
// The app's view of the ENS family (spec: ens/plan-family-namespace.md).
import "server-only";
import { createPublicClient, http, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { createFamilyChain, type FamilyChain } from "@/lib/ens-family/chain";

// One FamilyChain per root (each holds its own tree cache), one per workspace family
// (lib/ens-workspace.ts).
const g = globalThis as unknown as { __ensChains?: Map<string, FamilyChain & { fromBlock: bigint }> };
const chains = (g.__ensChains ??= new Map());

/** The cached chain for `root`, rebuilt when its fromBlock changed (the name was registered again). */
export function chainForRoot(root: string, fromBlock: bigint): FamilyChain {
  const have = chains.get(root);
  if (have && have.fromBlock === fromBlock) return have;
  const chain = Object.assign(createFamilyChain({ root, rpcUrl: process.env.SEPOLIA_RPC, fromBlock }), { fromBlock });
  chains.set(root, chain);
  return chain;
}

/** Drop the cached chain (and so its tree) for `root`, after a write changed the tree. */
export function forgetFamilyChain(root: string): void {
  chains.delete(root);
}

/** A Sepolia reader for availability and ownership checks (lib/ens-family/availability.ts). Read-only. */
export function ensReader(): PublicClient {
  const gr = globalThis as unknown as { __ensReader?: PublicClient };
  return (gr.__ensReader ??= createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com"),
  }) as PublicClient);
}

export function sendSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required for send links");
  return s;
}
