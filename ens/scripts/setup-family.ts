// ens/scripts/setup-family.ts
// One-off: issue the demo family as ENSv2 names on Sepolia.
//
//   cd ens && npm run setup-family -- demo-family.json            # plan only
//   ENS_SETUP_KEY=0x… npm run setup-family -- demo-family.json --send
//
// Writes are irreversible. Without --send it only prints what it would do
// (set ENS_SETUP_ADDRESS to plan as that account without its key).
// Resumable: a label that already has a resolver is skipped, and a proxy whose
// deploy already went through is found again from the factory's logs.
// The logs are searched over the last ~6 days; resuming later, set ENS_SETUP_FROM_BLOCK.
import fs from "node:fs";
import { createPublicClient, createWalletClient, decodeFunctionResult, encodeFunctionData, formatEther, http, keccak256, parseAbi, parseEventLogs, toHex, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash, normalize } from "viem/ens";
import { sepolia } from "viem/chains";
import { ethRegistrarAbi, factoryAbi, mockUsdcAbi, registryAbi, resolverAbi, universalHelperAbi, userRegistryInitAbi } from "../src/abi";
import { dnsEncode } from "../src/chain";
import {
  ALIAS_KEY,
  CLASS_KEY,
  ETH_REGISTRAR,
  ETH_REGISTRY,
  MOCK_USDC,
  PERMISSIONED_RESOLVER_IMPL,
  RELATION_KEY,
  UNIVERSAL_HELPER,
  USER_REGISTRY_IMPL,
  VERIFIABLE_FACTORY,
} from "../src/config";

interface Member { path: string[]; alias: string; relation: "son" | "daughter" | "spouse" | null; address: Address }
interface Config { parent: string; family: string; familyAlias: string; members: Member[] }

const [configPath, flag] = process.argv.slice(2);
const SEND = flag === "--send";
const cfg = JSON.parse(fs.readFileSync(configPath, "utf8")) as Config;
const paths = new Set(cfg.members.map((m) => m.path.join("/")));
for (const label of [cfg.parent, cfg.family, ...cfg.members.flatMap((m) => m.path)]) {
  if (label.includes(".") || normalize(label) !== label) throw new Error(`"${label}": labels must be normalized and dot-free`);
}
for (const m of cfg.members) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(m.address) || /^0x0{10}/.test(m.address)) throw new Error(`member ${m.path.join("/")}: set a real address`);
  if (m.path.length > 1 && !paths.has(m.path.slice(0, -1).join("/"))) throw new Error(`member ${m.path.join("/")}: its parent is not a member`);
}

const ALL_ROLES = BigInt("0x" + "1".repeat(64)); // every role and its admin (EAC nybbles)
const ROLE_SET_ADDRESS = 1n << 0n; // PermissionedResolverLib
const FAR_EXPIRY = 4102444800n; // 2100-01-01
const PARENT_DURATION = 365n * 24n * 3600n; // renew the parent yearly: the family stops resolving when it expires
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const PLACEHOLDER = `0x${"de".repeat(20)}` as Address; // plan-only stand-in for an address a write would create
const LOG_LOOKBACK = 45_000n; // blocks the factory logs are searched when resuming (public RPCs cap the range)

