"use client";

// app/src/lib/wallet/ens-issue.ts
// Browser side of Settings → Family names (docs/superpowers/plans/2026-09-26-ens-family-settings.md,
// Tasks 7 and 7b): the admin's MetaMask as a viem WalletClient behind an account/chain guard, a Sepolia
// reader, and the create / renew / add-member runs that call ens-family/issue.ts one approval at a time.
// Progress is kept in localStorage `ens-family:<workspaceId>` so a reload resumes (F9).
import { createPublicClient, createWalletClient, custom, http, type Address, type EIP1193Provider, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { ethRegistrarAbi } from "@/lib/ens-family/abi";
import { ETH_REGISTRAR, MOCK_USDC, SEPOLIA_CHAIN_ID, YEAR_SECONDS } from "@/lib/ens-family/config";
import type { Relation } from "@/lib/ens-family/config";
import {
  addMember,
  deployFamilyContracts,
  registerEthName,
  registerPerson,
  renewEthName,
  type IssueContext,
  type SavedCommit,
  type TxStep,
} from "@/lib/ens-family/issue";
import { getInjectedProvider, toWalletError, WalletSignatureError } from "./provider";
import { ensureChain } from "./sign";

const RPC = process.env.NEXT_PUBLIC_SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";

let reader: PublicClient | null = null;
/** Sepolia reads from the browser (never through the wallet). */
export function sepoliaReader(): PublicClient {
  return (reader ??= createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient);
}

/** Wei on Sepolia. */
export function sepoliaBalance(address: Address): Promise<bigint> {
  return sepoliaReader().getBalance({ address });
}

/**
 * An IssueContext over MetaMask, refusing when MetaMask's account is not the linked wallet
 * (`WalletSignatureError("failed", "wrong-account")`, as sendUsdcTransfer) and switching to Sepolia.
 * The wallet client is pinned to Sepolia, so a chain switched midway fails the next write.
 */
export async function familyContext(expected: Address, onStep?: (s: TxStep) => void): Promise<IssueContext> {
  try {
    const provider = getInjectedProvider();
    if (!provider) throw new WalletSignatureError("no-provider", "No Ethereum wallet detected. Install MetaMask to continue.");
    const transport = custom(provider as unknown as EIP1193Provider);
    const [account] = await createWalletClient({ transport }).requestAddresses();
    if (!account) throw new WalletSignatureError("no-account", "No wallet account is connected.");
    if (account.toLowerCase() !== expected.toLowerCase()) throw new WalletSignatureError("failed", "wrong-account");
    await ensureChain(SEPOLIA_CHAIN_ID);
    const wallet = createWalletClient({ account, chain: sepolia, transport });
    return { pub: sepoliaReader(), account, wallet, onStep };
  } catch (err) {
    throw toWalletError(err);
  }
}

/** Register fee for `years` in MockUSDC units (base + premium). */
export async function registerPrice(label: string, years: number): Promise<bigint> {
  const [base, premium] = await sepoliaReader().readContract({
    address: ETH_REGISTRAR,
    abi: ethRegistrarAbi,
    functionName: "getRegisterPrice",
    args: [label, YEAR_SECONDS * BigInt(years), MOCK_USDC],
  });
  return base + premium;
}

/** Renew fee for `years` in MockUSDC units. */
export function renewPrice(label: string, years: number): Promise<bigint> {
  return sepoliaReader().readContract({
    address: ETH_REGISTRAR,
    abi: ethRegistrarAbi,
    functionName: "getRenewPrice",
    args: [label, YEAR_SECONDS * BigInt(years), MOCK_USDC],
  });
}

/** Seconds left in the grace period of an expired `<label>.eth` (0 when none). */
export async function graceSecondsLeft(label: string): Promise<number> {
  return Number(await sepoliaReader().readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "getRemainingGracePeriod", args: [label] }));
}

// ── saved progress (F9) ──────────────────────────────────────────────────────────────────────────

export interface CreateInput {
  label: string;
  years: number;
  familyAlias: string;
  myLabel: string;
  myAlias: string;
}
export interface SavedRun extends CreateInput {
  account: Address;
  registry?: Address;
  resolver?: Address;
  /** decimal block number of the first deploy */
  fromBlock?: string;
  commit?: SavedCommit;
  steps?: TxStep[];
}

