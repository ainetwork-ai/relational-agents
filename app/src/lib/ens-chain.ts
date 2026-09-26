// app/src/lib/ens-chain.ts
// The app's view of the ENS family (spec: ens/plan-family-namespace.md).
import "server-only";
import { createFamilyChain, type FamilyChain } from "@/lib/ens-family/chain";

// One FamilyChain per root (each holds its own tree cache), shared by the env fallback and
// by every workspace family (lib/ens-workspace.ts).
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

/** The deployment's family from ENS_FAMILY_ROOT — the fallback for workspaces without their own.
 *  null when ENS_FAMILY_ROOT is not set on this server. */
export function familyChain(): FamilyChain | null {
  const root = process.env.ENS_FAMILY_ROOT?.trim();
  if (!root) return null;
  return chainForRoot(root, BigInt(process.env.ENS_FAMILY_FROM_BLOCK ?? "0"));
}

export function sendSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required for send links");
  return s;
}
