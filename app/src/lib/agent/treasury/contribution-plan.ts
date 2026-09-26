/**
 * Members' recurring contributions into the pot, through Permit2 — the pure half, shared by the
 * server (contributions.ts) and the member's browser (the start and stop flows): the contract on
 * Base, the calls a member's wallet makes, the salt the app starts a member's plan with, and what
 * each period of a plan shows.
 *
 * The contract is uniswap/contracts/RecurringContribution.sol. Its address is recorded in
 * uniswap/contracts/deployments/base.json and repeated here because the Docker build context is
 * app/ alone; uniswap/test/contribution-address.test.js keeps the two equal.
 */
import { encodeAbiParameters, keccak256, parseAbi, toBytes } from "viem";

export const CONTRIBUTION_CHAIN = {
  chainId: 8453,
  contract: "0xE441d2DFa70fF34a20b98ddDB71433Ce8bDfC2E5",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  usdcDecimals: 6,
  explorer: "https://basescan.org",
} as const;

export const contributionAbi = parseAbi([
  "struct Plan { address member; address pot; address token; uint160 amountPerPeriod; uint48 period; uint48 startedAt; uint48 until; uint48 stoppedAt; uint256 pulled; }",
  "function plansOf(address pot) view returns (bytes32[] ids, Plan[] list)",
  "function start(address pot, address token, uint160 amountPerPeriod, uint48 period, uint48 until, bytes32 salt) returns (bytes32 id)",
  "function pull(bytes32 id)",
  "function stop(bytes32 id)",
  "error BadPlan()",
  "error PlanExists()",
  "error NoPlan()",
  "error NotMember()",
  "error PlanStopped()",
  "error PlanEnded()",
  "error AlreadyPulledThisPeriod(uint48 index)",
]);

/** Permit2's AllowanceTransfer calls a member makes, and the errors a pull can meet there. */
export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "error AllowanceExpired(uint256 deadline)",
  "error InsufficientAllowance(uint256 amount)",
]);

export const usdcAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

/**
 * The salt the app starts a room member's plan with. planId(member, pot, token, salt) then names
 * the member who started it in the app, without a table: the server tries each room member's salt.
 * A plan started elsewhere matches nobody and shows as its wallet.
 */
export function contributionSalt(roomId: string, userId: string): `0x${string}` {
  return keccak256(toBytes(`ainmem-contribution:${roomId}:${userId}`));
}

/** RecurringContribution.planId — keccak256(abi.encode(member, pot, token, salt)). */
export function contributionPlanId(member: `0x${string}`, pot: `0x${string}`, token: `0x${string}`, salt: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }], [member, pot, token, salt])
  );
}

/** A plan as the contract stores it (seconds, and the token's smallest unit). */
export interface PlanOnChain {
  member: `0x${string}`;
  pot: `0x${string}`;
  token: `0x${string}`;
  amountPerPeriod: bigint;
  period: number;
  startedAt: number;
  until: number;
  /** 0 while the plan runs */
  stoppedAt: number;
  /** bit i is set once period i was pulled */
  pulled: bigint;
}

/**
 * collected — pulled; due — the period now running, not pulled yet; missed — a period that ended
 * without a pull; upcoming — not begun; stopped — not pulled, and the member stopped the plan before
 * the period ended.
 */
export type PeriodState = "collected" | "due" | "missed" | "upcoming" | "stopped";

export interface PeriodView {
  index: number;
  /** unix seconds */
  startsAt: number;
  state: PeriodState;
}

/** How many periods the plan has: start() allows pulls until `until`, so the last one may be short. */
export function periodCount(p: Pick<PlanOnChain, "period" | "startedAt" | "until">): number {
  return Math.ceil((p.until - p.startedAt) / p.period);
}

export function isCollected(p: Pick<PlanOnChain, "pulled">, index: number): boolean {
  return (p.pulled >> BigInt(index)) & BigInt(1) ? true : false;
}

/** Every period of the plan and what it shows at `nowS`. */
export function periodStates(p: PlanOnChain, nowS: number): PeriodView[] {
  const out: PeriodView[] = [];
  for (let index = 0; index < periodCount(p); index++) {
    const startsAt = p.startedAt + index * p.period;
    const endsAt = Math.min(startsAt + p.period, p.until);
    let state: PeriodState;
    if (isCollected(p, index)) state = "collected";
    else if (p.stoppedAt !== 0 && p.stoppedAt < endsAt) state = "stopped";
    else if (nowS >= endsAt) state = "missed";
    else if (nowS >= startsAt) state = "due";
    else state = "upcoming";
    out.push({ index, startsAt, state });
  }
  return out;
}

/** May a pull take this plan's money now — running, before its end, this period not pulled yet? */
export function isDue(p: PlanOnChain, nowS: number): boolean {
  if (p.stoppedAt !== 0 || nowS >= p.until || nowS < p.startedAt) return false;
  return !isCollected(p, Math.floor((nowS - p.startedAt) / p.period));
}

/** A member's plan as the Treasury page shows it — GET /api/treasury/[roomId] → wallet.contributions. */
export interface ContributionPlanView {
  id: `0x${string}`;
  member: `0x${string}`;
  /** the room member who started it in the app (contributionSalt), or null: a wallet from outside the app */
  userId: string | null;
  /** whole USDC per period ("0.1"), and the same at demo scale */
  amount: string;
  amountUsd: number;
  periodSeconds: number;
  /** ISO times */
  startedAt: string;
  until: string;
  stoppedAt: string | null;
  periods: { index: number; startsAt: string; state: PeriodState }[];
  /** the member's Permit2 allowance to the contract, whole USDC; null when it couldn't be read */
  allowance: { amount: string; expiresAt: string } | null;
  /** the member's USDC on Base, whole; null when it couldn't be read */
  walletUsdc: string | null;
  /** while the period is due: why its pull would fail now */
  blocked: "wallet-short" | "allowance-short" | "allowance-expired" | null;
}

export interface TreasuryContributions {
  /** off: this server does not use Base; unavailable: Base can't be read now */
  state: "off" | "unavailable" | "ready";
  /** the address plans pay into — the agent's, on Base */
  pot: `0x${string}` | null;
  plans: ContributionPlanView[];
}
