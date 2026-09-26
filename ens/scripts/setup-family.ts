// ens/scripts/setup-family.ts
// One-off: issue the demo family as ENSv2 names on Sepolia, through ens/src/issue.ts.
//
//   cd ens && npm run setup-family -- demo-family.json            # plan only
//   ENS_SETUP_KEY=0x… npm run setup-family -- demo-family.json --send
//
// Writes are irreversible. Without --send nothing is sent: it prints each step and whether it is
// already done (set ENS_SETUP_ADDRESS to plan as that account without its key; no key is loaded).
// Resumable: proxies are found again at their CREATE2 address and a name already registered with our
// resolver is skipped; a name held by anyone else stops the run (NameTakenError).
// ENS_SETUP_SALTS=account uses the per-account salts of the app; the default "legacy" matches the kim demo.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalize } from "viem/ens";
import { sepolia } from "viem/chains";
import { ethNameStatus } from "../src/availability";
import { ALIAS_KEY } from "../src/config";
import {
  addMember,
  deployFamilyContracts,
  deployRegistry,
  deployResolver,
  NameTakenError,
  registerEthName,
  registerPerson,
  registerSubname,
  walletSender,
  type IssueContext,
  type Sender,
  type TxStep,
} from "../src/issue";

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

const rpc = http(process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com");
const pub = createPublicClient({ chain: sepolia, transport: rpc });
const key = SEND ? (process.env.ENS_SETUP_KEY as Hex | undefined) : undefined; // plan-only never reads a key
if (SEND && !key) throw new Error("ENS_SETUP_KEY is required with --send");
const signer = key ? privateKeyToAccount(key) : null;
const me = (signer?.address ?? (process.env.ENS_SETUP_ADDRESS as Address | undefined) ?? zeroAddress) as Address;

// plan only: print what would be sent, broadcast nothing
const planSender: Sender = {
  async send(_req, step) {
    console.log(`  (would send) ${step.label}`);
    return null;
  },
  async waitUntil() {},
};
const sender = signer ? walletSender(createWalletClient({ account: signer, chain: sepolia, transport: rpc }), pub, me) : planSender;

const counts: Record<TxStep["status"], number> = { sent: 0, confirmed: 0, skipped: 0, waiting: 0, simulated: 0 };
const ctx: IssueContext = {
  pub,
  account: me,
  sender,
  saltScheme: process.env.ENS_SETUP_SALTS === "account" ? "account" : "legacy",
  onStep: (s) => {
    counts[s.status]++;
    const mark = { sent: "→", confirmed: "✓", skipped: "·", waiting: "…", simulated: "~" }[s.status];
    console.log(`${mark} ${s.status.padEnd(9)} ${s.key}${s.hash ? `  tx ${s.hash}` : ""}`);
  },
};

let firstBlock: bigint | null = null;
try {
  // 1) the parent .eth name, e.g. ainmem.eth (its own registry and resolver, alias only)
  const parentName = `${cfg.parent}.eth`;
  const status = await ethNameStatus(pub, cfg.parent, me);
  if (status.status === "taken") throw new NameTakenError(parentName);
  const parentRegistry = await deployRegistry(ctx, parentName);
  const parentResolver = await deployResolver(ctx, { name: parentName, texts: [[ALIAS_KEY, cfg.parent]], owner: null });
  firstBlock = parentRegistry.sent?.blockNumber ?? null;
  await registerEthName(ctx, { label: cfg.parent, registry: parentRegistry.address, resolver: parentResolver.address });

  // 2) the family root, e.g. kim.ainmem.eth
  const familyName = `${cfg.family}.${parentName}`;
  const family = await deployFamilyContracts(ctx, { familyLabel: cfg.family, familyAlias: cfg.familyAlias, familyName });
  firstBlock ??= family.fromBlock;
  await registerSubname(ctx, { parentName, parentRegistry: parentRegistry.address, label: cfg.family, owner: me, subregistry: family.registry, resolver: family.resolver });

  // 3) members, parents before children. `holding` = the registry a person's label lives in;
  const holding = new Map<string, Address>();
  const nameOf = (p: string[]) => [...p].reverse().join(".") + "." + familyName;
  for (const m of [...cfg.members].sort((a, b) => a.path.length - b.path.length)) {
    const k = m.path.join("/");
    const label = m.path[m.path.length - 1];
    const treeAddresses = cfg.members.filter((o) => o !== m).map((o) => o.address);
    if (m.path.length === 1) {
      await registerPerson(ctx, { parentName: familyName, registry: family.registry, label, alias: m.alias, relation: m.relation, address: m.address, treeAddresses });
      holding.set(k, family.registry);
      continue;
    }
    const parentPath = m.path.slice(0, -1);
    const pk = parentPath.join("/");
    const { registry } = await addMember(ctx, {
      parentName: nameOf(parentPath),
      parentRegistry: holding.get(pk)!,
      parentLabel: parentPath[parentPath.length - 1],
      label,
      alias: m.alias,
      relation: m.relation ?? "son",
      address: m.address,
      treeAddresses,
    });
    holding.set(k, registry);
  }

  console.log(
    `\n${SEND ? "Done." : "Plan only (add --send to broadcast)."} ${counts.skipped} skipped, ${counts.confirmed} confirmed, ${counts.simulated} to send.` +
      `\nFor app/.env.local and the MCP server:\n  ENS_FAMILY_ROOT=${familyName}\n  ENS_FAMILY_FROM_BLOCK=${firstBlock ?? process.env.ENS_SETUP_FROM_BLOCK ?? "<unchanged: nothing new was deployed>"}`

  );
} catch (e) {
  if (e instanceof NameTakenError) {
    console.error(`✗ ${e.message} — pick another label; nothing of someone else's is adopted.`);
    process.exit(1);
  }
  throw e;
}