const storeKey = (workspaceId: string) => `ens-family:${workspaceId}`;

export function loadRun(workspaceId: string): SavedRun | null {
  try {
    const raw = localStorage.getItem(storeKey(workspaceId));
    return raw ? (JSON.parse(raw) as SavedRun) : null;
  } catch {
    return null;
  }
}
export function saveRun(workspaceId: string, run: SavedRun): void {
  try {
    localStorage.setItem(storeKey(workspaceId), JSON.stringify(run));
  } catch {
    // private mode: the run still works, it just cannot resume after a reload
  }
}
export function clearRun(workspaceId: string): void {
  try {
    localStorage.removeItem(storeKey(workspaceId));
  } catch {
    // nothing saved
  }
}

// ── the runs ─────────────────────────────────────────────────────────────────────────────────────

/** Server steps shown in the same list as the transactions. */
export const HOLD_KEY = "app:hold";
export const LINK_KEY = "app:link";

/** Every row of the create run, in order, before anything happened. */
export function createStepKeys(input: Pick<CreateInput, "label" | "myLabel">): string[] {
  const root = `${input.label}.eth`;
  const me = `${input.myLabel}.${root}`;
  const e = (s: string) => `eth:${input.label}:${s}`;
  return [HOLD_KEY, `deploy-registry:${root}`, `deploy-resolver:${root}`, e("fee:mint"), e("fee:approve"), e("commit"), e("wait"), e("register"), `deploy-resolver:${me}`, `register:${me}`, LINK_KEY];
}

export function renewStepKeys(label: string): string[] {
  return [`renew:${label}:fee:mint`, `renew:${label}:fee:approve`, `renew:${label}`];
}

/** The server's refusal of a step, with the reason the panel branches on. */
export class FamilyApiError extends Error {
  constructor(public reason: string, message: string, public suggestions: string[] = []) {
    super(message);
  }
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { reason?: string; error?: string; suggestions?: string[] };
  if (!res.ok) throw new FamilyApiError(data.reason ?? `http-${res.status}`, data.error ?? `Request failed (${res.status})`, data.suggestions ?? []);
  return data;
}

/** Drop this workspace's hold on `label` (Cancel, or the name went to someone else). */
export async function releaseHold(workspaceId: string, label: string): Promise<void> {
  await fetch(`/api/workspaces/${workspaceId}/ens/reserve`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familyLabel: label }),
  }).catch(() => undefined);
}

/**
 * Create `<label>.eth` for this workspace: hold it in the app (F14), deploy the family contracts,
 * register the name (commit → wait → register, F12 checks inside), register the admin as the
 * first person, then ask the server to link it (it verifies ownership onchain). Resumes from
 * `saved`; every step's progress goes to `onStep`, and to localStorage after each change.
 * `onWait(untilUnix)`: the commit wait started. Throws WalletSignatureError / NameTakenError /
 * FamilyApiError for the panel to explain.
 */