const rpc = http(process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com");
const pub = createPublicClient({ chain: sepolia, transport: rpc });
const key = process.env.ENS_SETUP_KEY as Hex | undefined;
if (SEND && !key) throw new Error("ENS_SETUP_KEY is required with --send");
const account = key ? privateKeyToAccount(key) : null;
const wallet = account ? createWalletClient({ account, chain: sepolia, transport: rpc }) : null;
const me = (account?.address ?? (process.env.ENS_SETUP_ADDRESS as Address | undefined) ?? zeroAddress) as Address;

const salt = (tag: string) => BigInt(keccak256(toHex(`ainmem-family:${tag}`)));
let firstBlock: bigint | null = null;
let spentWei = 0n;

// a writeContract request; viem types it per call site, so this helper takes it loosely
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Req = any;
async function send(desc: string, req: Req): Promise<Hex | null> {
  console.log(`${SEND ? "→" : "·"} ${desc}`);
  if (!SEND) return null;
  await pub.simulateContract({ ...req, account: account! });
  const hash = await wallet!.writeContract(req);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${desc}: reverted (${hash})`);
  firstBlock ??= receipt.blockNumber;
  spentWei += receipt.gasUsed * receipt.effectiveGasPrice;
  console.log(`  tx ${hash} (block ${receipt.blockNumber}, ${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} ETH)`);
  return hash;
}

// proxies this account already deployed, by salt (a run that stopped between a deploy and its register)
let deployed: Map<bigint, { proxy: Address; block: bigint }> | null = null;
async function deployedProxies() {
  if (me === zeroAddress) return new Map<bigint, { proxy: Address; block: bigint }>();
  if (!deployed) {
    const latest = await pub.getBlockNumber();
    const fromBlock = process.env.ENS_SETUP_FROM_BLOCK ? BigInt(process.env.ENS_SETUP_FROM_BLOCK) : latest - LOG_LOOKBACK;
    const logs = await pub.getLogs({ address: VERIFIABLE_FACTORY, event: factoryAbi[1], args: { sender: me }, fromBlock, toBlock: latest });
    deployed = new Map(logs.map((l) => [l.args.salt!, { proxy: l.args.proxyAddress!, block: l.blockNumber }])); // the event carries the caller's salt
  }
  return deployed;
}
const alreadyDeployed = async (s: bigint) => (await deployedProxies()).get(s)?.proxy ?? null;

async function deploy(desc: string, implementation: Address, tag: string, data: Hex): Promise<Address> {
  const found = await alreadyDeployed(salt(tag));
  if (found) {
    console.log(`· ${desc}: already deployed at ${found}`);
    return found;
  }
  const hash = await send(desc, { address: VERIFIABLE_FACTORY, abi: factoryAbi, functionName: "deployProxy", args: [implementation, salt(tag), data] });
  if (!hash) return PLACEHOLDER;
  const receipt = await pub.getTransactionReceipt({ hash });
  const [ev] = parseEventLogs({ abi: factoryAbi, eventName: "ProxyDeployed", logs: receipt.logs });
  console.log(`  at ${ev.args.proxyAddress}`);
  return ev.args.proxyAddress;
}

const newRegistry = (tag: string) =>
  deploy(`deploy UserRegistry for ${tag}`, USER_REGISTRY_IMPL, `registry:${tag}`, encodeFunctionData({ abi: userRegistryInitAbi, functionName: "initialize", args: [[{ account: me, roleBitmap: ALL_ROLES }]] }));

const recordsAbi = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "function text(bytes32 node, string key) view returns (string)",
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
]);
// records are only readable through ENSIP-10 resolve()
const resolveCall = (resolver: Address, name: string, data: Hex) =>
  pub.readContract({ address: resolver, abi: recordsAbi, functionName: "resolve", args: [dnsEncode(name), data] });
const textOf = async (resolver: Address, name: string, key: string) =>
  decodeFunctionResult({ abi: recordsAbi, functionName: "text", data: await resolveCall(resolver, name, encodeFunctionData({ abi: recordsAbi, functionName: "text", args: [namehash(name), key] })) });
const ethAddrOf = async (resolver: Address, name: string) =>
  decodeFunctionResult({ abi: recordsAbi, functionName: "addr", data: await resolveCall(resolver, name, encodeFunctionData({ abi: recordsAbi, functionName: "addr", args: [namehash(name), 60n] })) });

async function newResolver(name: string, texts: [string, string][], owner: Address | null): Promise<Address> {
  const calls = texts.map(([k, v]) => encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode(name), k, v] }));
  if (owner) calls.push(encodeFunctionData({ abi: resolverAbi, functionName: "setAddress", args: [dnsEncode(name), 60n, owner] }));
  const grants = [{ account: me, roleBitmap: ALL_ROLES }];
  if (owner) grants.push({ account: owner, roleBitmap: ROLE_SET_ADDRESS }); // the person keeps their own address
  const found = await alreadyDeployed(salt(`resolver:${name}`));
  if (found) {
    // the salt only covers the name: a resolver left by an earlier run must hold this config's records
    for (const [k, v] of texts) {
      const got = await textOf(found, name, k);
      if (got !== v) throw new Error(`${name}: resolver ${found} from an earlier run has ${k}="${got}", config says "${v}"; fix it onchain or rename`);
    }
    const got = await ethAddrOf(found, name);
    if (got.toLowerCase() !== (owner ?? "0x").toLowerCase()) throw new Error(`${name}: resolver ${found} from an earlier run has addr ${got}, config says ${owner}`);
  }
  return deploy(`deploy resolver for ${name}`, PERMISSIONED_RESOLVER_IMPL, `resolver:${name}`, encodeFunctionData({ abi: resolverAbi, functionName: "initialize", args: [grants, calls] }));
}

// the label's subregistry (zero for a leaf) if it is already registered in `registry`, else null
async function existing(registry: Address, label: string, name: string, needsSub: boolean): Promise<Address | null> {
  if (registry === PLACEHOLDER) return null;
  const resolver = await pub.readContract({ address: registry, abi: registryAbi, functionName: "getResolver", args: [label] });
  if (resolver === zeroAddress) return null;
  const sub = await pub.readContract({ address: registry, abi: registryAbi, functionName: "getSubregistry", args: [label] });
  if (needsSub && sub === zeroAddress) throw new Error(`${name} is registered without a subregistry, but the config has names under it; set one first`);
  return sub;
}

// 1) parent name, e.g. ainmem.eth
const parentName = `${cfg.parent}.eth`;
let parentRegistry = (await pub.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: [cfg.parent] })) as Address;
const available = await pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "isAvailable", args: [cfg.parent] });
if (available) {
  parentRegistry = await newRegistry(parentName);
  const parentResolver = await newResolver(parentName, [[ALIAS_KEY, cfg.parent]], null);
  const [base, premium] = await pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "getRegisterPrice", args: [cfg.parent, PARENT_DURATION, MOCK_USDC] });
  const secret = keccak256(toHex(`ainmem-family-secret:${Date.now()}`));
  await send(`mint ${base + premium} MockUSDC`, { address: MOCK_USDC, abi: mockUsdcAbi, functionName: "mint", args: [me, base + premium] });
  await send("approve ETHRegistrar", { address: MOCK_USDC, abi: mockUsdcAbi, functionName: "approve", args: [ETH_REGISTRAR, base + premium] });
  const minAge = await pub.readContract({ address: ETH_REGISTRAR, abi: parseAbi(["function MIN_COMMITMENT_AGE() view returns (uint64)"]), functionName: "MIN_COMMITMENT_AGE" });
  const commitment = await pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "makeCommitment", args: [cfg.parent, me, secret, parentRegistry, parentResolver, PARENT_DURATION, ZERO32] });
  await send(`commit ${parentName}`, { address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "commit", args: [commitment] });
  if (SEND) await new Promise((r) => setTimeout(r, Number(minAge + 5n) * 1000));
  await send(`register ${parentName}`, { address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "register", args: [cfg.parent, me, secret, parentRegistry, parentResolver, PARENT_DURATION, MOCK_USDC, ZERO32] });
} else {
  const owner = await pub.readContract({ address: UNIVERSAL_HELPER, abi: universalHelperAbi, functionName: "findExactOwner", args: [dnsEncode(parentName)] });
  if (owner.toLowerCase() !== me.toLowerCase()) throw new Error(`${parentName} belongs to ${owner}; pick another "parent" (or pass ENS_SETUP_KEY if it is ours)`);
  if (parentRegistry === zeroAddress) throw new Error(`${parentName} has no subregistry; set one before running this`);
  console.log(`· ${parentName} already ours, registry ${parentRegistry}`);
}

// 2) the family root, e.g. kim.ainmem.eth
const familyName = `${cfg.family}.${parentName}`;
const registries = new Map<string, Address>(); // path key ("" = family) → its subregistry
const needsRegistry = (k: string) => cfg.members.some((m) => m.path.slice(0, -1).join("/") === k);
const familyRegistry = await existing(parentRegistry, cfg.family, familyName, true);
if (familyRegistry !== null) {
  console.log(`· ${familyName} already registered, registry ${familyRegistry}`);
  registries.set("", familyRegistry);
} else {
  registries.set("", await newRegistry(familyName));
  const familyResolver = await newResolver(familyName, [[ALIAS_KEY, cfg.familyAlias], [CLASS_KEY, "Family"]], null);
  await send(`register ${familyName}`, { address: parentRegistry, abi: registryAbi, functionName: "register", args: [cfg.family, me, registries.get("")!, familyResolver, 0n, FAR_EXPIRY] });
}

// 3) members, parents before children; names cannot be transferred (no ROLE_CAN_TRANSFER_ADMIN)
for (const m of [...cfg.members].sort((a, b) => a.path.length - b.path.length)) {
  const k = m.path.join("/");
  const name = [...m.path].reverse().join(".") + "." + familyName;
  const parentReg = registries.get(m.path.slice(0, -1).join("/"))!;
  const sub = await existing(parentReg, m.path.at(-1)!, name, needsRegistry(k));
  if (sub !== null) {
    console.log(`· ${name} already registered, registry ${sub}`);
    registries.set(k, sub);
    continue;
  }
  const texts: [string, string][] = [[ALIAS_KEY, m.alias], [CLASS_KEY, "Person"]];
  if (m.relation) texts.push([RELATION_KEY, m.relation]);
  const resolver = await newResolver(name, texts, m.address);
  const newSub = needsRegistry(k) ? await newRegistry(name) : zeroAddress;
  registries.set(k, newSub);
  await send(`register ${name} → ${m.address}`, { address: parentReg, abi: registryAbi, functionName: "register", args: [m.path.at(-1)!, m.address, newSub, resolver, 0n, FAR_EXPIRY] });
}

// the tree is read from logs, so the earliest block matters, including earlier runs' deploys
const blocks = [...(await deployedProxies()).values()].map((d) => d.block);
if (firstBlock !== null) blocks.push(firstBlock);
const fromBlock = blocks.length ? blocks.reduce((a, b) => (a < b ? a : b)) : null;

console.log(
  `\n${SEND ? `Done (${formatEther(spentWei)} ETH spent this run).` : "Plan only (add --send to broadcast)."}\nFor app/.env.local and the MCP server:\n  ENS_FAMILY_ROOT=${familyName}\n  ENS_FAMILY_FROM_BLOCK=${fromBlock ?? "<first block after --send>"}`
);
