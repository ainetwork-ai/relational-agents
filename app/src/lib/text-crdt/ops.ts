/**
 * Apply text operations to a block's content (docs/text-crdt-design.md §2,
 * §5.1, §5.3). Pure: takes content, returns content — the database and the
 * file store both call this, and so will the editor for remote operations.
 *
 * Refusals are the before/after validation: an unknown origin, an instance
 * the operation was not made against, a slice moved off the page. A refusal
 * fails the whole transaction (the caller rolls it back and names the id in
 * `rejectedIds`); the client then rebuilds the edit from the text it has.
 * Unknown ids in a delete/format are skipped — a tombstone that was collected.
 */
import type { BlockContent } from "@/lib/db/schema";
import type { TextOperation, TextPath } from "@/lib/transactions/types";
import { instanceFromContent } from "./content";
import { renderHtml, renderText } from "./html";
import { integrate, locate, mergeRuns, retag, splitAt, tombstone } from "./rga";
import type { ItemId, TextInstance, TextItem } from "./types";

export class TextOpError extends Error {}

type Textual = BlockContent & { textInstance?: string; items?: TextItem[] };
type TableContent = BlockContent & {
  table?: BlockContent["table"] & { cellItems?: { instance: string; items: TextItem[] }[][]; html?: string[][] };
};

/** The instance at `path`, built from the cache when the block has none yet.
 * `adopt` is the id the operation brings; a block without an instance takes it
 * (both sides derive the same items from the same html), one with a different
 * id refuses. */
export function readInstance(content: BlockContent, path: TextPath, adopt: string): TextInstance {
  if (path[1] === "items") {
    const c = content as Textual;
    if (Array.isArray(c.items) && typeof c.textInstance === "string") {
      if (c.textInstance !== adopt) throw new TextOpError(`instance mismatch: have ${c.textInstance}, op ${adopt}`);
      return { instance: c.textInstance, items: c.items.map(cloneItem) };
    }
    return { instance: adopt, items: instanceFromContent(c.text, c.html).items };
  }
  const [, , , r, col] = path;
  const table = (content as TableContent).table;
  if (!table || !Array.isArray(table.cells) || !table.cells[r] || table.cells[r][col] === undefined) {
    throw new TextOpError(`no table cell at ${r},${col}`);
  }
  const existing = table.cellItems?.[r]?.[col];
  if (existing && Array.isArray(existing.items)) {
    if (existing.instance !== adopt) throw new TextOpError(`instance mismatch: have ${existing.instance}, op ${adopt}`);
    return { instance: existing.instance, items: existing.items.map(cloneItem) };
  }
  return { instance: adopt, items: instanceFromContent(undefined, table.html?.[r]?.[col] ?? table.cells[r][col]).items };
}

/** Store the instance at `path` and regenerate the cache the rest of the app reads. */
export function writeInstance(content: BlockContent, path: TextPath, inst: TextInstance): BlockContent {
  const items = mergeRuns(inst.items);
  if (path[1] === "items") {
    const c: Textual = { ...(content as Textual), textInstance: inst.instance, items };
    c.html = renderHtml(items);
    c.text = renderText(items);
    return c;
  }
  const [, , , r, col] = path;
  const table = { ...(content as TableContent).table! };
  const cellItems = (table.cellItems ?? []).map((row) => [...row]);
  while (cellItems.length <= r) cellItems.push([]);
  cellItems[r][col] = { instance: inst.instance, items };
  const cells = table.cells.map((row) => [...row]);
  cells[r][col] = renderText(items);
  const html = (table.html ?? table.cells.map((row) => row.map(() => ""))).map((row) => [...row]);
  html[r][col] = renderHtml(items);
  return { ...content, table: { ...table, cells, cellItems, html } } as BlockContent;
}

const cloneItem = (it: TextItem): TextItem => ({ ...it, tags: [...it.tags] });

/** insertText / deleteText / formatText on one block. */
export function applyTextOp(content: BlockContent, op: Exclude<TextOperation, { command: "moveTextSlice" }>): BlockContent {
  const inst = readInstance(content, op.path, op.args.instance);
  if (op.command === "insertText") {
    if (!Array.isArray(op.args.items)) throw new TextOpError("insertText: items[] required");
    for (const raw of op.args.items) {
      const item = validItem(raw);
      if (!integrate(inst.items, item)) throw new TextOpError(`insertText: unknown origin ${JSON.stringify(item.origin)}`);
    }
  } else if (op.command === "deleteText") {
    for (const [from, count] of validRanges(op.args.ranges)) tombstone(inst.items, from, count);
  } else {
    if (!Array.isArray(op.args.tags) || op.args.tags.some((t) => typeof t !== "string")) throw new TextOpError("formatText: tags[] required");
    for (const [from, count] of validRanges(op.args.ranges)) retag(inst.items, from, count, op.args.tags);
  }
  return writeInstance(content, op.path, inst);
}

