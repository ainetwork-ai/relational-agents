/**
 * Pure logic for the per-relation Treasury page: money formatting, what each
 * treasury action and recurring run says in the activity feed, day grouping,
 * the bar each adopted rule sets, and who in the room did what. No React, no
 * fetch — status in, display pieces out. UI text is passed through `t`.
 */

import type { T } from "@/i18n/translate";
import { parseTreasuryPolicy } from "@/lib/agent/treasury/policy";
import { SKIP_REASON_TEXT, type RecurringSkipReason } from "@/lib/agent/treasury/recurring-record";
import { TREASURY_TIME_ZONE, type TreasuryStatus } from "@/lib/agent/treasury/types";
import type { RecurringRun, TreasuryAction } from "./room-types";

// The pot is a Sepolia account; recurring buys and investments settle on Base from the same address.
export const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";
export const BASE_EXPLORER = "https://basescan.org";

export function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Whole-token decimal strings ("0.0000254") to at most 6 significant digits, never in exponent form. */
export function tokenAmount(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return "0";
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(n);
}

export function shortAddress(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
}

/** The existing World ID step-up for one action, returning to `returnTo` with ?treasury=<outcome>. */
export function approvalUrl(actionId: string, returnTo: string): string {
  return `/api/auth/world/connect?action=${encodeURIComponent(actionId)}&returnTo=${encodeURIComponent(returnTo)}`;
}

export function treasuryPath(roomId: string, tab?: "activity" | "treasurer" | "rules"): string {
  return `/treasury/${encodeURIComponent(roomId)}${tab ? `/${tab}` : ""}`;
}

/** "expires in 5 h" / "expires in 20 min" / "expiring" */
export function expiresIn(t: T, iso: string | null, now: number): string | null {
  if (!iso) return null;
  const h = (new Date(iso).getTime() - now) / 3_600_000;
  if (h <= 0) return t("expiring");
  return h < 1
    ? t("expires in {n} min", { n: Math.max(1, Math.round(h * 60)) })
    : t("expires in {n} h", { n: Math.round(h) });
}

/** The wording chat and the panel use too (recurring-record.ts), translated when a locale has it. */
export function skipReasonText(t: T, reason: RecurringSkipReason | undefined): string {
  return reason ? t(SKIP_REASON_TEXT[reason]) : t("no reason recorded");
}

/** Memos are quoted as said ("send $700 to my wallet"); the page is read by everyone. */
function memoOf(a: TreasuryAction): string {
  const memo = a.memo.trim() || a.kind;
  return memo.replace(/\bmy\b/gi, `${a.requestedBy.displayName}'s`);
}

/** A waiting request's headline, whatever its kind. */
export function requestTitle(t: T, a: TreasuryAction): string {
  if (a.kind === "ratify") return t("Adopt {what}", { what: a.memo });
  if (a.kind === "recurring-buy") return t("Recurring buy · {memo}", { memo: memoOf(a) });
  return `${usd(a.amountUsd)} · ${memoOf(a)}`;
}

// ── activity ────────────────────────────────────────────────────────────────

export type ActivityTone = "ok" | "wait" | "bad" | "info";

export interface ActivityItem {
  id: string;
  at: string;
  tone: ActivityTone;
  /** what kind of line it is, for the icon */
  icon: "rules" | "recurring" | "buy" | "skip" | "pay" | "invest" | "withdraw";
  title: string;
  detail: string | null;
  /** the money figure on the right, if any */
  amount: string | null;
  href: string | null;
}

function actionItem(t: T, a: TreasuryAction): ActivityItem {
  const approvedBy = a.approvals.map((p) => p.displayName).join(", ");
  const base = { id: a.id, at: a.createdAt, href: null as string | null, amount: null as string | null };

  if (a.kind === "ratify") {
    if (a.status === "executed")
      return { ...base, tone: "info", icon: "rules", title: t("Rules adopted"), detail: approvedBy ? t("approved by {names}", { names: approvedBy }) : a.memo };
    if (a.status === "pending")
      return { ...base, tone: "wait", icon: "rules", title: t("Rules change waiting for approval"), detail: a.memo };
    return { ...base, tone: "bad", icon: "rules", title: t("Rules change not adopted"), detail: a.error ?? a.memo };
  }

  if (a.kind === "recurring-buy") {
    const detail = memoOf(a);
    const amount = t("up to {amount}", { amount: usd(a.amountUsd) });
    if (a.status === "executed")
      return { ...base, amount, tone: "ok", icon: "recurring", title: t("Recurring buy adopted"), detail: approvedBy ? `${detail} · ${t("approved by {names}", { names: approvedBy })}` : detail };
    if (a.status === "pending")
      return { ...base, amount, tone: "wait", icon: "recurring", title: t("Recurring buy waiting for approval"), detail };
    if (a.status === "cancelled")
      return { ...base, amount, tone: "bad", icon: "recurring", title: t("Recurring buy withdrawn or expired"), detail };
    return { ...base, amount, tone: "bad", icon: "recurring", title: t("Recurring buy not adopted"), detail: a.error ?? detail };
  }

  const icon = a.kind === "investment" ? "invest" : a.kind === "withdrawal" ? "withdraw" : "pay";
  const to = a.recipient?.label ?? (a.recipient?.address ? shortAddress(a.recipient.address) : null);
  const detail = to ? `${memoOf(a)} · ${t("to {who}", { who: to })}` : memoOf(a);
  const href = a.txHash ? a.txUrl ?? `${SEPOLIA_EXPLORER}/tx/${a.txHash}` : null;
  const amount = usd(a.amountUsd);
  switch (a.status) {
    case "executed":
      return {
        ...base,
        href,
        amount,
        tone: "ok",
        icon,
        title: a.kind === "investment" ? t("Invested") : a.kind === "withdrawal" ? t("Sent to a member") : t("Paid"),
        detail,
      };
    case "pending":
      return { ...base, amount, tone: "wait", icon, title: t("Waiting for approval"), detail };
    case "unconfirmed":
      return { ...base, href, amount, tone: "wait", icon, title: t("Sent, not confirmed yet"), detail };
    case "cancelled":
      return { ...base, amount, tone: "bad", icon, title: t("Expired unapproved"), detail };
    default:
      return { ...base, amount, tone: "bad", icon, title: a.status === "blocked" ? t("Blocked by our rules") : t("Not paid"), detail: a.error ?? detail };
  }
}

