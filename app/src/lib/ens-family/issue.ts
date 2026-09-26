// GENERATED from ens/src/issue.ts by ens/scripts/sync-to-app.mjs — edit it there, then re-run the script.
// ens/src/issue.ts
// Wallet-agnostic writes for a family tree (plan task 3): the browser runs these with the admin's
// MetaMask, the CLI with a key. Every write goes through one `Sender`; the default one simulates,
// broadcasts and waits for the receipt, a check script can swap in one that only simulates.
//
// Resumable, never adopting (F13): a proxy is found again at the CREATE2 address this account would
// have deployed it to, and a name already registered counts as done only when it is ours (our
// resolver, our owner). Anything else stops with NameTakenError before a paid step.
// No Node imports: this file runs in the browser too.
import {
  concatHex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getContractAddress,
  keccak256,
  labelhash,
  parseEventLogs,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type WalletClient,
} from "viem";
import { namehash } from "viem/ens";
import { ethRegistrarAbi, factoryAbi, mockUsdcAbi, permissionedRegistryAbi, registryAbi, resolverAbi, userRegistryInitAbi } from "./abi";
import { ethNameStatus, subnameStatus } from "./availability";
import { dnsEncode } from "./chain";
import {
  ALIAS_KEY,
  ALL_ROLES,
  CLASS_KEY,
  ETH_REGISTRAR,
  ETH_REGISTRY,
  MOCK_USDC,
  PERMISSIONED_RESOLVER_IMPL,
  RELATION_KEY,
  USER_REGISTRY_IMPL,
  VERIFIABLE_FACTORY,
  VERIFIABLE_PROXY_LOGIC,
  YEAR_SECONDS,
  type Relation,
} from "./config";

/** One row of the step list. `key` is stable across runs, so a resumed run updates the same row.
 *  simulated: the sender only simulated it (nothing broadcast). A `waiting` row ends `confirmed`. */
export interface TxStep {
  key: string;
  label: string;
  hash: Hex | null;
  status: "sent" | "confirmed" | "skipped" | "waiting" | "simulated";
}

export interface WriteRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}
export interface Sent {
  hash: Hex;
  blockNumber: bigint;
  /** block timestamp, unix seconds */
  timestamp: number;
  logs: Log[];
}
/** Where every write goes. `send` resolves once the write is final; null means nothing was
 *  broadcast (a simulate-only sender). `waitUntil` resolves once chain time is ≥ `unixSeconds`. */
export interface Sender {
  send(req: WriteRequest, step: { key: string; label: string }, onSent: (hash: Hex) => void): Promise<Sent | null>;
  waitUntil(unixSeconds: number): Promise<void>;
}

export interface IssueContext {
  pub: PublicClient;
  account: Address;
  /** Used for the default sender when `sender` is not given. */
  wallet?: WalletClient;
  sender?: Sender;
  onStep?: (s: TxStep) => void;
  /** "legacy": the salts of the first CLI run (kim.ainmem.eth), which did not include the account. */
  saltScheme?: "account" | "legacy";
}

export class NameTakenError extends Error {
  constructor(public name: string) {
    super(`${name} is already taken`);
  }
}
export class NotRenewableError extends Error {
  constructor(public label: string) {
    super(`${label}.eth cannot be renewed (it is past its grace period, or was never registered)`);
  }
}
export class AddressInTreeError extends Error {
  constructor(public address: Address) {
    super(`${address} already has a name in this family`);
  }
}

const ROLE_SET_ADDRESS = BigInt(1); // PermissionedResolverLib: the person keeps their own address
export const FAR_EXPIRY = BigInt(4102444800); // 2100-01-01: names below the .eth root never expire on their own
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const COMMIT_MARGIN_S = 5;

const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();

// ── sender ─────────────────────────────────────────────────────────────────────────────────────

