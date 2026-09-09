/**
 * The formatting layer (docs/text-crdt-design.md §12). Marks are resolved
 * against the current item order into a per-character format set, and that set
 * drives rendering. Add and remove are both marks that compete by timestamp,
 * so applying them in any order on any replica gives the same result.
 */
import { locate } from "./rga";
import { markOrder, type Anchor, type ItemId, type Mark, type TextItem } from "./types";

/** Character positions, counted in UTF-16 code units across ALL items
 * (tombstones included, because anchors may point at them). Gap g sits left of
 * character g; there are (total + 1) gaps. */
function charTotal(items: TextItem[]): number {
  let n = 0;
  for (const it of items) n += it.text.length;
  return n;
}

/** The gap index an anchor resolves to (0 .. total). A dangling anchor (its
 * character was purged) resolves to -1 and the mark is treated as empty. */
export function anchorGap(items: TextItem[], a: Anchor): number {
  if (a === "start") return 0;
  if (a === "end") return charTotal(items);
  const loc = locate(items, a.id);
  if (!loc) return -1;
  let pos = 0;
  for (let i = 0; i < loc.index; i++) pos += items[i].text.length;
  pos += loc.offset;
  return a.side === "before" ? pos : pos + 1;
}

export interface ActiveMark {
  value?: string;
  ts: number;
  by: string;
  off?: true;
}

/**
 * For each character position 0..total-1, the winning mark per key (highest
 * ts, then clientId). Returns, per position, a map key → ActiveMark; an entry
 * that is `off` means explicitly unformatted (it beat an add). One O(marks ×
 * chars) pass — a block's marks and length are both small.
 */
export function resolveFormats(items: TextItem[], marks: Mark[] | undefined): Map<string, ActiveMark>[] {
  const total = charTotal(items);
  const out: Map<string, ActiveMark>[] = Array.from({ length: total }, () => new Map());
  if (!marks) return out;
  for (const m of marks) {
    const s = anchorGap(items, m.start);
    const e = anchorGap(items, m.end);
    if (s < 0 || e < 0 || s >= e) continue;
    for (let i = s; i < e && i < total; i++) {
      const cur = out[i].get(m.key);
      if (!cur || m.ts > cur.ts || (m.ts === cur.ts && m.by > cur.by)) {
        out[i].set(m.key, { value: m.value, ts: m.ts, by: m.by, ...(m.off ? { off: true as const } : {}) });
      }
    }
  }
  return out;
}

/** The active (non-off) format keys for a character, in canonical nesting order. */
export function formatsAt(active: Map<string, ActiveMark>): { key: string; value?: string }[] {
  const list: { key: string; value?: string }[] = [];
  for (const [key, m] of active) if (!m.off) list.push({ key, value: m.value });
  list.sort((a, b) => markOrder(a.key) - markOrder(b.key) || (a.key < b.key ? -1 : 1));
  return list;
}

/** The anchor just before the character at code-unit position `pos`. `pos===0`
 * → "start"; `pos===total` → "end". Used to build a mark's boundaries from a
 * selected [from, count] range. */
export function anchorBefore(items: TextItem[], pos: number): Anchor {
  if (pos <= 0) return "start";
  const id = idAtCharPos(items, pos);
  return id ? { id, side: "before" } : "end";
}

/** The id of the character at code-unit position `pos` (0-based over all items). */
export function idAtCharPos(items: TextItem[], pos: number): ItemId | null {
  let acc = 0;
  for (const it of items) {
    if (pos < acc + it.text.length) return [it.id[0], it.id[1] + (pos - acc)];
    acc += it.text.length;
  }
  return null;
}

/** Code-unit position of an item id (its first covered position), or -1. */
export function charPosOf(items: TextItem[], id: ItemId): number {
  const loc = locate(items, id);
  if (!loc) return -1;
  let pos = 0;
  for (let i = 0; i < loc.index; i++) pos += items[i].text.length;
  return pos + loc.offset;
}

/** Drop marks whose anchors both dangle (their characters were purged) — a GC
 * companion to tombstone collection. */
export function liveMarks(items: TextItem[], marks: Mark[] | undefined): Mark[] | undefined {
  if (!marks || marks.length === 0) return marks;
  const kept = marks.filter((m) => anchorGap(items, m.start) >= 0 && anchorGap(items, m.end) >= 0);
  return kept.length === marks.length ? marks : kept;
}
