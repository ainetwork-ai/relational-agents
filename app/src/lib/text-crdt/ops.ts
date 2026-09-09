/**
 * Apply text operations to a block's content (docs/text-crdt-design.md §2,
 * §5.1, §5.3, §12). Pure: takes content, returns content — the database and
 * the file store both call this, and so will the editor for remote operations.
 *
 * insertText / deleteText / moveTextSlice work on the item list; annotate adds
 * a formatting mark (Notion's addAnnotation/removeAnnotation). Refusals are the
 * before/after validation: an unknown origin, an instance the operation was not
 * made against, a slice moved off the page. A refusal fails the whole
 * transaction; the client rebuilds the edit from the text it has.
 */
import type { BlockContent } from "@/lib/db/schema";
import type { TextOperation, TextPath } from "@/lib/transactions/types";
import { instanceFromContent } from "./content";
import { renderHtml, renderText } from "./html";
import { integrate, locate, mergeRuns, splitAt, tombstone } from "./rga";
import { anchorBefore, anchorGap, charPosOf, liveMarks } from "./marks";
import type { Anchor, ItemId, Mark, TextInstance, TextItem } from "./types";

export class TextOpError extends Error {}

type Textual = BlockContent & { textInstance?: string; items?: TextItem[]; marks?: Mark[] };
type CellInstance = { instance: string; items: TextItem[]; marks?: Mark[] };
type TableContent = BlockContent & {
  table?: BlockContent["table"] & { cellItems?: CellInstance[][]; html?: string[][] };
};

/** The instance at `path`, built from the cache when the block has none yet. */
export function readInstance(content: BlockContent, path: TextPath, adopt: string): TextInstance {
  if (path[1] === "items") {
    const c = content as Textual;
    if (Array.isArray(c.items) && typeof c.textInstance === "string") {
      if (c.textInstance !== adopt) throw new TextOpError(`instance mismatch: have ${c.textInstance}, op ${adopt}`);
      return { instance: c.textInstance, items: c.items.map(cloneItem), marks: (c.marks ?? []).map(cloneMark) };
    }
    const inst = instanceFromContent(c.text, c.html);
    return { instance: adopt, items: inst.items, marks: inst.marks };
  }
  const [, , , r, col] = path;
  const table = (content as TableContent).table;
  if (!table || !Array.isArray(table.cells) || !table.cells[r] || table.cells[r][col] === undefined) {
    throw new TextOpError(`no table cell at ${r},${col}`);
  }
  const existing = table.cellItems?.[r]?.[col];
  if (existing && Array.isArray(existing.items)) {
    if (existing.instance !== adopt) throw new TextOpError(`instance mismatch: have ${existing.instance}, op ${adopt}`);
    return { instance: existing.instance, items: existing.items.map(cloneItem), marks: (existing.marks ?? []).map(cloneMark) };
  }
  const inst = instanceFromContent(undefined, table.html?.[r]?.[col] ?? table.cells[r][col]);
  return { instance: adopt, items: inst.items, marks: inst.marks };
}

/** Store the instance at `path` and regenerate the cache the rest of the app reads. */
export function writeInstance(content: BlockContent, path: TextPath, inst: TextInstance): BlockContent {
  const items = mergeRuns(inst.items);
  const marks = liveMarks(items, inst.marks);
  const html = renderHtml(items, marks);
  const text = renderText(items);
  if (path[1] === "items") {
    return { ...(content as Textual), textInstance: inst.instance, items, marks, html, text };
  }
  const [, , , r, col] = path;
  const table = { ...(content as TableContent).table! };
  const cellItems = (table.cellItems ?? []).map((row) => [...row]);
  while (cellItems.length <= r) cellItems.push([]);
  cellItems[r][col] = { instance: inst.instance, items, marks };
  const cells = table.cells.map((row) => [...row]);
  cells[r][col] = text;
  const htmlGrid = (table.html ?? table.cells.map((row) => row.map(() => ""))).map((row) => [...row]);
  htmlGrid[r][col] = html;
  return { ...content, table: { ...table, cells, cellItems, html: htmlGrid } } as BlockContent;
}

const cloneItem = (it: TextItem): TextItem => ({ ...it });
const cloneMark = (m: Mark): Mark => ({ ...m });

