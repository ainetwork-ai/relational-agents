import "server-only";
import { createWalletClient, createPublicClient, http, keccak256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { relationIdFromRoom } from "@/lib/relation-contract";

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
] as const;

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

function relayerKey(): Hex | null {
  const k = process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY;
  return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null;
}

export interface RelayInput {
  roomId: string;
  /** { addressLowercase: signatureHex } for every signer. */
  signaturesByAddress: Record<string, string>;
  agentUri: string;
}

/** Registers the relationship agent on-chain. Returns { txHash, agentId } or null. */
export async function relayRelationOnChain(input: RelayInput): Promise<{ txHash: string; agentId: string } | null> {
  const address = process.env.NEXT_PUBLIC_RELATION_REGISTRY_ADDRESS as Hex | undefined;
  const key = relayerKey();
  if (!address || address === "0x0000000000000000000000000000000000000000" || !key) return null;

 // parties sorted ascending (the order the contract requires + the domain used)
  const parties = Object.keys(input.signaturesByAddress)
    .map((a) => a.toLowerCase())
    .sort() as Hex[];
  if (parties.length < 2) return null;
  const sigs = parties.map((p) => input.signaturesByAddress[p] as Hex);
  const relationId = relationIdFromRoom(input.roomId) as Hex;

  try {
    const account = privateKeyToAccount(key);
    const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
 // idempotent: if this relation already has an agent on-chain, don't re-send
    const existing = (await pub.readContract({
      address, abi: ABI, functionName: "agentOfRelation", args: [relationId],
    })) as bigint;
    if (existing > BigInt(0)) return { txHash: "", agentId: existing.toString() };

    const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
    const txHash = await wallet.writeContract({
      address, abi: ABI, functionName: "registerRelationalAgent",
      args: [relationId, parties, input.agentUri, sigs],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
    if (receipt.status !== "success") return null;
    const agentId = (await pub.readContract({
      address, abi: ABI, functionName: "agentOfRelation", args: [relationId],
    })) as bigint;
    return { txHash, agentId: agentId.toString() };
  } catch (err) {
    console.error("on-chain relay failed:", err);
    return null;
  }
}

export { keccak256, stringToBytes };