/** Simulate, broadcast with `wallet`, wait for the receipt; a revert throws. */
export function walletSender(wallet: WalletClient, pub: PublicClient, account: Address): Sender {
  return {
    async send(req, step, onSent) {
      // viem types each request per call site; these helpers take them loosely
      const call = { ...req, account } as unknown as Parameters<PublicClient["simulateContract"]>[0];
      await pub.simulateContract(call);
      const hash = await wallet.writeContract({ ...req, account, chain: wallet.chain } as unknown as Parameters<WalletClient["writeContract"]>[0]);
      onSent(hash);
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error(`${step.label}: reverted (${hash})`);
      const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
      return { hash, blockNumber: receipt.blockNumber, timestamp: Number(block.timestamp), logs: receipt.logs };
    },
    async waitUntil(t) {
      for (;;) {
        const block = await pub.getBlock();
        if (Number(block.timestamp) >= t) return;
        await new Promise((r) => setTimeout(r, 3000));
      }
    },
  };
}

function senderOf(ctx: IssueContext): Sender {
  if (ctx.sender) return ctx.sender;
  if (!ctx.wallet) throw new Error("IssueContext needs a wallet or a sender");
  return walletSender(ctx.wallet, ctx.pub, ctx.account);
}

const emit = (ctx: IssueContext, s: TxStep) => ctx.onStep?.(s);
const skip = (ctx: IssueContext, key: string, label: string) => emit(ctx, { key, label, hash: null, status: "skipped" });

async function write(ctx: IssueContext, key: string, label: string, req: WriteRequest): Promise<Sent | null> {
  const sent = await senderOf(ctx).send(req, { key, label }, (hash) => emit(ctx, { key, label, hash, status: "sent" }));
  emit(ctx, { key, label, hash: sent?.hash ?? null, status: sent ? "confirmed" : "simulated" });
  return sent;
}

// ── deterministic proxies ────────────────────────────────────────────────────────────────────────

/** The caller's salt for a proxy. `tag` is e.g. `registry:<name>` or `resolver:<name>`. */
export function proxySalt(account: Address, tag: string, scheme: "account" | "legacy" = "account"): bigint {
  const text = scheme === "legacy" ? `ainmem-family:${tag}` : `ainmem-family:${account.toLowerCase()}:${tag}`;
  return BigInt(keccak256(toHex(text)));
}

/** Where VerifiableFactory.deployProxy(_, salt, _) from `deployer` lands: CREATE2 with
 *  outerSalt = keccak256(abi.encode(deployer, salt)) over the salted EIP-1167 clone (CloneProxyBytecode). */
export function predictProxy(deployer: Address, salt: bigint): Address {
  const outer = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [deployer, salt]));
  const initCode = concatHex(["0x3d604d80600a3d3981f3363d3d373d3d3d363d73", VERIFIABLE_PROXY_LOGIC, "0x5af43d82803e903d91602b57fd5bf3", outer]);
  return getContractAddress({ opcode: "CREATE2", from: VERIFIABLE_FACTORY, salt: outer, bytecode: initCode });
}

const saltOf = (ctx: IssueContext, tag: string) => proxySalt(ctx.account, tag, ctx.saltScheme ?? "account");
export const predictRegistry = (ctx: Pick<IssueContext, "account" | "saltScheme">, name: string) =>
  predictProxy(ctx.account, proxySalt(ctx.account, `registry:${name}`, ctx.saltScheme ?? "account"));
export const predictResolver = (ctx: Pick<IssueContext, "account" | "saltScheme">, name: string) =>
  predictProxy(ctx.account, proxySalt(ctx.account, `resolver:${name}`, ctx.saltScheme ?? "account"));

const hasCode = async (pub: PublicClient, a: Address) => ((await pub.getCode({ address: a })) ?? "0x") !== "0x";

async function deployProxy(ctx: IssueContext, key: string, label: string, implementation: Address, tag: string, data: Hex) {
  const address = predictProxy(ctx.account, saltOf(ctx, tag));
  if (await hasCode(ctx.pub, address)) {
    skip(ctx, key, label);
    return { address, sent: null, existed: true };
  }
  const sent = await write(ctx, key, label, { address: VERIFIABLE_FACTORY, abi: factoryAbi, functionName: "deployProxy", args: [implementation, saltOf(ctx, tag), data] });
  if (sent) {
    const [ev] = parseEventLogs({ abi: factoryAbi, eventName: "ProxyDeployed", logs: sent.logs });
    if (!ev || !same(ev.args.proxyAddress, address)) throw new Error(`${label}: deployed at ${ev?.args.proxyAddress}, expected ${address}`);
  }
  return { address, sent, existed: false };
}

