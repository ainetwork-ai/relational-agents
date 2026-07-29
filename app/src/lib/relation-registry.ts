import "server-only";
import { createWalletClient, createPublicClient, http, keccak256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  humanBackedRegistryAddress,
  relationIdFromRoom,
  relationRegistryAddress,
} from "@/lib/relation-contract";

/**
 * Relay a completed set of RelationConsent signatures to
 * RelationalAgentRegistry.registerRelationalAgent on-chain. The relayer
 * (RELAYER_KEY / DEPLOYER_KEY) pays gas so no member does. Best-effort: returns
 * null if unconfigured or if the tx fails — consent is not blocked by chain.
 */
const ABI = [
  {
    type: "function",
    name: "registerRelationalAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "relationId", type: "bytes32" },
      { name: "parties", type: "address[]" },
      { name: "agentURI", type: "string" },
      { name: "sigs", type: "bytes[]" },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "agentOfRelation",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "dissolveRelationalAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "relationId", type: "bytes32" },
      { name: "sigs", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "dissolvedAt",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "registerHumanBackedAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "relationId", type: "bytes32" },
      { name: "parties", type: "address[]" },
      { name: "agentURI", type: "string" },
      { name: "sigs", type: "bytes[]" },
      { name: "nullifiers", type: "uint256[]" },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "isHumanBacked",
    stateMutability: "view",
    inputs: [{ name: "relationId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "nullifierOf",
    stateMutability: "view",
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const RELATION_REGISTRY_ABI = ABI;

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

function relayerKey(): Hex | null {
  const k = process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY;
  return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null;
}

export interface RelayInput {
  roomId: string;
  /** { addressLowercase: signatureHex } for every signer. */
  signaturesByAddress: Record<string, string>;
  /** { addressLowercase: nullifierHashHex } — one proof-of-personhood per
   * signer. Present + a human-backed registry configured = the agent is born
   * with both humans bound on-chain. */
  nullifiersByAddress?: Record<string, string>;
  agentUri: string;
}

export interface RelayResult {
  txHash: string;
  agentId: string;
  /** true when the registration bound a nullifier per party on-chain. */
  humanBacked?: boolean;
}

/** Registers the relationship agent on-chain. Returns { txHash, agentId } or null. */
export async function relayRelationOnChain(input: RelayInput): Promise<RelayResult | null> {
  const address = relationRegistryAddress() as Hex;
  const key = relayerKey();
  if (!address || address === "0x0000000000000000000000000000000000000000" || !key) return null;

 // parties sorted ascending (the order the contract requires + the domain used)
  const parties = Object.keys(input.signaturesByAddress)
    .map((a) => a.toLowerCase())
    .sort() as Hex[];
  if (parties.length < 2) return null;
  const sigs = parties.map((p) => input.signaturesByAddress[p] as Hex);
  const relationId = relationIdFromRoom(input.roomId) as Hex;

 // Personhood is bound only if every party has a proof AND the deployment we
 // are writing to understands nullifiers. A partial set falls back to the
 // legacy path rather than registering a half-human-backed agent.
  const nulls = input.nullifiersByAddress ?? {};
  const humanBacked =
    humanBackedRegistryAddress() !== null && parties.every((p) => Boolean(nulls[p]));
  const nullifiers = humanBacked ? parties.map((p) => BigInt(nulls[p])) : [];

  try {
    const account = privateKeyToAccount(key);
    const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
 // idempotent: if this relation already has an agent on-chain, don't re-send
    const existing = (await pub.readContract({
      address, abi: ABI, functionName: "agentOfRelation", args: [relationId],
    })) as bigint;
    if (existing > BigInt(0)) return { txHash: "", agentId: existing.toString(), humanBacked };

    const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
    const txHash = humanBacked
      ? await wallet.writeContract({
          address, abi: ABI, functionName: "registerHumanBackedAgent",
          args: [relationId, parties, input.agentUri, sigs, nullifiers],
        })
      : await wallet.writeContract({
          address, abi: ABI, functionName: "registerRelationalAgent",
          args: [relationId, parties, input.agentUri, sigs],
        });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
    if (receipt.status !== "success") return null;
    const agentId = (await pub.readContract({
      address, abi: ABI, functionName: "agentOfRelation", args: [relationId],
    })) as bigint;
    return { txHash, agentId: agentId.toString(), humanBacked };
  } catch (err) {
    console.error("on-chain relay failed:", err);
    return null;
  }
}

/** Asks the chain whether a relationship has a proven human on each side.
 * This is the question a seller asks before it trusts an agent's money. */
export async function readIsHumanBacked(roomId: string): Promise<boolean> {
  const address = humanBackedRegistryAddress();
  if (!address) return false;
  const relationId = relationIdFromRoom(roomId) as Hex;
  const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
  return (await pub.readContract({
    address, abi: ABI, functionName: "isHumanBacked", args: [relationId],
  })) as boolean;
}

/** Relays a completed RelationDissolve set to dissolveRelationalAgent().
 * The agent NFT survives — only dissolvedAt is stamped. Best-effort like the
 * registration relay: returns { txHash, agentId } or null. */
export async function relayDissolveOnChain(input: {
  roomId: string;
  signaturesByAddress: Record<string, string>;
}): Promise<{ txHash: string; agentId: string } | null> {
  const address = relationRegistryAddress() as Hex;
  const key = relayerKey();
  if (!address || address === "0x0000000000000000000000000000000000000000" || !key) return null;

  const parties = Object.keys(input.signaturesByAddress)
    .map((a) => a.toLowerCase())
    .sort() as Hex[];
  if (parties.length < 2) return null;
  const sigs = parties.map((p) => input.signaturesByAddress[p] as Hex);
  const relationId = relationIdFromRoom(input.roomId) as Hex;

  try {
    const account = privateKeyToAccount(key);
    const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
    const agentId = (await pub.readContract({
      address, abi: ABI, functionName: "agentOfRelation", args: [relationId],
    })) as bigint;
    if (agentId === BigInt(0)) return null; // never registered — nothing to dissolve
    const already = (await pub.readContract({
      address, abi: ABI, functionName: "dissolvedAt", args: [relationId],
    })) as bigint;
    if (already > BigInt(0)) return { txHash: "", agentId: agentId.toString() };

    const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
    const txHash = await wallet.writeContract({
      address, abi: ABI, functionName: "dissolveRelationalAgent",
      args: [relationId, sigs],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
    if (receipt.status !== "success") return null;
    return { txHash, agentId: agentId.toString() };
  } catch (err) {
    console.error("on-chain dissolve relay failed:", err);
    return null;
  }
}

export { keccak256, stringToBytes };
