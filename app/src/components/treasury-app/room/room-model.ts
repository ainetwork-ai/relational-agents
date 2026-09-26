/**
 * Pure logic for the per-relation Treasury page: money and token formatting,
 * links, request titles, the bar each adopted rule sets, who in the room did
 * what, and dates on the relation's clock. The activity rows are
 * activity-model.ts. No React, no fetch — UI text is passed through `t`.
 */

import type { T } from "@/i18n/translate";
import { parseTreasuryPolicy } from "@/lib/agent/treasury/policy";
import { SKIP_REASON_TEXT, type RecurringSkipReason } from "@/lib/agent/treasury/recurring-record";
import { TREASURY_TIME_ZONE, type TreasuryStatus } from "@/lib/agent/treasury/types";
import type { TreasuryAction } from "./room-types";

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
export function memoOf(a: TreasuryAction): string {
  const memo = a.memo.trim() || a.kind;
  return memo.replace(/\bmy\b/gi, `${a.requestedBy.displayName}'s`);
}

/** A waiting request's headline: a rules change or a payment (a recurring buy is headed by its terms). */
export function requestTitle(t: T, a: TreasuryAction): string {
  if (a.kind === "ratify") return t("Adopt {what}", { what: a.memo });
  return `${usd(a.amountUsd)} · ${memoOf(a)}`;
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
