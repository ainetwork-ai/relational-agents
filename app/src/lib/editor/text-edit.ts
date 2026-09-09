/**
 * Turn one block's edit — expressed as "the html the contenteditable now holds"
 * — into character operations against its text instance (docs/text-crdt-design
 * §3.2, §12). Every edit in the editor funnels through onInput reading
 * `el.innerHTML` (typing and formatting alike, since the toolbar uses
 * execCommand), so this one function covers both.
 *
 * It diffs the old instance's text against the new text (common prefix/suffix)
 * for insert/delete, then diffs per-character formatting for annotate ops, and
 * applies the ops to a copy so the caller gets the resulting instance too. Pure
 * and browserless, so scripts/text-edit.check.mts can exercise it directly.
 */
import { parseHtml } from "@/lib/text-crdt/html";
import { applyTextOp } from "@/lib/text-crdt/ops";
import { charPosOf, resolveFormats, formatsAt } from "@/lib/text-crdt/marks";
import { renderText } from "@/lib/text-crdt/html";
import type { ItemId, Mark, TextInstance, TextItem } from "@/lib/text-crdt/types";
import type { Operation, TextPath } from "@/lib/transactions/types";

type TextArgs = { instance: string };
function op(command: "insertText" | "deleteText" | "annotate", blockId: string, path: TextPath, args: object): Operation {
  return { command, pointer: { table: "block", id: blockId }, path, args } as Operation;
}

/** The live characters of an instance, each with the id of that character. */
function liveChars(items: TextItem[]): { id: ItemId }[] {
  const out: { id: ItemId }[] = [];
  for (const it of items) {
    if (it.deleted) continue;
    for (let k = 0; k < it.text.length; k++) out.push({ id: [it.id[0], it.id[1] + k] });
  }
  return out;
}

export interface ComputedEdit {
  ops: Operation[];
  instance: TextInstance;
}

/**
 * @param inst   the block's current instance (items + marks)
 * @param newHtml the sanitized html the block now holds
 * @param blockId the block id (for the operations' pointer)
 * @param path    where the instance lives (main text or a table cell)
 * @param clientId this tab's client id (new characters get [clientId, seq])
 * @param seqStart 1 + the highest seq this client has used anywhere in the instance
 */