/** insertText / deleteText / annotate on one block. */
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
    // annotate: add a formatting mark over each range (or an un-format when off)
    if (typeof op.args.key !== "string" || !op.args.key) throw new TextOpError("annotate: key required");
    inst.marks = inst.marks ?? [];
    for (const [from, count] of validRanges(op.args.ranges)) {
      const start = anchorForId(inst.items, from);
      const endPos = charPosOf(inst.items, from);
      if (endPos < 0) continue;
      const end = anchorBefore(inst.items, endPos + count);
      inst.marks.push({
        key: op.args.key,
        ...(op.args.value !== undefined ? { value: op.args.value } : {}),
        start,
        end,
        ts: Number.isFinite(op.args.ts) ? op.args.ts : Date.now(),
        by: typeof op.args.by === "string" ? op.args.by : "?",
        ...(op.args.off ? { off: true as const } : {}),
      });
    }
  }
  return writeInstance(content, op.path, inst);
}

/** moveTextSlice: everything from `from` to the end of the source instance
 * leaves it (tombstones included) and joins the target. Marks that lie entirely
 * within the moved slice travel with it; others stay. */
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
  // resolve every mark to code-unit gaps against the source BEFORE the move,
  // and the cut position, so the marks can be re-anchored on each side
  const srcMarksBefore = (src.marks ?? []).map((m) => ({ m, s: anchorGap(src.items, m.start), e: anchorGap(src.items, m.end) }));
  const cutPos = charPosOf(src.items, validId(a.from));
  const idx = splitAt(src.items, loc.index, loc.offset);
  const moved = src.items.splice(idx);
  if (moved.length === 0) {
    const out = writeInstance(source, op.path, src);
    return { source: out, target: sameBlock ? out : writeInstance(target!, a.toPath, dst) };
  }
  if (a.toOrigin !== "start" && !locate(dst.items, validId(a.toOrigin))) {
    throw new TextOpError(`moveTextSlice: unknown toOrigin ${JSON.stringify(a.toOrigin)}`);
  }
  moved[0] = { ...moved[0], origin: a.toOrigin };
  for (let i = 1; i < moved.length; i++) {
    const o = moved[i].origin;
    if (o === "start" || !locate(moved.slice(0, i), o)) {
      const prev = moved[i - 1];
      moved[i] = { ...moved[i], origin: [prev.id[0], prev.id[1] + prev.text.length - 1] };
    }
  }
  const dstOffset = a.toOrigin === "start" ? 0 : charPosOf(dst.items, validId(a.toOrigin)) + 1;
  for (const it of moved) if (!integrate(dst.items, it)) throw new TextOpError(`moveTextSlice: could not place ${JSON.stringify(it.id)}`);
  if (!sameBlock) {
    // Re-anchor marks around the cut (design §12): the part covering characters
    // that stayed clamps its end to the source end; the part covering moved
    // characters is rebuilt against the target at its new offset. A mark wholly
    // on one side just follows that side.
    const srcMarks: Mark[] = [];
    const dstAdd: Mark[] = [];
    for (const { m, s, e } of srcMarksBefore) {
      if (s < 0 || e < 0 || s >= e) continue;
      const sSrc = Math.min(s, cutPos), eSrc = Math.min(e, cutPos);
      if (sSrc < eSrc) srcMarks.push({ ...m, start: anchorBefore(src.items, sSrc), end: anchorBefore(src.items, eSrc) });
      const sTgt = Math.max(s, cutPos), eTgt = Math.max(e, cutPos);
      if (sTgt < eTgt) dstAdd.push({ ...m, start: anchorBefore(dst.items, sTgt - cutPos + dstOffset), end: anchorBefore(dst.items, eTgt - cutPos + dstOffset) });
    }
    src.marks = srcMarks;
    if (dstAdd.length) dst.marks = [...(dst.marks ?? []), ...dstAdd];
  }
  if (sameBlock) {
    const out = writeInstance(source, op.path, src);
    return { source: out, target: out };
  }
  return { source: writeInstance(source, op.path, src), target: writeInstance(target!, a.toPath, dst) };
}

/** Anchor "before `from`", the left edge of a formatted range. */
function anchorForId(items: TextItem[], from: ItemId): Anchor {
  const pos = charPosOf(items, from);
  return pos < 0 ? "start" : anchorBefore(items, pos);
}

function validId(id: unknown): ItemId {
  if (!Array.isArray(id) || id.length !== 2 || typeof id[0] !== "string" || !Number.isInteger(id[1])) throw new TextOpError(`bad item id ${JSON.stringify(id)}`);
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
  return { id, origin, text: it.text, ...(it.br ? { br: it.br } : {}), ...(it.deleted ? { deleted: true as const } : {}) };
}

function validRanges(ranges: unknown): [ItemId, number][] {
  if (!Array.isArray(ranges)) throw new TextOpError("ranges[] required");
  return ranges.map((r) => {
    if (!Array.isArray(r) || r.length !== 2 || !Number.isInteger(r[1]) || r[1] < 0) throw new TextOpError(`bad range ${JSON.stringify(r)}`);
    return [validId(r[0]), r[1]];
  });
}
