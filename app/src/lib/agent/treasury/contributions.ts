import "server-only";
import { inArray } from "drizzle-orm";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, fallback, formatUnits, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { txLink } from "./approvals";
import {
  CONTRIBUTION_CHAIN as C,
  contributionAbi,
  contributionPlanId,
  contributionSalt,
  isDue,
  periodCount,
  periodStates,
  permit2Abi,
  usdcAbi,
  type ContributionPlanView,
  type PlanOnChain,
  type TreasuryContributions,
} from "./contribution-plan";
import { investConfig } from "./invest";
import { appendTreasuryActivity, humanMemberIds } from "./memory";
import { realRunsEnabled } from "./recurring";
import { agentKey } from "./wallet";

/**
 * Members' recurring contributions into the pot on Base, through Permit2 (contribution-plan.ts has
 * the contract and the pure rules). Reads what the Treasury page shows — every plan that pays into
 * the agent's address, and each member's allowance and USDC — and, on a weekly run, collects the
 * plans that are due: one pull(id) per plan, signed and paid for (gas) by the agent's key. A pull
 * moves only what the member allowed, only into this pot; the contract refuses a second pull in a
 * period.
 */

const RPC_TIMEOUT_MS = 10_000;
/** a pull uses ~80–100k gas; an explicit limit, so a lagging node's estimate cannot fail it */
const PULL_GAS = BigInt(200_000);
const NONCE_POLLS = 20;
const NONCE_POLL_MS = 1_500;

function clients(rpcs: string[]) {
  const transport = fallback(rpcs.map((u) => http(u, { timeout: RPC_TIMEOUT_MS })), { rank: false });
  return { transport, client: createPublicClient({ chain: base, transport }) };
}

const iso = (s: number) => new Date(s * 1000).toISOString();
const usdc = (units: bigint) => formatUnits(units, C.usdcDecimals);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

interface PlanRead {
  id: Hex;
  plan: PlanOnChain;
  allowance: { amount: bigint; expiration: number } | null;
  usdcToPermit2: bigint | null;
  walletUsdc: bigint | null;
}

/** plansOf(pot), then each member's Permit2 allowance, USDC allowance to Permit2 and USDC balance in one multicall. */
async function readPlans(rpcs: string[], pot: `0x${string}`): Promise<PlanRead[]> {
  const { client } = clients(rpcs);
  const [ids, list] = await client.readContract({ address: C.contract, abi: contributionAbi, functionName: "plansOf", args: [pot] });
  if (ids.length === 0) return [];
  const reads = await client.multicall({
    allowFailure: true,
    contracts: list.flatMap((p) => [
      { address: C.permit2, abi: permit2Abi, functionName: "allowance", args: [p.member, p.token, C.contract] } as const,
      { address: p.token, abi: usdcAbi, functionName: "allowance", args: [p.member, C.permit2] } as const,
      { address: p.token, abi: usdcAbi, functionName: "balanceOf", args: [p.member] } as const,
    ]),
  });
  return ids.map((id, i) => {
    const p = list[i];
    const [allow, toPermit2, held] = reads.slice(i * 3, i * 3 + 3);
    return {
      id,
      plan: {
        member: p.member,
        pot: p.pot,
        token: p.token,
        amountPerPeriod: p.amountPerPeriod,
        period: p.period,
        startedAt: p.startedAt,
        until: p.until,
        stoppedAt: p.stoppedAt,
        pulled: p.pulled,
      },
      allowance: allow.status === "success" ? { amount: (allow.result as readonly [bigint, number, number])[0], expiration: (allow.result as readonly [bigint, number, number])[1] } : null,
      usdcToPermit2: toPermit2.status === "success" ? (toPermit2.result as bigint) : null,
      walletUsdc: held.status === "success" ? (held.result as bigint) : null,
    };
  });
}

/** Why this period's pull would fail now, read from what the member's wallet holds and allows. */
function blockedOf(r: PlanRead, nowS: number): ContributionPlanView["blocked"] {
  const need = r.plan.amountPerPeriod;
  if (r.walletUsdc !== null && r.walletUsdc < need) return "wallet-short";
  if (r.allowance && r.allowance.expiration <= nowS) return "allowance-expired";
  if ((r.allowance && r.allowance.amount < need) || (r.usdcToPermit2 !== null && r.usdcToPermit2 < need)) return "allowance-short";
  return null;
}

/** The room member whose app salt produced this plan id, if any. */
function starterOf(roomId: string, memberIds: string[], r: PlanRead): string | null {
  return memberIds.find((userId) => contributionPlanId(r.plan.member, r.plan.pot, r.plan.token, contributionSalt(roomId, userId)) === r.id) ?? null;
}