/**
 * moveTextSlice: everything from `from` to the end of the source instance
 * leaves it (tombstones included — they may be origins) and joins the target,
 * the first moved item re-hung on `toOrigin`. Ids are kept, so a concurrent
 * edit that names a moved character still resolves — in the target.
 */
export function applyMoveTextSlice(
  source: BlockContent,
  target: BlockContent | null,
  op: Extract<TextOperation, { command: "moveTextSlice" }>
): { source: BlockContent; target: BlockContent } {
  const a = op.args;
  const src = readInstance(source, op.path, a.instance);
  const sameBlock = target === null;
  const dst = sameBlock ? src : readInstance(target, a.toPath, a.toInstance);
  const loc = locate(src.items, validId(a.from));
  if (!loc) throw new TextOpError(`moveTextSlice: unknown from ${JSON.stringify(a.from)}`);
  const idx = splitAt(src.items, loc.index, loc.offset);
  const moved = src.items.splice(idx);
  if (moved.length === 0) return { source: writeInstance(source, op.path, src), target: sameBlock ? writeInstance(source, op.path, src) : writeInstance(target!, a.toPath, dst) };
  if (a.toOrigin !== "start" && !locate(dst.items, validId(a.toOrigin))) {
    throw new TextOpError(`moveTextSlice: unknown toOrigin ${JSON.stringify(a.toOrigin)}`);
  }
  // The first moved item hangs on `toOrigin`. Later ones keep their origin when
  // it moved along with them; one whose origin stayed behind (a concurrent
  // insert that hung on a character left of the cut) is re-hung on the item
  // before it, so the slice keeps its order — decided from the slice alone,
  // hence identical on every replica.
  moved[0] = { ...moved[0], origin: a.toOrigin };
  for (let i = 1; i < moved.length; i++) {
    const o = moved[i].origin;
    if (o === "start" || !locate(moved.slice(0, i), o)) {
      const prev = moved[i - 1];
      moved[i] = { ...moved[i], origin: [prev.id[0], prev.id[1] + prev.text.length - 1] };
    }
  }
  for (const it of moved) {
    if (!integrate(dst.items, it)) throw new TextOpError(`moveTextSlice: could not place ${JSON.stringify(it.id)}`);
  }
  if (sameBlock) {
    const out = writeInstance(source, op.path, src);
    return { source: out, target: out };
  }
  return { source: writeInstance(source, op.path, src), target: writeInstance(target!, a.toPath, dst) };
}

function validId(id: unknown): ItemId {
  if (!Array.isArray(id) || id.length !== 2 || typeof id[0] !== "string" || !Number.isInteger(id[1])) {
    throw new TextOpError(`bad item id ${JSON.stringify(id)}`);
  }
  return [id[0], id[1]];
}

function validItem(raw: unknown): TextItem {
  const it = raw as Partial<TextItem>;
  if (!it || typeof it !== "object") throw new TextOpError("bad item");
  const id = validId(it.id);
  const origin = it.origin === "start" ? "start" : validId(it.origin);
  if (typeof it.text !== "string" || it.text.length === 0) throw new TextOpError("item text must be a non-empty string");
  if (it.br !== undefined && !/^<br\s*\/?>$/i.test(String(it.br))) throw new TextOpError("bad br");
  if (it.br && it.text !== "\n") throw new TextOpError("a br item is one \\n");
  const tags = Array.isArray(it.tags) ? it.tags.filter((t): t is string => typeof t === "string" && /^<[a-zA-Z][^>]*>$/.test(t)) : [];
  return { id, origin, text: it.text, tags, ...(it.br ? { br: it.br } : {}), ...(it.deleted ? { deleted: true as const } : {}) };
}

function validRanges(ranges: unknown): [ItemId, number][] {
  if (!Array.isArray(ranges)) throw new TextOpError("ranges[] required");
  return ranges.map((r) => {
    if (!Array.isArray(r) || r.length !== 2 || !Number.isInteger(r[1]) || r[1] < 0) throw new TextOpError(`bad range ${JSON.stringify(r)}`);
    return [validId(r[0]), r[1]];
  });
}