/** A UserRegistry for the names below `name`; the account holds ALL roles. */
export async function deployRegistry(ctx: IssueContext, name: string) {
  const data = encodeFunctionData({ abi: userRegistryInitAbi, functionName: "initialize", args: [[{ account: ctx.account, roleBitmap: ALL_ROLES }]] });
  return deployProxy(ctx, `deploy-registry:${name}`, `Create the registry for names under ${name}`, USER_REGISTRY_IMPL, `registry:${name}`, data);
}

const recordsAbi = [
  { type: "function", name: "resolve", stateMutability: "view", inputs: [{ name: "name", type: "bytes" }, { name: "data", type: "bytes" }], outputs: [{ type: "bytes" }] },
  { type: "function", name: "text", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }, { name: "key", type: "string" }], outputs: [{ type: "string" }] },
  { type: "function", name: "addr", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }, { name: "coinType", type: "uint256" }], outputs: [{ type: "bytes" }] },
] as const;
// records are only readable through ENSIP-10 resolve()
async function readRecord(pub: PublicClient, resolver: Address, name: string, data: Hex) {
  return pub.readContract({ address: resolver, abi: recordsAbi, functionName: "resolve", args: [dnsEncode(name), data] });
}
const textOf = async (pub: PublicClient, resolver: Address, name: string, key: string) =>
  decodeFunctionResult({ abi: recordsAbi, functionName: "text", data: await readRecord(pub, resolver, name, encodeFunctionData({ abi: recordsAbi, functionName: "text", args: [namehash(name), key] })) });
const ethAddrOf = async (pub: PublicClient, resolver: Address, name: string) =>
  decodeFunctionResult({ abi: recordsAbi, functionName: "addr", data: await readRecord(pub, resolver, name, encodeFunctionData({ abi: recordsAbi, functionName: "addr", args: [namehash(name), BigInt(60)] })) });

/** A resolver for `name` with these text records (and `owner` as its ETH address, which that wallet may change). */
export async function deployResolver(ctx: IssueContext, input: { name: string; texts: [string, string][]; owner: Address | null }) {
  const { name, texts, owner } = input;
  const calls = texts.map(([k, v]) => encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode(name), k, v] }));
  if (owner) calls.push(encodeFunctionData({ abi: resolverAbi, functionName: "setAddress", args: [dnsEncode(name), BigInt(60), owner] }));
  const grants = [{ account: ctx.account, roleBitmap: ALL_ROLES }];
  if (owner) grants.push({ account: owner, roleBitmap: ROLE_SET_ADDRESS });
  const predicted = predictResolver(ctx, name);
  if (await hasCode(ctx.pub, predicted)) {
    // the salt only covers the name: a resolver left by an earlier run must hold these records
    for (const [k, v] of texts) {
      const got = await textOf(ctx.pub, predicted, name, k);
      if (got !== v) throw new Error(`${name}: the resolver ${predicted} from an earlier run has ${k}="${got}", not "${v}"`);
    }
    const got = await ethAddrOf(ctx.pub, predicted, name);
    if (got.toLowerCase() !== (owner ?? "0x").toLowerCase()) throw new Error(`${name}: the resolver ${predicted} from an earlier run has addr ${got}, not ${owner}`);
  }
  const data = encodeFunctionData({ abi: resolverAbi, functionName: "initialize", args: [grants, calls] });
  return deployProxy(ctx, `deploy-resolver:${name}`, `Create the records of ${name}`, PERMISSIONED_RESOLVER_IMPL, `resolver:${name}`, data);
}

// ── family root (.eth) ───────────────────────────────────────────────────────────────────────────

/** The family registry (account holds ALL roles) and the family resolver (alias, class=Family).
 *  `familyName` defaults to `<familyLabel>.eth` (kim.ainmem.eth predates the .eth root).
 *  fromBlock: the first deploy's block, null when both already existed (keep the saved one). */