function viewOf(roomId: string, memberIds: string[], r: PlanRead, usdcPerUsd: number, nowS: number): ContributionPlanView {
  const amount = usdc(r.plan.amountPerPeriod);
  return {
    id: r.id,
    member: r.plan.member,
    userId: starterOf(roomId, memberIds, r),
    amount,
    amountUsd: Math.round((Number(amount) / usdcPerUsd) * 100) / 100,
    periodSeconds: r.plan.period,
    startedAt: iso(r.plan.startedAt),
    until: iso(r.plan.until),
    stoppedAt: r.plan.stoppedAt ? iso(r.plan.stoppedAt) : null,
    periods: periodStates(r.plan, nowS).map((p) => ({ index: p.index, startsAt: iso(p.startsAt), state: p.state })),
    allowance: r.allowance ? { amount: usdc(r.allowance.amount), expiresAt: iso(r.allowance.expiration) } : null,
    walletUsdc: r.walletUsdc === null ? null : usdc(r.walletUsdc),
    blocked: isDue(r.plan, nowS) ? blockedOf(r, nowS) : null,
  };
}

/** Every plan paying into the agent's Base address, as the Treasury page shows it. Read-only. */
export async function contributionsOf(roomId: string, pot: `0x${string}` | null): Promise<TreasuryContributions> {
  const cfg = investConfig();
  if (!cfg) return { state: "off", pot: null, plans: [] };
  if (!pot) return { state: "unavailable", pot: null, plans: [] };
  const [reads, memberIds] = await Promise.all([readPlans(cfg.rpcs, pot), humanMemberIds(roomId)]);
  const nowS = Math.floor(Date.now() / 1000);
  return { state: "ready", pot, plans: reads.map((r) => viewOf(roomId, memberIds, r, cfg.usdcPerUsd, nowS)) };
}

const FRESH_MS = 15_000;
const STALE_MS = 5 * 60_000;
const WAIT_MS = 1_500;
const shown = new Map<string, { at: number; value?: TreasuryContributions; inflight?: Promise<void> }>();

/**
 * contributionsOf for the page's polling, shared per room like displayInvestedPosition: a value under
 * 15 s old as is, an older one (up to five minutes) while a fresh read runs behind it, and a first
 * poll waits WAIT_MS at most. Never for a money decision: collectDueContributions reads its own.
 */
export async function displayContributions(roomId: string, pot: `0x${string}` | null): Promise<TreasuryContributions> {
  if (!investConfig()) return { state: "off", pot: null, plans: [] };
  const key = `${roomId}:${pot ?? ""}`;
  let e = shown.get(key);
  if (!e) shown.set(key, (e = { at: 0 }));
  const entry = e;
  const age = Date.now() - entry.at;
  if (entry.value && age < FRESH_MS) return entry.value;
  entry.inflight ??= contributionsOf(roomId, pot)
    .then((value) => {
      entry.value = value;
      entry.at = Date.now();
    })
    .catch((err: unknown) => console.error("contributions: read failed:", err instanceof Error ? err.message.split("\n")[0] : err))
    .finally(() => {
      entry.inflight = undefined;
    });
  if (entry.value && age < STALE_MS) return entry.value;
  await Promise.race([entry.inflight, new Promise<void>((r) => setTimeout(r, WAIT_MS))]);
  return entry.value && Date.now() - entry.at < STALE_MS ? entry.value : { state: "unavailable", pot, plans: [] };
}

/** The next read shows what a collection just did. */
export function forgetContributions(roomId: string): void {
  for (const key of shown.keys()) if (key.startsWith(`${roomId}:`)) shown.delete(key);
}

// ── collecting ──────────────────────────────────────────────────────────────

export interface Collected {
  id: Hex;
  userId: string | null;
  member: `0x${string}`;
  /** the starter's display name, or the member's short address */
  name: string;
  /** whole USDC */
  amount: string;
  /** 1-based, of `periods` */
  period: number;
  periods: number;
  txHash: Hex;
  txUrl: string;
}

export interface NotCollected {
  id: Hex;
  userId: string | null;
  member: `0x${string}`;
  name: string;
  /** the contract's or Permit2's error name, or why nothing was sent */
  reason: string;
  /** set when a pull was sent and its receipt could not be read or it reverted: it may still have landed */
  txHash?: Hex;
}

/** What a simulated pull's revert says, by name ("InsufficientAllowance", "AlreadyPulledThisPeriod"…). */
function revertName(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) return reverted.data.errorName;
    return err.shortMessage.split("\n")[0].slice(0, 120);
  }
  return String(err).split("\n")[0].slice(0, 120);
}

/**
 * Pulls every plan that is due into the agent's pot, one after another, and writes each to the
 * relation's Treasury Activity. Only with real runs on (TREASURY_RECURRING_REAL=1); otherwise it
 * collects nothing. A plan whose pull would revert — the member's wallet short, the allowance used
 * up — is simulated, not sent. Returns once this client sees every sent pull mined, so a buy sent
 * next gets the right nonce.
 */
