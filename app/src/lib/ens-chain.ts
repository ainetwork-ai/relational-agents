// app/src/lib/ens-chain.ts
// The app's view of the ENS family (spec: ens/plan-family-namespace.md).
import "server-only";
import { createFamilyChain, type FamilyChain } from "@/lib/ens-family/chain";

let chain: FamilyChain | null = null;

/** null when ENS_FAMILY_ROOT is not set on this server. */
export function familyChain(): FamilyChain | null {
  const root = process.env.ENS_FAMILY_ROOT?.trim();
  if (!root) return null;
  if (chain?.root !== root)
    chain = createFamilyChain({ root, rpcUrl: process.env.SEPOLIA_RPC, fromBlock: BigInt(process.env.ENS_FAMILY_FROM_BLOCK ?? "0") });
  return chain;
}

export function sendSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required for send links");
  return s;
}
