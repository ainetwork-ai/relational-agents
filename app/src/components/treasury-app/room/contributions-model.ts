/**
 * Pure logic for the members' recurring contributions on the Treasury page: this month's totals,
 * the viewer's own plan and its state, and the by-person × by-month grid. Months and days are on
 * the relation's clock (TREASURY_TIME_ZONE). No React, no fetch. The plans come from
 * wallet.contributions (lib/agent/treasury/contributions.ts); a period's state is contribution-plan.ts's.
 */

import type { ContributionPlanView, PeriodState } from "@/lib/agent/treasury/contribution-plan";
import { TREASURY_TIME_ZONE } from "@/lib/agent/treasury/types";
import type { TreasuryRoomPerson } from "./room-types";

export const WEEK_S = 7 * 24 * 3600;
/** the periods a member can pick when starting a plan; "monthly" is thirty days, as the contract counts seconds */
export const PERIODS = [
  { seconds: WEEK_S, key: "weekly" },
  { seconds: 2 * WEEK_S, key: "fortnightly" },
  { seconds: 30 * 24 * 3600, key: "monthly" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export function periodKeyOf(seconds: number): PeriodKey | null {
  return PERIODS.find((p) => p.seconds === seconds)?.key ?? null;
}

const monthFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TREASURY_TIME_ZONE, year: "numeric", month: "2-digit" });
/** "2026-09" on the relation's clock */
export function monthKey(iso: string | number): string {
  return monthFmt.format(new Date(iso)).slice(0, 7);
}

function nextMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** A plan that still runs: not stopped and not past its end. */
export function isRunning(plan: ContributionPlanView, now: number): boolean {
  return plan.stoppedAt === null && new Date(plan.until).getTime() > now;
}

export type PlanStatus = "active" | "blocked" | "stopped" | "ended";

export function planStatus(plan: ContributionPlanView, now: number): PlanStatus {
  if (plan.stoppedAt !== null) return "stopped";
  if (new Date(plan.until).getTime() <= now) return "ended";
  return plan.blocked ? "blocked" : "active";
}

export const collectedCount = (plan: ContributionPlanView) => plan.periods.filter((p) => p.state === "collected").length;

/** When the next pull may come: now while a period is due, else the next period's start; null when none is left. */
export function nextCollection(plan: ContributionPlanView): { at: string; now: boolean } | null {
  if (plan.stoppedAt !== null) return null;
  const due = plan.periods.find((p) => p.state === "due");
  if (due) return { at: due.startsAt, now: true };
  const next = plan.periods.find((p) => p.state === "upcoming");
  return next ? { at: next.startsAt, now: false } : null;
}

/** The viewer's plan to show: a running one first, else the most recently started. */
export function myPlan(plans: ContributionPlanView[], meId: string, now: number): ContributionPlanView | null {
  const mine = plans.filter((p) => p.userId === meId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return mine.find((p) => isRunning(p, now)) ?? mine[0] ?? null;
}

export interface MonthTotals {
  /** at demo scale */
  collectedUsd: number;
  expectedUsd: number;
}

/** Periods that begin in `month` across all plans: what came in, and what was due to (a stop ends what is expected). */
export function monthTotals(plans: ContributionPlanView[], month: string): MonthTotals {
  let collectedUsd = 0;
  let expectedUsd = 0;
  for (const plan of plans)
    for (const p of plan.periods) {
      if (monthKey(p.startsAt) !== month || p.state === "stopped") continue;
      expectedUsd += plan.amountUsd;
      if (p.state === "collected") collectedUsd += plan.amountUsd;
    }
  return { collectedUsd: round2(collectedUsd), expectedUsd: round2(expectedUsd) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── the grid ────────────────────────────────────────────────────────────────

export interface GridCell {
  planId: string;
  index: number;
  startsAt: string;
  state: PeriodState;
  amount: string;
  amountUsd: number;
  /** a plan whose period is longer than two weeks takes a wide cell */
  wide: boolean;
}

export interface GridRow {
  key: string;
  person: TreasuryRoomPerson | null;
  /** the wallet for a plan started outside the app */
  wallet: `0x${string}` | null;
  plans: ContributionPlanView[];
  /** cells per month key, in period order */
  byMonth: Record<string, GridCell[]>;
  collectedUsd: number;
}

/** The months the grid shows: from the earliest plan's start (or this month) through the latest end, three at least, six at most. */
export function gridMonths(plans: ContributionPlanView[], now: number): string[] {
  const starts = plans.map((p) => monthKey(p.startedAt));
  const ends = plans.map((p) => monthKey(new Date(p.until).getTime() - 1));
  let first = [monthKey(now), ...starts].sort()[0];
  const last = [monthKey(now), ...ends].sort().at(-1) as string;
  const out: string[] = [];
  while (out.length < 6 && (first <= last || out.length < 3)) {
    out.push(first);
    first = nextMonth(first);
  }
  return out;
}

/** One row per human member of the room, in the room's order, then one per wallet from outside the app. */
export function gridRows(people: TreasuryRoomPerson[], plans: ContributionPlanView[]): GridRow[] {
  const row = (key: string, person: TreasuryRoomPerson | null, wallet: `0x${string}` | null, own: ContributionPlanView[]): GridRow => {
    const byMonth: Record<string, GridCell[]> = {};
    let collectedUsd = 0;
    for (const plan of own)
      for (const p of plan.periods) {
        (byMonth[monthKey(p.startsAt)] ??= []).push({
          planId: plan.id,
          index: p.index,
          startsAt: p.startsAt,
          state: p.state,
          amount: plan.amount,
          amountUsd: plan.amountUsd,
          wide: plan.periodSeconds > 2 * WEEK_S,
        });
        if (p.state === "collected") collectedUsd += plan.amountUsd;
      }
    for (const cells of Object.values(byMonth)) cells.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return { key, person, wallet, plans: own, byMonth, collectedUsd: round2(collectedUsd) };
  };
  const humans = people.filter((p) => !p.isAgent);
  const rows = humans.map((p) => row(p.id, p, null, plans.filter((plan) => plan.userId === p.id)));
  const known = new Set(humans.map((p) => p.id));
  const outside = new Map<string, ContributionPlanView[]>();
  for (const plan of plans) {
    if (plan.userId && known.has(plan.userId)) continue;
    const k = plan.member.toLowerCase();
    outside.set(k, [...(outside.get(k) ?? []), plan]);
  }
  for (const [k, own] of outside) rows.push(row(k, null, own[0].member, own));
  return rows;
}

/** Members with a plan that still runs, among the room's humans. */
export function contributingIds(people: TreasuryRoomPerson[], plans: ContributionPlanView[], now: number): Set<string> {
  const humans = new Set(people.filter((p) => !p.isAgent).map((p) => p.id));
  return new Set(plans.filter((p) => p.userId && humans.has(p.userId) && isRunning(p, now)).map((p) => p.userId as string));
}