export async function deployFamilyContracts(
  ctx: IssueContext,
  input: { familyLabel: string; familyAlias: string; familyName?: string }
): Promise<{ registry: Address; resolver: Address; fromBlock: bigint | null }> {
  const name = input.familyName ?? `${input.familyLabel}.eth`;
  // a .eth root someone else holds must stop here, before the first paid deploy (F12)
  if (!input.familyName && (await ethNameStatus(ctx.pub, input.familyLabel, ctx.account, predictRegistry(ctx, name))).status === "taken") throw new NameTakenError(name);
  const reg = await deployRegistry(ctx, name);
  const res = await deployResolver(ctx, { name, texts: [[ALIAS_KEY, input.familyAlias], [CLASS_KEY, "Family"]], owner: null });
  return { registry: reg.address, resolver: res.address, fromBlock: reg.sent?.blockNumber ?? res.sent?.blockNumber ?? null };
}

/** Mint MockUSDC (open mint on Sepolia) and approve the registrar when balance/allowance are short. */
async function ensureFunds(ctx: IssueContext, keyPrefix: string, amount: bigint) {
  const [balance, allowance] = await Promise.all([
    ctx.pub.readContract({ address: MOCK_USDC, abi: erc20Abi, functionName: "balanceOf", args: [ctx.account] }),
    ctx.pub.readContract({ address: MOCK_USDC, abi: erc20Abi, functionName: "allowance", args: [ctx.account, ETH_REGISTRAR] }),
  ]);
  const mintKey = `${keyPrefix}:mint`;
  const approveKey = `${keyPrefix}:approve`;
  if (balance < amount) await write(ctx, mintKey, "Get the test USDC for the fee", { address: MOCK_USDC, abi: mockUsdcAbi, functionName: "mint", args: [ctx.account, amount - balance] });
  else skip(ctx, mintKey, "Get the test USDC for the fee");
  if (allowance < amount) await write(ctx, approveKey, "Allow the registrar to take the fee", { address: MOCK_USDC, abi: mockUsdcAbi, functionName: "approve", args: [ETH_REGISTRAR, amount] });
  else skip(ctx, approveKey, "Allow the registrar to take the fee");
}

export type SavedCommit = { secret: Hex; committedAt: number };

/** `<label>.eth` through the ETHRegistrar: mint + approve MockUSDC, commit, wait, register — with
 *  availability re-checked before the first paid step, before commit and before register (F12).
 *  `saved` (from `onSave`) lets a reload reuse a live commitment instead of paying for a new one. */
export async function registerEthName(
  ctx: IssueContext,
  input: { label: string; registry: Address; resolver: Address; years?: number; saved?: SavedCommit; onSave?: (s: SavedCommit) => void }
): Promise<{ name: string }> {
  const { label, registry, resolver } = input;
  const name = `${label}.eth`;
  const duration = YEAR_SECONDS * BigInt(input.years ?? 1);
  const k = (s: string) => `eth:${label}:${s}`;
  const labels = {
    mint: "Get the test USDC for the fee",
    approve: "Allow the registrar to take the fee",
    commit: `Reserve ${name} (commit)`,
    wait: "Wait for the registrar",
    register: `Register ${name}`,
  };
  const recheck = async () => {
    const s = await ethNameStatus(ctx.pub, label, ctx.account, registry);
    if (s.status === "taken") throw new NameTakenError(name);
    return s.status;
  };

  // 1. ours already → nothing to do; taken → stop before any paid step
  if ((await recheck()) === "ours") {
    for (const s of ["mint", "approve", "commit", "wait", "register"] as const) skip(ctx, k(s), labels[s]);
    return { name };
  }

  // 2. the fee
  const [base, premium] = await ctx.pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "getRegisterPrice", args: [label, duration, MOCK_USDC] });
  await ensureFunds(ctx, k("fee"), base + premium);

  // 3. commit, or reuse a live one
  const [minAge, maxAge] = await Promise.all([
    ctx.pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "MIN_COMMITMENT_AGE" }),
    ctx.pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "MAX_COMMITMENT_AGE" }),
  ]);
  const commitmentOf = (secret: Hex) =>
    ctx.pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "makeCommitment", args: [label, ctx.account, secret, registry, resolver, duration, ZERO32] });
  const nowS = Math.floor(Date.now() / 1000);
  let secret: Hex | null = null;
  let committedAt = 0;
  if (input.saved) {
    const at = Number(await ctx.pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "commitmentAt", args: [await commitmentOf(input.saved.secret)] }));
    // live = on chain and still registerable by the time the wait is over
    if (at > 0 && at + Number(maxAge) > nowS + Number(minAge) + COMMIT_MARGIN_S) {
      secret = input.saved.secret;
      committedAt = at;
      skip(ctx, k("commit"), labels.commit);
    }
  }
  if (!secret) {
    const fresh = toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    await recheck();
    // saved before the commit is sent: a tab closed while it is pending can still find it
    input.onSave?.({ secret: fresh, committedAt: nowS });
    const sent = await write(ctx, k("commit"), labels.commit, { address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "commit", args: [await commitmentOf(fresh)] });
    secret = fresh;
    committedAt = sent?.timestamp ?? nowS;
    input.onSave?.({ secret, committedAt });
  }

  // 4. the registrar refuses a commitment younger than MIN_COMMITMENT_AGE
  emit(ctx, { key: k("wait"), label: labels.wait, hash: null, status: "waiting" });
  await senderOf(ctx).waitUntil(committedAt + Number(minAge) + COMMIT_MARGIN_S);
  emit(ctx, { key: k("wait"), label: labels.wait, hash: null, status: "confirmed" });

  // 5. last check, then register (our own earlier register counts as done)
  if ((await recheck()) === "ours") {
    skip(ctx, k("register"), labels.register);
    return { name };
  }
  await write(ctx, k("register"), labels.register, {
    address: ETH_REGISTRAR,
    abi: ethRegistrarAbi,
    functionName: "register",
    args: [label, ctx.account, secret, registry, resolver, duration, MOCK_USDC, ZERO32],
  });
  return { name };
}