export function computeTextOps(
  inst: TextInstance,
  newHtml: string,
  blockId: string,
  path: TextPath,
  clientId: string,
  seqStart: number
): ComputedEdit {
  const oldItems = inst.items;
  const oldText = renderText(oldItems);
  const target = parseHtml(newHtml, "t"); // "t" ids are throwaway — we only read its text + formats
  const newText = renderText(target.items);

  const ops: Operation[] = [];
  const base: TextArgs = { instance: inst.instance };
  const path0 = path;

  // ── text diff: common prefix/suffix over code units ──────────────────────
  let p = 0;
  const maxP = Math.min(oldText.length, newText.length);
  while (p < maxP && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < oldText.length - p && s < newText.length - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  const delCount = oldText.length - p - s; // live chars removed at [p, p+delCount)
  const insText = newText.slice(p, newText.length - s);

  const live = liveChars(oldItems);
  // delete first (ids come from the OLD instance)
  if (delCount > 0) {
    const ranges: [ItemId, number][] = [];
    for (let i = p; i < p + delCount; i++) {
      const id = live[i].id;
      const last = ranges[ranges.length - 1];
      if (last && last[0][0] === id[0] && last[0][1] + last[1] === id[1]) last[1] += 1;
      else ranges.push([id, 1]);
    }
    ops.push(op("deleteText", blockId, path0, { ...base, ranges }));
  }
  // insert (new ids, origin = the live char just left of p in the OLD instance)
  let seq = seqStart;
  if (insText.length > 0) {
    const origin: ItemId | "start" = p > 0 ? live[p - 1].id : "start";
    const item: TextItem = { id: [clientId, seq], origin, text: insText };
    ops.push(op("insertText", blockId, path0, { ...base, items: [item] }));
    seq += insText.length;
  }

  // apply text ops to a working copy so format diffing sees the new item layout
  let content: { textInstance: string; items: TextItem[]; marks?: Mark[] } = {
    textInstance: inst.instance,
    items: oldItems.map((it) => ({ ...it })),
    marks: (inst.marks ?? []).map((m) => ({ ...m })),
  };
  for (const o of ops) content = applyTextOp(content as never, o as never) as never;

  // ── format diff: per surviving/new character, target formats vs current ──
  const fmtOps = diffFormats(content, target, blockId, path0, inst.instance, clientId, seq);
  for (const o of fmtOps.ops) {
    ops.push(o);
    content = applyTextOp(content as never, o as never) as never;
  }

  return { ops, instance: { instance: inst.instance, items: content.items, marks: content.marks } };
}

/**
 * Compare the working instance's per-character format keys with the target's
 * (from the freshly parsed html) and emit annotate ops for each key over each
 * maximal range where they differ. Positions align because both describe the
 * same final text.
 */
function diffFormats(
  cur: { items: TextItem[]; marks?: Mark[] },
  target: { items: TextItem[]; marks?: Mark[] },
  blockId: string,
  path: TextPath,
  instance: string,
  clientId: string,
  ts: number
): { ops: Operation[] } {
  const ops: Operation[] = [];
  const curFmt = resolveFormats(curLive(cur.items), cur.marks); // over live positions
  const tgtFmt = resolveFormats(target.items, target.marks);
  const n = Math.min(curFmt.length, tgtFmt.length);
  // collect, per key, the set of live positions where target has it but cur
  // doesn't (add) and where cur has it but target doesn't (remove)
  const keysOf = (m: Map<string, { value?: string }>) => new Set(m.keys());
  const changes = new Map<string, { add: boolean; value?: string; from: number; len: number }[]>();
  const noteRange = (key: string, add: boolean, value: string | undefined, pos: number) => {
    let arr = changes.get(key);
    if (!arr) changes.set(key, (arr = []));
    const last = arr[arr.length - 1];
    if (last && last.add === add && last.value === value && last.from + last.len === pos) last.len += 1;
    else arr.push({ add, value, from: pos, len: 1 });
  };
  for (let i = 0; i < n; i++) {
    const c = new Map(formatsAt(curFmt[i]).map((f) => [f.key, { value: f.value }]));
    const t = new Map(formatsAt(tgtFmt[i]).map((f) => [f.key, { value: f.value }]));
    for (const key of new Set([...keysOf(c), ...keysOf(t)])) {
      const cv = c.get(key), tv = t.get(key);
      if (!tv && cv) noteRange(key, false, cv.value, i);
      else if (tv && (!cv || cv.value !== tv.value)) noteRange(key, true, tv.value, i);
    }
  }
  const liveItems = curLive(cur.items);
  for (const [key, ranges] of changes) {
    for (const r of ranges) {
      const id = idAtLive(liveItems, r.from);
      if (!id) continue;
      ops.push(op("annotate", blockId, path, {
        instance, ranges: [[id, r.len]] as [ItemId, number][], key,
        ...(r.value !== undefined ? { value: r.value } : {}),
        ...(r.add ? {} : { off: true }),
        ts, by: clientId,
      }));
    }
  }
  return { ops };
}

/** Items filtered to live characters, so positions line up with a target that
 * has no tombstones. (Tombstones keep their ids for anchors, but formatting is
 * only meaningful on live text.) */
function curLive(items: TextItem[]): TextItem[] {
  return items.filter((it) => !it.deleted);
}

/** The id of the live character at position `pos` over an already-live list. */
function idAtLive(liveItems: TextItem[], pos: number): ItemId | null {
  let acc = 0;
  for (const it of liveItems) {
    if (pos < acc + it.text.length) return [it.id[0], it.id[1] + (pos - acc)];
    acc += it.text.length;
  }
  return null;
}

/** 1 + the highest seq seen in the instance, from ANY client — the Lamport
 * clock, so a fresh insert always outranks its older neighbour and lands right
 * after its origin (design §1.1). Scanning only this client's ids would give a
 * seq below an existing neighbour and RGA would push the new text past it. */
export function nextSeqFor(items: TextItem[], _clientId: string): number {
  let max = 0;
  for (const it of items) max = Math.max(max, it.id[1] + it.text.length - 1);
  return max + 1;
}

void charPosOf;
