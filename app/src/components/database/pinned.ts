"use client";

import type { DbProperty } from "@/lib/db/schema";

/** How many properties sit above the body rather than in the 속성 panel until
 *  someone chooses (레이아웃 사용자 지정). The original pins four
 *  (TL · Assignee · End date · Evaluation). */
export const PINNED_COUNT = 4;

/** Does this cell hold anything? Empty string, empty list and a date object
 *  with no start all count as blank — the same states the table draws as an
 *  empty cell. */
export function hasValue(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object")
    return Object.values(v as Record<string, unknown>).some(
      (x) => x !== null && x !== undefined && x !== ""
    );
  return true;
}

/** Pinned vs the rest. Which properties are pinned is a choice kept on each
 *  property (`config.pinned`); until somebody makes it, the first few stand in.
 *
 *  The band's order is its own (`config.pinnedOrder`), not the property list's:
 *  measured on the original, its band reads TL · Assignee · End date ·
 *  Evaluation while neither the table's columns nor the 속성 panel start there
 *  (e2e/fixtures/notion-row-props-band.json §set). Properties with no order
 *  yet fall back to their position, after the ordered ones. */
export function splitPinned(properties: DbProperty[]): {
  pinned: DbProperty[];
  rest: DbProperty[];
  chosen: boolean;
} {
  const nonTitle = properties.filter((p) => p.type !== "title");
  const chosen = nonTitle.some((p) => p.config?.pinned !== undefined);
  const isPinned = (p: DbProperty, i: number) =>
    chosen ? !!p.config?.pinned : i < PINNED_COUNT;
  const order = (p: DbProperty) =>
    typeof p.config?.pinnedOrder === "number" ? p.config.pinnedOrder : Number.MAX_SAFE_INTEGER;
  const pinned = nonTitle
    .filter(isPinned)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => order(a.p) - order(b.p) || a.i - b.i)
    .map(({ p }) => p);
  return {
    pinned,
    rest: nonTitle.filter((p, i) => !isPinned(p, i)),
    chosen,
  };
}