export async function runCreateFamily(args: {
  workspaceId: string;
  account: Address;
  input: CreateInput;
  saved: SavedRun | null;
  onStep: (s: TxStep) => void;
  onWait?: (untilUnix: number) => void;
}): Promise<{ root: string }> {
  const { workspaceId, account, input } = args;
  const root = `${input.label}.eth`;
  let run: SavedRun = args.saved && args.saved.label === input.label && args.saved.account.toLowerCase() === account.toLowerCase() ? args.saved : { ...input, account, steps: [] };
  const persist = (patch: Partial<SavedRun>) => {
    run = { ...run, ...patch };
    saveRun(workspaceId, run);
  };
  const step = (s: TxStep) => {
    persist({ steps: [...(run.steps ?? []).filter((x) => x.key !== s.key), s] });
    args.onStep(s);
  };
  persist({});

  // F14: held for this workspace before the first approval (renewed on every resume)
  step({ key: HOLD_KEY, label: "hold", hash: null, status: "sent" });
  await postJson(`/api/workspaces/${workspaceId}/ens/reserve`, { familyLabel: input.label });
  step({ key: HOLD_KEY, label: "hold", hash: null, status: "confirmed" });

  const ctx = await familyContext(account, step);
  const minAge = await ctx.pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "MIN_COMMITMENT_AGE" });
  const onStepWithWait = (s: TxStep) => {
    step(s);
    if (s.key === `eth:${input.label}:wait` && s.status === "waiting" && run.commit) args.onWait?.(run.commit.committedAt + Number(minAge) + 5);
  };
  ctx.onStep = onStepWithWait;

  const fam = await deployFamilyContracts(ctx, { familyLabel: input.label, familyAlias: input.familyAlias });
  persist({ registry: fam.registry, resolver: fam.resolver, fromBlock: fam.fromBlock !== null ? fam.fromBlock.toString() : run.fromBlock });

  await registerEthName(ctx, {
    label: input.label,
    registry: fam.registry,
    resolver: fam.resolver,
    years: input.years,
    saved: run.commit,
    onSave: (c) => persist({ commit: c }),
  });

  await registerPerson(ctx, { parentName: root, registry: fam.registry, label: input.myLabel, alias: input.myAlias, relation: null, address: account, treeAddresses: [] });

  step({ key: LINK_KEY, label: "link", hash: null, status: "sent" });
  if (!run.fromBlock) throw new FamilyApiError("no-from-block", "The family registry's deploy block is unknown on this browser.");
  await postJson(`/api/workspaces/${workspaceId}/ens`, { familyLabel: input.label, fromBlock: run.fromBlock });
  step({ key: LINK_KEY, label: "link", hash: null, status: "confirmed" });
  clearRun(workspaceId);
  return { root };
}

/** Renew `<label>.eth` from the linked wallet (any member may, F3). */
export async function runRenew(args: { account: Address; label: string; years: number; onStep: (s: TxStep) => void }): Promise<{ newExpiry: bigint }> {
  const ctx = await familyContext(args.account, args.onStep);
  return renewEthName(ctx, { label: args.label, years: args.years });
}

// ── adding a member on the tree canvas (Task 7b) ─────────────────────────────────────────────────

export interface AddMemberInput {
  /** full name of the person the new member goes under, e.g. grandma.kim.ainmem.eth */
  parentName: string;
  /** first label of that person */
  parentLabel: string;
  /** the registry that person is registered in (their parent's subregistry) */
  parentRegistry: Address;
  /** true when the person already has a subregistry (2 approvals instead of 4) */
  parentHasRegistry: boolean;
  label: string;
  alias: string;
  relation: Relation;
  address: Address;
  /** every address already in the tree (F15: one name per address) */
  treeAddresses: Address[];
}

/** Every row of an add, in order. A person without a subregistry first gets one (deploy + link). */
export function memberStepKeys(input: Pick<AddMemberInput, "parentName" | "label" | "parentHasRegistry">): string[] {
  const name = `${input.label}.${input.parentName}`;
  const branch = input.parentHasRegistry ? [] : [`deploy-registry:${input.parentName}`, `set-subregistry:${input.parentName}`];
  return [...branch, `deploy-resolver:${name}`, `register:${name}`];
}

/** Add a child or spouse from the linked wallet: addMember (issue.ts) one approval at a time.
 *  Resumable onchain: a second run skips what the first one finished (CREATE2 + our resolver). */
export async function runAddMember(args: { account: Address; input: AddMemberInput; onStep: (s: TxStep) => void }): Promise<{ name: string }> {
  const { input } = args;
  const ctx = await familyContext(args.account, args.onStep);
  await addMember(ctx, {
    parentName: input.parentName,
    parentRegistry: input.parentRegistry,
    parentLabel: input.parentLabel,
    label: input.label,
    alias: input.alias,
    relation: input.relation,
    address: input.address,
    treeAddresses: input.treeAddresses,
  });
  return { name: `${input.label}.${input.parentName}` };
}

/** The ETH address `name` resolves to right now, through the Universal Resolver (null when none). */
export async function resolveName(name: string): Promise<Address | null> {
  return (await sepoliaReader().getEnsAddress({ name }).catch(() => null)) ?? null;
}
