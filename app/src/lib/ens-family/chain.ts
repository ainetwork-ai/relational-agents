// GENERATED from ens/src/chain.ts by ens/scripts/sync-to-app.mjs — edit it there, then re-run the script.
// ens/src/chain.ts
// Everything this feature reads from Sepolia. The tree comes from the chain alone
// (spec D1): LabelRegistered logs per registry, records through the Universal Resolver.
import { createPublicClient, erc20Abi, http, parseEventLogs, toHex, zeroAddress, type Address, type Hex } from "viem";
import { packetToBytes } from "viem/ens";
import { sepolia } from "viem/chains";
import { ALIAS_KEY, AVATAR_KEY, RELATION_KEY, RELATIONS, SEPOLIA_USDC, UNIVERSAL_HELPER, type Relation } from "./config";
import { registryAbi, universalHelperAbi } from "./abi";
import type { FamilyNode } from "./family-tree";

export interface FamilyChain {
  root: string;
  loadTree(): Promise<FamilyNode>;
  verifyPath(name: string): Promise<boolean>;
  resolveAddress(name: string): Promise<Address | null>;
  balances(address: Address): Promise<{ usdcMicro: bigint; ethWei: bigint }>;
  findTransfer(txHash: Hex, expect: { from: Address; to: Address; amountMicro: bigint }): Promise<boolean>;
}

export const dnsEncode = (name: string): Hex => toHex(packetToBytes(name));

export function createFamilyChain(opts: { root: string; rpcUrl?: string; fromBlock?: bigint; cacheMs?: number }): FamilyChain {
  const client = createPublicClient({
    chain: sepolia,
    transport: http(opts.rpcUrl ?? "https://ethereum-sepolia-rpc.publicnode.com"),
  });
  const fromBlock = opts.fromBlock ?? BigInt(0);
  const cacheMs = opts.cacheMs ?? 60_000;
  let cache: { at: number; tree: FamilyNode } | null = null;

  async function childLabels(registry: Address): Promise<string[]> {
    const logs = await client.getLogs({ address: registry, event: registryAbi[3], fromBlock, toBlock: "latest" });
    const labels = [...new Set(logs.map((l) => l.args.label).filter((l): l is string => !!l))];
    // an unregistered or expired label has no resolver any more
    const live = await Promise.all(
      labels.map(async (l) => (await client.readContract({ address: registry, abi: registryAbi, functionName: "getResolver", args: [l] })) !== zeroAddress)
    );
    return labels.filter((_, i) => live[i]);
  }

  async function readNode(name: string, label: string, registry: Address): Promise<FamilyNode> {
    const [alias, relation, avatar, address] = await Promise.all([
      client.getEnsText({ name, key: ALIAS_KEY }).catch(() => null),
      client.getEnsText({ name, key: RELATION_KEY }).catch(() => null),
      client.getEnsText({ name, key: AVATAR_KEY }).catch(() => null),
      client.getEnsAddress({ name }).catch(() => null),
    ]);
    const children: FamilyNode[] = [];
    if (registry !== zeroAddress) {
      for (const l of await childLabels(registry)) {
        const sub = await client.readContract({ address: registry, abi: registryAbi, functionName: "getSubregistry", args: [l] });
        children.push(await readNode(`${l}.${name}`, l, sub));
      }
    }
    return {
      name,
      label,
      alias: alias || null,
      relation: RELATIONS.includes(relation as Relation) ? (relation as Relation) : null,
      avatar: avatar || null,
      address: address ?? null,
      children,
    };
  }

  return {
    root: opts.root,

    async loadTree() {
      if (cache && Date.now() - cache.at < cacheMs) return cache.tree;
      const registry = await client.readContract({
        address: UNIVERSAL_HELPER,
        abi: universalHelperAbi,
        functionName: "findExactRegistry",
        args: [dnsEncode(opts.root)],
      });
      const tree = await readNode(opts.root, opts.root.split(".")[0], registry);
      cache = { at: Date.now(), tree };
      return tree;
    },

    // every ancestor of `name` has a live registry link: a stale tree cannot send money astray
    async verifyPath(name) {
      const regs = await client.readContract({
        address: UNIVERSAL_HELPER,
        abi: universalHelperAbi,
        functionName: "findRegistries",
        args: [dnsEncode(name)],
      });
      // regs[0] is name's own subregistry (zero for a leaf); every entry above it must exist
      return regs.length > 1 && regs.slice(1).every((r) => r !== zeroAddress);
    },

    async resolveAddress(name) {
      return (await client.getEnsAddress({ name }).catch(() => null)) ?? null;
    },

    async balances(address) {
      const [usdcMicro, ethWei] = await Promise.all([
        client.readContract({ address: SEPOLIA_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
        client.getBalance({ address }),
      ]);
      return { usdcMicro, ethWei };
    },

    async findTransfer(txHash, expect) {
      const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
      if (receipt.status !== "success") return false;
      const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
      return logs.some(
        (l) =>
          l.address.toLowerCase() === SEPOLIA_USDC.toLowerCase() &&
          l.args.from.toLowerCase() === expect.from.toLowerCase() &&
          l.args.to.toLowerCase() === expect.to.toLowerCase() &&
          l.args.value === expect.amountMicro
      );
    },
  };
}
