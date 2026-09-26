// ens/src/availability.ts
// Is a name free? Read-only answers from the chain (plan F11–F15). The global .eth registry is the
// only judge of a family name; nothing here asks the app's DB. `ours` always means the owner matched:
// a name someone else holds is `taken`, never adopted (F13).
import { labelhash, zeroAddress, type Address, type PublicClient } from "viem";
import { accessControlAbi, ethRegistrarAbi, permissionedRegistryAbi, registryAbi, universalHelperAbi } from "./abi";
import { dnsEncode } from "./chain";
import { ALL_ROLES, ETH_REGISTRAR, ETH_REGISTRY, MOCK_USDC, UNIVERSAL_HELPER, YEAR_SECONDS } from "./config";
import { checkLabel, suggestLabels } from "./labels";

export type NameStatus = "free" | "ours" | "taken";
export type EthNameStatus = {
  status: NameStatus;
  /** Only for `free`: the 1-year fee in MockUSDC units (6 decimals); `premium` is non-zero for a recently expired name. */
  price?: { base: bigint; premium: bigint };
  /** Only for `ours`: the name expired and is in its grace period (renewable, not resolving). */
  inGrace?: boolean;
};

/** Just what these reads need, so any viem public client (browser or server) fits. */
type Reader = Pick<PublicClient, "readContract">;

const same = (a: Address | undefined, b: Address | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const STATUS_AVAILABLE = 0; // IPermissionedRegistry.Status: 0 AVAILABLE · 1 RESERVED · 2 REGISTERED

async function exactOwner(pub: Reader, name: string): Promise<Address> {
  return pub.readContract({ address: UNIVERSAL_HELPER, abi: universalHelperAbi, functionName: "findExactOwner", args: [dnsEncode(name)] });
}

async function ethState(pub: Reader, label: string) {
  return pub.readContract({ address: ETH_REGISTRY, abi: permissionedRegistryAbi, functionName: "getState", args: [BigInt(labelhash(label))] });
}

async function graceLeft(pub: Reader, label: string): Promise<number> {
  return Number(await pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "getRemainingGracePeriod", args: [label] }));
}

/** `<label>.eth` in the global registry (F11, F13). `ours` = owned by `me` and, when given, its
 *  subregistry is `expectRegistry`. In the grace period nothing resolves, so `ours` there means the
 *  registry's last owner is `me` (the subregistry cannot be read until it is renewed). */
export async function ethNameStatus(pub: Reader, label: string, me?: Address, expectRegistry?: Address): Promise<EthNameStatus> {
  const available = await pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "isAvailable", args: [label] });
  if (available) {
    const [base, premium] = await pub.readContract({
      address: ETH_REGISTRAR,
      abi: ethRegistrarAbi,
      functionName: "getRegisterPrice",
      args: [label, YEAR_SECONDS, MOCK_USDC],
    });
    return { status: "free", price: { base, premium } };
  }
  if (!me) return { status: "taken" };
  const owner = await exactOwner(pub, `${label}.eth`);
  if (owner !== zeroAddress) {
    if (!same(owner, me)) return { status: "taken" };
    if (expectRegistry) {
      const sub = await pub.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: [label] });
      if (!same(sub, expectRegistry)) return { status: "taken" };
    }
    return { status: "ours" };
  }
  // not available and no live owner: reserved, or expired and still in its grace period
  const state = await ethState(pub, label);
  if (same(state.latestOwner, me) && (await graceLeft(pub, label)) > 0) return { status: "ours", inGrace: true };
  return { status: "taken" };
}

/** `<label>.<parentName>` under a family registry (F15). Taken when it has an owner or a resolver
 *  (a name registered without a resolver still has an owner). `ours` = its resolver is
 *  `expectResolver` or its owner is `expectOwner`. */
export async function subnameStatus(
  pub: Reader,
  input: { parentName: string; parentRegistry: Address; label: string; expectResolver?: Address; expectOwner?: Address }
): Promise<NameStatus> {
  const [owner, resolver] = await Promise.all([
    exactOwner(pub, `${input.label}.${input.parentName}`),
    pub.readContract({ address: input.parentRegistry, abi: registryAbi, functionName: "getResolver", args: [input.label] }),
  ]);
  if (owner === zeroAddress && resolver === zeroAddress) return "free";
  if (resolver !== zeroAddress && same(resolver, input.expectResolver)) return "ours";
  if (owner !== zeroAddress && same(owner, input.expectOwner)) return "ours";
  return "taken";
}

/** Does `account` hold every role (and its admin) in the ROOT_RESOURCE of this registry/resolver? */
export async function holdsAllRoles(pub: Reader, contract: Address, account: Address): Promise<boolean> {
  return pub.readContract({ address: contract, abi: accessControlAbi, functionName: "hasRootRoles", args: [ALL_ROLES, account] });
}

/** Up to `n` .eth labels built from `base` that are free right now (suggestLabels + ethNameStatus). */
export async function availableSuggestions(pub: Reader, base: string, n = 3): Promise<string[]> {
  const candidates = suggestLabels(base, n + 6).filter((l) => checkLabel(l, { min: 3 }).ok);
  const free = await Promise.all(candidates.map(async (l) => (await ethNameStatus(pub, l)).status === "free"));
  return candidates.filter((_, i) => free[i]).slice(0, n);
}

/** When `<label>.eth` expires (unix seconds), for the banner and the tree header. null when it was
 *  never registered or is past its grace period (free again). A reserved name reports its reservation's expiry. */
export async function ethExpiry(pub: Reader, label: string): Promise<{ expiresAt: number; inGrace: boolean; graceLeft: number } | null> {
  const state = await ethState(pub, label);
  if (state.expiry === BigInt(0)) return null;
  if (state.status !== STATUS_AVAILABLE) return { expiresAt: Number(state.expiry), inGrace: false, graceLeft: 0 };
  const left = state.latestOwner === zeroAddress ? 0 : await graceLeft(pub, label);
  return left > 0 ? { expiresAt: Number(state.expiry), inGrace: true, graceLeft: left } : null;
}
