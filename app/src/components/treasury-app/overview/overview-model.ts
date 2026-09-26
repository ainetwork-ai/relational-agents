/**
 * Pure logic for the treasuries overview: the three headline numbers, the
 * filter they drive, each relation's colour, and the text pieces a row shows.
 * No React, no fetch — everything here is input → output.
 */

// type-only: the server module never enters the client bundle
import type { TreasurySummaryRoom } from "@/lib/agent/treasury/summary";

export type OverviewFilter = "all" | "needs-approval" | "recurring-running" | "bought-this-week";

export interface OverviewStats {
  /** Sum of requests waiting on the viewer's vote, across relations. */
  needsYourApproval: number;
  /** Relations whose recurring buy is adopted and running. */
  recurringRunning: number;
  /** Relations whose running recurring buy already bought in the current ISO week. */
  boughtThisWeek: number;
}

function isRunning(room: TreasurySummaryRoom): boolean {
  return room.recurring?.state === "live";
}

function boughtThisWeek(room: TreasurySummaryRoom): boolean {
  return isRunning(room) && room.recurring?.boughtThisWeek === true;
}

export function overviewStats(rooms: readonly TreasurySummaryRoom[]): OverviewStats {
  return {
    needsYourApproval: rooms.reduce((sum, room) => sum + Math.max(0, room.pendingForMe), 0),
    recurringRunning: rooms.filter(isRunning).length,
    boughtThisWeek: rooms.filter(boughtThisWeek).length,
  };
}

export function filterRooms(rooms: readonly TreasurySummaryRoom[], filter: OverviewFilter): TreasurySummaryRoom[] {
  switch (filter) {
    case "all":
      return [...rooms];
    case "needs-approval":
      return rooms.filter((room) => room.pendingForMe > 0);
    case "recurring-running":
      return rooms.filter(isRunning);
    case "bought-this-week":
      return rooms.filter(boughtThisWeek);
  }
}

/** Relations that need the viewer come first, then the most recently active. */
export function sortRooms(rooms: readonly TreasurySummaryRoom[]): TreasurySummaryRoom[] {
  const latestMs = (room: TreasurySummaryRoom) => (room.latest ? Date.parse(room.latest.at) || 0 : 0);
  return [...rooms].sort(
    (a, b) =>
      Number(b.pendingForMe > 0) - Number(a.pendingForMe > 0) ||
      latestMs(b) - latestMs(a) ||
      a.roomName.localeCompare(b.roomName)
  );
}

/** Narrows an unknown JSON body to the summary contract; null when it does not match. */
export function parseSummary(body: unknown): { rooms: TreasurySummaryRoom[] } | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { rooms?: unknown }).rooms)) return null;
  const rooms = (body as { rooms: unknown[] }).rooms.filter(
    (room): room is TreasurySummaryRoom =>
      !!room &&
      typeof room === "object" &&
      typeof (room as TreasurySummaryRoom).roomId === "string" &&
      typeof (room as TreasurySummaryRoom).roomName === "string"
  );
  return {
    rooms: rooms.map((room) => ({
      ...room,
      balanceUsd: typeof room.balanceUsd === "number" && Number.isFinite(room.balanceUsd) ? room.balanceUsd : null,
      pendingTotal: Number.isFinite(room.pendingTotal) ? room.pendingTotal : 0,
      pendingForMe: Number.isFinite(room.pendingForMe) ? room.pendingForMe : 0,
      recurring: room.recurring ?? null,
      latest: room.latest ?? null,
    })),
  };
}

// Every treasury has its own colour (Treasury design: Tokyo Trip is sunset coral).
// The palette starts at coral; the rest are the design's member hues.
const RELATION_COLORS = ["#FF6B4A", "#4C6EF5", "#D6336C", "#7048E8", "#0C8599", "#5C940D", "#E8590C", "#1098AD"] as const;

/** A stable colour per relation, derived from its id. */
export function relationColor(roomId: string): string {
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) hash = (hash * 31 + roomId.charCodeAt(i)) | 0;
  return RELATION_COLORS[Math.abs(hash) % RELATION_COLORS.length];
}

const USD_CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_WHOLE = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** "$1,000.00" — a pot always shows cents. */
export function formatBalance(usd: number): string {
  return USD_CENTS.format(usd);
}

/** "$20" or "$12.50" — a weekly amount drops ".00". */
export function formatWeekly(usd: number): string {
  return Number.isInteger(usd) ? USD_WHOLE.format(usd) : USD_CENTS.format(usd);
}

/** A translation key plus its variables, so the component stays the only place that calls t(). */
export interface Phrase {
  key: string;
  vars?: Record<string, string | number>;
}

export function recurringPhrase(recurring: TreasurySummaryRoom["recurring"]): Phrase | null {
  if (!recurring) return null;
  if (recurring.state === "pending") return { key: "Waiting for approval" };
  const amount = formatWeekly(recurring.weeklyUsd);
  if (typeof recurring.weekIndex === "number" && recurring.weekIndex > 0) {
    return {
      key: "{amount} weekly · week {week} of {weeks}",
      vars: { amount, week: Math.min(recurring.weekIndex, recurring.weeks), weeks: recurring.weeks },
    };
  }
  return { key: "{amount} weekly · {weeks} weeks", vars: { amount, weeks: recurring.weeks } };
}

export function agoPhrase(iso: string, now: number): Phrase | null {
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return { key: "Just now" };
  if (minutes < 60) return { key: "{n} min ago", vars: { n: minutes } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "{n} h ago", vars: { n: hours } };
  const days = Math.floor(hours / 24);
  if (days < 30) return { key: days === 1 ? "Yesterday" : "{n} days ago", vars: { n: days } };
  return { key: "{n} months ago", vars: { n: Math.floor(days / 30) } };
}