function runItem(t: T, run: RecurringRun, i: number): ActivityItem {
  const base = { id: `run-${run.at}-${i}`, at: run.at, href: run.txUrl ?? null };
  if (run.outcome === "bought")
    return {
      ...base,
      tone: "ok",
      icon: "buy",
      title: t("Weekly ETH buy · {week}", { week: run.isoWeek }),
      detail: t("{usdc} USDC → {weth} WETH on Base", { usdc: tokenAmount(run.usdcIn ?? "0"), weth: tokenAmount(run.wethOut ?? "0") }),
      amount: null,
    };
  return {
    ...base,
    tone: run.txUrl ? "bad" : "info",
    icon: "skip",
    title: t("Skipped {week}", { week: run.isoWeek }),
    detail: skipReasonText(t, run.reason),
    amount: null,
  };
}

/** Every treasury action the status carries plus every recurring run, newest first. */
export function buildActivity(t: T, status: TreasuryStatus): ActivityItem[] {
  const items = [
    ...status.actions.map((a) => actionItem(t, a)),
    ...(status.recurring?.history ?? []).map((r, i) => runItem(t, r, i)),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export interface ActivityDay {
  key: string;
  label: string;
  items: ActivityItem[];
}

/** Groups newest-first items by the relation's calendar day (as Treasury Activity does): "Today", "Yesterday", then "Mon, Sep 21". */
export function groupByDay(t: T, items: ActivityItem[], intlLocale: string, now: Date): ActivityDay[] {
  const dayKey = (d: Date) => DAY_KEY.format(d); // "2026-09-21"
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short", month: "short", day: "numeric", timeZone: TREASURY_TIME_ZONE });
  const days: ActivityDay[] = [];
  for (const item of items) {
    const d = new Date(item.at);
    const key = dayKey(d);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: key === today ? t("Today") : key === yesterday ? t("Yesterday") : fmt.format(d), items: [] };
      days.push(day);
    }
    day.items.push(item);
  }
  return days;
}

// ── rules ───────────────────────────────────────────────────────────────────

export interface RuleBar {
  text: string;
  tone: "ok" | "wait" | "bad" | "info";
  /** "Agent alone" / "2 verified humans" / "Not allowed"; null when the line did not parse */
  bar: string | null;
}

/** The adopted rule lines with the bar each one sets, read by the same grammar the agent enforces. */
export function ruleBars(t: T, rules: string[]): RuleBar[] {
  const policy = parseTreasuryPolicy(rules.map((r) => `- ${r}`).join("\n"));
  const byText = new Map(policy.rules.map((r) => [r.text, r]));
  return rules.map((text) => {
    const rule = byText.get(text);
    if (!rule) return { text, tone: "info", bar: null };
    if (rule.forbidden) return { text, tone: "bad", bar: t("Not allowed") };
    if (rule.approvals === 0) return { text, tone: "ok", bar: t("Agent alone") };
    return {
      text,
      tone: "wait",
      bar: rule.approvals === 1 ? t("1 verified human") : t("{n} verified humans", { n: rule.approvals }),
    };
  });
}

/** The adoption in force: the newest executed ratification among the actions the status carries. */
export function adoptionInForce(status: TreasuryStatus): TreasuryAction | null {
  return status.actions.filter((a) => a.kind === "ratify" && a.status === "executed").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

// ── members ─────────────────────────────────────────────────────────────────

export interface MemberContribution {
  userId: string;
  displayName: string;
  /** holds a World ID seat in this room */
  seated: boolean;
  /** in the electorate the rules in force were adopted with */
  voting: boolean;
  approvals: number;
  requests: number;
}

/** Approvals given and requests made, per member, across the actions the status carries (its most recent 20). */
export function memberContributions(status: TreasuryStatus): MemberContribution[] {
  return status.members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    seated: m.seated,
    voting: m.voting,
    approvals: status.actions.filter((a) => a.approvals.some((p) => p.userId === m.userId)).length,
    requests: status.actions.filter((a) => a.requestedBy.userId === m.userId).length,
  }));
}

// Dates and times below are on the relation's clock, in the viewer's locale — the room panel and Treasury Activity read the same clock.
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: TREASURY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** "Mon, Oct 5, 09:00" */
export function dateTime(iso: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TREASURY_TIME_ZONE }).format(new Date(iso));
}

/** "Mon, Oct 5" — a day, for when a week opens: nothing runs at its midnight */
export function weekdayDate(iso: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, { weekday: "short", month: "short", day: "numeric", timeZone: TREASURY_TIME_ZONE }).format(new Date(iso));
}

export function dateOnly(iso: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, { month: "short", day: "numeric", year: "numeric", timeZone: TREASURY_TIME_ZONE }).format(new Date(iso));
}

export function timeOnly(iso: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit", timeZone: TREASURY_TIME_ZONE }).format(new Date(iso));
}