/** Extend `<label>.eth` by `years`. Anyone may renew; the fee comes from the account (F3).
 *  newExpiry: from the NameRenewed log, or the expected one when the sender only simulated. */
export async function renewEthName(ctx: IssueContext, input: { label: string; years: number }): Promise<{ newExpiry: bigint }> {
  const { label } = input;
  const duration = YEAR_SECONDS * BigInt(input.years);
  const renewable = await ctx.pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "isRenewable", args: [label] });
  if (!renewable) throw new NotRenewableError(label);
  const [price, state] = await Promise.all([
    ctx.pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "getRenewPrice", args: [label, duration, MOCK_USDC] }),
    ctx.pub.readContract({ address: ETH_REGISTRY, abi: permissionedRegistryAbi, functionName: "getState", args: [BigInt(labelhash(label))] }),
  ]);
  await ensureFunds(ctx, `renew:${label}:fee`, price);
  const sent = await write(ctx, `renew:${label}`, `Renew ${label}.eth for ${input.years} year${input.years === 1 ? "" : "s"}`, {
    address: ETH_REGISTRAR,
    abi: ethRegistrarAbi,
    functionName: "renew",
    args: [{ label, duration, referrer: ZERO32 }, MOCK_USDC],
  });
  if (sent) {
    const [ev] = parseEventLogs({ abi: ethRegistrarAbi, eventName: "NameRenewed", logs: sent.logs });
    if (ev) return { newExpiry: ev.args.newExpiry };
  }
  return { newExpiry: state.expiry + duration };
}

// ── names inside the family ──────────────────────────────────────────────────────────────────────

/** Register `label` in `parentRegistry` unless it is already ours (resolver = the one this account
 *  deploys for it). taken → NameTakenError before any write; ours → skipped. */
async function registerIn(
  ctx: IssueContext,
  input: { parentName: string; parentRegistry: Address; label: string; owner: Address; subregistry: Address; resolver: Address }
) {
  const name = `${input.label}.${input.parentName}`;
  await write(ctx, `register:${name}`, `Register ${name}`, {
    address: input.parentRegistry,
    abi: registryAbi,
    functionName: "register",
    args: [input.label, input.owner, input.subregistry, input.resolver, BigInt(0), FAR_EXPIRY],
  });
}

/** Status of `label.parentName` against the resolver this account would deploy for it (F13: the
 *  owner alone does not make it ours — only our own resolver does). */
async function memberStatus(ctx: IssueContext, parentName: string, parentRegistry: Address, label: string) {
  const name = `${label}.${parentName}`;
  const status = await subnameStatus(ctx.pub, { parentName, parentRegistry, label, expectResolver: predictResolver(ctx, name) });
  if (status === "taken") throw new NameTakenError(name);
  return status;
}

const refuseInTree = (address: Address, treeAddresses: Address[]) => {
  if (treeAddresses.some((a) => same(a, address))) throw new AddressInTreeError(address);
};

