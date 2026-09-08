/**
 * RGA over runs (docs/text-crdt-design.md §1.1, §6).
 *
 * Items are runs of consecutive characters by one client; a run's first
 * character carries the external origin, every later character's origin is
 * the character before it. Integration splits a run when an insert lands in
 * its middle and re-merges afterwards, so the list stays small while every
 * character keeps a resolvable id.
 */
import { precedes, sameId, type ItemId, type TextItem } from "./types";
import { sameTags } from "./html";

/** Where a character id lives: the item index and the offset inside its run. */
export function locate(items: TextItem[], id: ItemId): { index: number; offset: number } | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.id[0] !== id[0]) continue;
    const off = id[1] - it.id[1];
    if (off >= 0 && off < it.text.length) return { index: i, offset: off };
  }
  return null;
}

/** Split item `index` so that `offset` characters stay in the left part. Returns
 * the index of the right part (or `index` when no split was needed). */
export function splitAt(items: TextItem[], index: number, offset: number): number {
  const it = items[index];
  if (offset <= 0 || offset >= it.text.length) return offset <= 0 ? index : index + 1;
  const left: TextItem = { ...it, text: it.text.slice(0, offset) };
  const right: TextItem = {
    ...it,
    id: [it.id[0], it.id[1] + offset],
    origin: [it.id[0], it.id[1] + offset - 1],
    text: it.text.slice(offset),
  };
  items.splice(index, 1, left, right);
  return index + 1;
}

/** The id of the last character of an item. */
export const lastId = (it: TextItem): ItemId => [it.id[0], it.id[1] + it.text.length - 1];

/** Character-index of an origin: the position right after that character; "start" is 0. */
function originIndex(items: TextItem[], origin: ItemId | "start"): number {
  if (origin === "start") return 0;
  const loc = locate(items, origin);
  if (!loc) return -1;
  let pos = 0;
  for (let i = 0; i < loc.index; i++) pos += items[i].text.length;
  return pos + loc.offset + 1;
}

/**
 * Insert one item (a run by one client). Returns false when its origin is not
 * in the instance — the caller refuses the operation (design §5.3).
 *
 * Standard RGA: place after the origin, but skip any sibling with the same
 * origin that takes precedence, and everything that hangs off such siblings
 * (their origins lie to the right of ours).
 */
export function integrate(items: TextItem[], item: TextItem): boolean {
  if (locate(items, item.id)) return true; // already here (idempotent)
  let pos: number; // item index to insert at
  if (item.origin === "start") pos = 0;
  else {
    const loc = locate(items, item.origin);
    if (!loc) return false;
    pos = splitAt(items, loc.index, loc.offset + 1);
  }
  const myOriginIdx = originIndex(items, item.origin);
  while (pos < items.length) {
    const o = items[pos];
    const oOriginIdx = originIndex(items, o.origin);
    if (oOriginIdx > myOriginIdx) {
      pos++; // hangs off something already to our right — stays left of us
      continue;
    }
    if (oOriginIdx === myOriginIdx) {
      if (precedes(o.id, item.id)) {
        pos++;
        continue;
      }
      break;
    }
    break; // its origin is left of ours: we come first
  }
  items.splice(pos, 0, { ...item, tags: [...item.tags] });
  mergeAround(items, pos);
  return true;
}

/** Tombstone `count` characters starting at `from` (splitting runs at the edges). */
export function tombstone(items: TextItem[], from: ItemId, count: number): void {
  let remaining = count;
  let cur: ItemId = from;
  while (remaining > 0) {
    const loc = locate(items, cur);
    if (!loc) return;
    let idx = splitAt(items, loc.index, loc.offset);
    const it = items[idx];
    const take = Math.min(remaining, it.text.length);
    if (take < it.text.length) splitAt(items, idx, take);
    items[idx] = { ...items[idx], deleted: true };
    remaining -= take;
    cur = [it.id[0], it.id[1] + take];
    idx++;
  }
}

/** Set/clear the tag stack of `count` characters starting at `from`. */
export function retag(items: TextItem[], from: ItemId, count: number, tags: string[]): void {
  let remaining = count;
  let cur: ItemId = from;
  while (remaining > 0) {
    const loc = locate(items, cur);
    if (!loc) return;
    const idx = splitAt(items, loc.index, loc.offset);
    const it = items[idx];
    const take = Math.min(remaining, it.text.length);
    if (take < it.text.length) splitAt(items, idx, take);
    if (!items[idx].br) items[idx] = { ...items[idx], tags: [...tags] };
    remaining -= take;
    cur = [it.id[0], it.id[1] + take];
  }
}

/** Two neighbours merge when the right one continues the left one's run:
 * same client, next seq, origin = left's last char, same tags and liveness, no br. */
function canMerge(a: TextItem, b: TextItem): boolean {
  return (
    !a.br &&
    !b.br &&
    a.id[0] === b.id[0] &&
    b.id[1] === a.id[1] + a.text.length &&
    b.origin !== "start" &&
    sameId(b.origin, lastId(a)) &&
    !!a.deleted === !!b.deleted &&
    sameTags(a.tags, b.tags)
  );
}

function mergeAround(items: TextItem[], index: number): void {
  if (index + 1 < items.length && canMerge(items[index], items[index + 1])) {
    items[index] = { ...items[index], text: items[index].text + items[index + 1].text };
    items.splice(index + 1, 1);
  }
  if (index > 0 && canMerge(items[index - 1], items[index])) {
    items[index - 1] = { ...items[index - 1], text: items[index - 1].text + items[index].text };
    items.splice(index, 1);
  }
}

/** Coalesce every mergeable neighbour pair (after tombstoning/retagging). */
export function mergeRuns(items: TextItem[]): TextItem[] {
  const out: TextItem[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && canMerge(last, it)) out[out.length - 1] = { ...last, text: last.text + it.text };
    else out.push({ ...it });
  }
  return out;
}