export function collectDueContributions(input: { roomId: string; agentUserId: string }): Promise<CollectResult> {
  // one collection per room at a time: two would send from the agent with the same nonce
  const prev = collecting.get(input.roomId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => collectNow(input));
  collecting.set(input.roomId, next);
  return next.finally(() => {
    if (collecting.get(input.roomId) === next) collecting.delete(input.roomId);
  });
}

export interface CollectResult {
  collected: Collected[];
  notCollected: NotCollected[];
}

const collecting = new Map<string, Promise<CollectResult>>();

async function collectNow(input: { roomId: string; agentUserId: string }): Promise<CollectResult> {
  const cfg = investConfig();
  if (!cfg || !realRunsEnabled()) return { collected: [], notCollected: [] };
  const account = privateKeyToAccount(await agentKey(input.agentUserId));
  const { client, transport } = clients(cfg.rpcs);
  const wallet = createWalletClient({ account, chain: base, transport });
  const [reads, memberIds] = await Promise.all([readPlans(cfg.rpcs, account.address), humanMemberIds(input.roomId)]);
  const nowS = Math.floor(Date.now() / 1000);
  const due = reads.filter((r) => isDue(r.plan, nowS));
  const collected: Collected[] = [];
  const notCollected: NotCollected[] = [];
  if (due.length === 0) return { collected, notCollected };
  const names = await namesOf(due.flatMap((r) => { const u = starterOf(input.roomId, memberIds, r); return u ? [u] : []; }));

  let nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
  for (const r of due) {
    const userId = starterOf(input.roomId, memberIds, r);
    const who = { id: r.id, userId, member: r.plan.member, name: (userId && names.get(userId)) || short(r.plan.member) };
    try {
      await client.simulateContract({ account, address: C.contract, abi: contributionAbi, functionName: "pull", args: [r.id] });
    } catch (err) {
      notCollected.push({ ...who, reason: revertName(err) });
      continue;
    }
    let txHash: Hex;
    try {
      txHash = await wallet.writeContract({ address: C.contract, abi: contributionAbi, functionName: "pull", args: [r.id], gas: PULL_GAS, nonce });
    } catch (err) {
      // the RPC refused it — nothing went out; the next plan keeps this nonce
      notCollected.push({ ...who, reason: `the pull could not be sent: ${revertName(err)}` });
      continue;
    }
    nonce++;
    const receipt = await client.waitForTransactionReceipt({ hash: txHash }).catch(() => null);
    if (!receipt || receipt.status !== "success") {
      notCollected.push({ ...who, reason: receipt ? "the pull reverted on Base" : "the pull's receipt could not be read", txHash });
      continue;
    }
    collected.push({
      ...who,
      amount: usdc(r.plan.amountPerPeriod),
      period: Math.floor((nowS - r.plan.startedAt) / r.plan.period) + 1,
      periods: periodCount(r.plan),
      txHash,
      txUrl: `${C.explorer}/tx/${txHash}`,
    });
  }
  // a buy sent after this fetches its own nonce: wait until this client's node counts our pulls
  for (let i = 0; i < NONCE_POLLS && (await client.getTransactionCount({ address: account.address })) < nonce; i++)
    await new Promise((r) => setTimeout(r, NONCE_POLL_MS));

  await logCollection(input.roomId, collected, notCollected, cfg.usdcPerUsd);
  forgetContributions(input.roomId);
  return { collected, notCollected };
}

async function namesOf(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/** One Treasury Activity line per pull sent, and one per plan that could not be collected. */
/** "$20" — a USDC amount at the demo scale the rest of the treasury speaks in */
export function storyUsd(amount: string, usdcPerUsd: number): string {
  return `$${Math.round(Number(amount) / usdcPerUsd)}`;
}

async function logCollection(roomId: string, collected: Collected[], notCollected: NotCollected[], usdcPerUsd: number): Promise<void> {
  const lines = [
    ...collected.map(
      (c) => `Contribution through Permit2: ${c.name}, ${c.amount} USDC (${storyUsd(c.amount, usdcPerUsd)}) · period ${c.period} of ${c.periods} · ${txLink(c.txHash, C.explorer)}`
    ),
    ...notCollected
      .filter((c) => c.reason !== "AlreadyPulledThisPeriod")
      .map((c) => `Contribution not collected: ${c.name} — ${c.reason}${c.txHash ? ` · ${txLink(c.txHash, C.explorer)}` : ""}`),
  ];
  await appendTreasuryActivity(roomId, lines).catch((err: unknown) => console.error("contributions: activity append failed:", err));
}