const personTexts = (alias: string, relation: Relation | null): [string, string][] => {
  const texts: [string, string][] = [[ALIAS_KEY, alias], [CLASS_KEY, "Person"]];
  if (relation) texts.push([RELATION_KEY, relation]);
  return texts;
};

/** A name registered in a registry the account controls (the family's own subnames, e.g. kim under
 *  ainmem.eth in the legacy setup): with its own subregistry and resolver, no person records. */
export async function registerSubname(
  ctx: IssueContext,
  input: { parentName: string; parentRegistry: Address; label: string; owner: Address; subregistry: Address; resolver: Address }
): Promise<void> {
  const name = `${input.label}.${input.parentName}`;
  const status = await subnameStatus(ctx.pub, { parentName: input.parentName, parentRegistry: input.parentRegistry, label: input.label, expectResolver: input.resolver });
  if (status === "taken") throw new NameTakenError(name);
  if (status === "ours") return skip(ctx, `register:${name}`, `Register ${name}`);
  await registerIn(ctx, input);
}

/** A person directly under a registry the account controls (the first person). A leaf until
 *  `addMember` gives them a subregistry. */
export async function registerPerson(
  ctx: IssueContext,
  input: { parentName: string; registry: Address; label: string; alias: string; relation: Relation | null; address: Address; treeAddresses: Address[] }
): Promise<{ resolver: Address }> {
  const name = `${input.label}.${input.parentName}`;
  const resolver = predictResolver(ctx, name);
  if ((await memberStatus(ctx, input.parentName, input.registry, input.label)) === "ours") {
    skip(ctx, `deploy-resolver:${name}`, `Create the records of ${name}`);
    skip(ctx, `register:${name}`, `Register ${name}`);
    return { resolver };
  }
  refuseInTree(input.address, input.treeAddresses);
  await deployResolver(ctx, { name, texts: personTexts(input.alias, input.relation), owner: input.address });
  await registerIn(ctx, { parentName: input.parentName, parentRegistry: input.registry, label: input.label, owner: input.address, subregistry: zeroAddress, resolver });
  return { resolver };
}

/** A member under a person (`parentLabel` in `parentRegistry`, full name `parentName`). When the
 *  person has no subregistry yet: deploy one and link it (4 txs), otherwise 2. Returns the
 *  person's subregistry, which holds the new member. */
export async function addMember(
  ctx: IssueContext,
  input: { parentName: string; parentRegistry: Address; parentLabel: string; label: string; alias: string; relation: Relation; address: Address; treeAddresses: Address[] }
): Promise<{ registry: Address }> {
  const name = `${input.label}.${input.parentName}`;
  const linkKey = `set-subregistry:${input.parentName}`;
  const linkLabel = `Make room for names under ${input.parentName}`;
  let registry = await ctx.pub.readContract({ address: input.parentRegistry, abi: registryAbi, functionName: "getSubregistry", args: [input.parentLabel] });

  if (registry !== zeroAddress) {
    skip(ctx, `deploy-registry:${input.parentName}`, `Create the registry for names under ${input.parentName}`);
    skip(ctx, linkKey, linkLabel);
    if ((await memberStatus(ctx, input.parentName, registry, input.label)) === "ours") {
      skip(ctx, `deploy-resolver:${name}`, `Create the records of ${name}`);
      skip(ctx, `register:${name}`, `Register ${name}`);
      return { registry };
    }
    refuseInTree(input.address, input.treeAddresses);
  } else {
    // nobody is under this person yet, so the label is free; a registry left by an earlier run is ours (CREATE2)
    refuseInTree(input.address, input.treeAddresses);
    registry = (await deployRegistry(ctx, input.parentName)).address;
    await write(ctx, linkKey, linkLabel, {
      address: input.parentRegistry,
      abi: registryAbi,
      functionName: "setSubregistry",
      args: [BigInt(labelhash(input.parentLabel)), registry],
    });
  }

  const resolver = (await deployResolver(ctx, { name, texts: personTexts(input.alias, input.relation), owner: input.address })).address;
  await registerIn(ctx, { parentName: input.parentName, parentRegistry: registry, label: input.label, owner: input.address, subregistry: zeroAddress, resolver });
  return { registry };
}
