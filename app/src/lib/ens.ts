import "server-only";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  labelhash,
  namehash,
  toHex,
  type Hex,
} from "viem";
import { normalize } from "viem/ens";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

/**
 * ENS as the agent's identity layer (ens/PLAN.md).
 *
 * At birth (right after registerRelationalAgent confirms) the relayer mints
 * `<slug(room)>-<room6>.${ENS_PARENT_NAME}` on Sepolia ENS, writes the
 * ENSIP-26 agent records (agent-context + agent-endpoint[a2a|mcp|web]) and
 * the ENSIP-25 attestation (agent-registration[<ERC-7930 registry>][id]="1"),
 * then hands the name to the agent's own wallet. Best-effort throughout —
 * ENS being down never blocks a birth.
 */

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

// Names are UNWRAPPED (current controller); subnames go through the registry.
const REGISTRY_ABI = [
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setOwner",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "owner", type: "address" },
    ],
    outputs: [],
  },
] as const;

const RESOLVER_ABI = [
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "a", type: "address" },
    ],
    outputs: [],
  },
] as const;

function env() {
  const parent = process.env.ENS_PARENT_NAME;
  const registry = (process.env.ENS_REGISTRY ??
    "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e") as Hex;
  const resolver = process.env.ENS_PUBLIC_RESOLVER as Hex | undefined;
  const key = (process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY) as Hex | undefined;
  if (!parent || !resolver || !key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return { parent, registry, resolver, key };
}

/** ERC-7930 interoperable address (eip155): 0x0001 version · 0x0000 chainType ·
 * chainRefLen · chainRef (minimal big-endian chain id) · 0x14 · address. */
export function erc7930Address(chainId: number, address: string): string {
  let ref = chainId.toString(16);
  if (ref.length % 2) ref = "0" + ref;
  const addr = address.toLowerCase().replace(/^0x/, "");
  const refLen = toHex(ref.length / 2, { size: 1 }).slice(2);
  return `0x00010000${refLen}${ref}14${addr}`;
}

/** ENSIP-25 text record key for a registry entry. */
export function agentRegistrationKey(chainId: number, registry: string, agentId: string): string {
  return `agent-registration[${erc7930Address(chainId, registry)}][${agentId}]`;
}

/** DNS-safe label from the room name (ASCII-ish slug + room id prefix). */
export function agentLabel(roomName: string, roomId: string): string {
  const slug =
    roomName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "relation";
  return `${slug}-${roomId.slice(0, 6)}`;
}

export interface AgentEnsInput {
  roomId: string;
  roomName: string;
  agentWallet: string; // the name's final owner
  agentId: string; // ERC-8004 tokenId
  registryAddress: string;
  a2aUrl?: string | null;
  mcpUrl?: string | null;
  webUrl?: string | null;
  avatarUrl?: string | null;
}

/** Mints the agent's subname + ENSIP-25/26 records. Returns the name or null. */
export async function mintAgentSubname(input: AgentEnsInput): Promise<string | null> {
  const cfg = env();
  if (!cfg) return null;
  try {
    const account = privateKeyToAccount(cfg.key);
    const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

    const label = agentLabel(input.roomName, input.roomId);
    const name = normalize(`${label}.${cfg.parent}`);
    const parentNode = namehash(normalize(cfg.parent));
    const node = namehash(name);

    // 1) subname → relayer first (so it can write records), agent wallet after
    const mintTx = await wallet.writeContract({
      address: cfg.registry,
      abi: REGISTRY_ABI,
      functionName: "setSubnodeRecord",
      args: [parentNode, labelhash(label), account.address, cfg.resolver, BigInt(0)],
    });
    await pub.waitForTransactionReceipt({ hash: mintTx, timeout: 120_000 });

    // 2) ENSIP-26 records + ENSIP-25 attestation in one multicall
    const context = JSON.stringify({
      name,
      type: "relational-agent",
      relationship: input.roomName,
      registry: input.registryAddress,
      chainId: sepolia.id,
      agentId: input.agentId,
      endpoints: { a2a: input.a2aUrl, mcp: input.mcpUrl, web: input.webUrl },
    });
    const texts: [string, string][] = [
      ["agent-context", context],
      [agentRegistrationKey(sepolia.id, input.registryAddress, input.agentId), "1"],
      ["description", `Relational agent of ${input.roomName} — born by mutual consent`],
    ];
    if (input.a2aUrl) texts.push(["agent-endpoint[a2a]", input.a2aUrl]);
    if (input.mcpUrl) texts.push(["agent-endpoint[mcp]", input.mcpUrl]);
    if (input.webUrl) texts.push(["agent-endpoint[web]", input.webUrl]);
    if (input.avatarUrl) texts.push(["avatar", input.avatarUrl]);
    const calls: Hex[] = texts.map(([k, v]) =>
      encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [node, k, v] })
    );
    calls.push(
      encodeFunctionData({
        abi: RESOLVER_ABI,
        functionName: "setAddr",
        args: [node, input.agentWallet as Hex],
      })
    );
    const recTx = await wallet.writeContract({
      address: cfg.resolver,
      abi: RESOLVER_ABI,
      functionName: "multicall",
      args: [calls],
    });
    await pub.waitForTransactionReceipt({ hash: recTx, timeout: 120_000 });

    // 3) the agent owns its own name (ENSIP-25: attestation by the name owner)
    if (/^0x[0-9a-fA-F]{40}$/.test(input.agentWallet)) {
      const xferTx = await wallet.writeContract({
        address: cfg.registry,
        abi: REGISTRY_ABI,
        functionName: "setOwner",
        args: [node, input.agentWallet as Hex],
      });
      await pub.waitForTransactionReceipt({ hash: xferTx, timeout: 120_000 });
    }
    return name;
  } catch (err) {
    console.error("ENS subname mint failed:", err);
    return null;
  }
}

/** ENSIP-25 verification: registry data → key → resolve on the claimed name. */
export async function verifyAgentName(
  name: string,
  registryAddress: string,
  agentId: string
): Promise<boolean> {
  try {
    const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
    const value = await pub.getEnsText({
      name: normalize(name),
      key: agentRegistrationKey(sepolia.id, registryAddress, agentId),
    });
    return !!value;
  } catch {
    return false;
  }
}
