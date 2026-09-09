/**
 * Turn "the block list before and after one edit" into the operations that
 * describe the edit (docs/save-protocol-target.md §2, docs/text-crdt-design §3).
 * Pure, so it can be checked without a browser.
 *
 * A change to a block's TEXT becomes character operations (insertText /
 * deleteText / annotate) via computeTextOps, so two people editing the same
 * block converge; everything else — a new block, a type change, a move, a
 * delete, a non-text content change (a checkbox, an image, a table) — stays a
 * `set`/`update`. Because the text ops change the block's items/marks, the diff
 * also returns the block's new instance so the caller can store it and the next
 * diff starts from a fresh replica.
 */
import type { BlockContent } from "@/lib/db/schema";
import type { BlockRecord, Operation, TextPath } from "@/lib/transactions/types";
import { instanceFromContent, newInstanceId, textInstanceOf } from "@/lib/text-crdt/content";
import { escapeText, renderHtml, renderText } from "@/lib/text-crdt/html";
import { computeTextOps, nextSeqFor } from "@/lib/editor/text-edit";
import type { Mark, TextInstance, TextItem } from "@/lib/text-crdt/types";

export interface DiffableBlock extends BlockRecord {
  version?: number;
}

type UpdateArgs = Extract<Operation, { command: "update" }>["args"];
type WithCrdt = BlockContent & { textInstance?: string; items?: TextItem[]; marks?: Mark[] };

const MAIN_PATH: TextPath = ["content", "items"];
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A block whose text can be edited character by character: it has (or will
 * have) a text cache and is not one of the embed blocks. */
function isTextBlock(type: string): boolean {
  return !["image", "file", "divider", "database", "child_page", "column", "column_list", "table"].includes(type);
}

/** Content compared for a NON-text change: everything except the text cache and
 * its CRDT state (those are handled by the character ops). */
function nonTextContent(content: BlockContent): BlockContent {
  const { text: _t, html: _h, textInstance: _ti, items: _it, marks: _m, ...rest } = content as WithCrdt & { text?: unknown; html?: unknown };
  return rest as BlockContent;
}

/** Strip the heavy CRDT items from content bound for the wire; keep the
 * instance id (a fresh block names its instance so the server adopts it) and
 * the cache. Table cell items are rebuilt server-side. */
function forWire(content: BlockContent): BlockContent {
  const { items: _it, marks: _m, ...rest } = content as WithCrdt;
  const table = (rest as { table?: Record<string, unknown> }).table;
  if (table && "cellItems" in table) {
    const { cellItems: _ci, ...tableRest } = table;
    return { ...rest, table: tableRest } as unknown as BlockContent;
  }
  return rest as BlockContent;
}

export interface BlockDiff {
  ops: Operation[];
  /** blockId → the block's content after the text ops, to store locally so the
   * editor stays a valid replica (no version bump — the DOM is already right). */
  patches: Map<string, BlockContent>;
}

type TableCell = { instance: string; items: TextItem[]; marks?: Mark[] };
type Grid = {
  cells: string[][];
  html?: string[][];
  cellItems?: TableCell[][];
  headerRow?: boolean;
  headerCol?: boolean;
  color?: string[][];
  bg?: string[][];
  align?: string[][];
};

/** html a table cell renders (the pair table-block.tsx stores): the cell's own
 * html when it was formatted, else its escaped plain text. */
const cellHtmlOf = (t: Grid, r: number, c: number) => t.html?.[r]?.[c] ?? escapeText(t.cells[r][c] ?? "");
function cellInstance(t: Grid, r: number, c: number): TextInstance {
  const existing = t.cellItems?.[r]?.[c];
  if (existing && Array.isArray(existing.items)) return { instance: existing.instance, items: existing.items, marks: existing.marks };
  const built = instanceFromContent(undefined, cellHtmlOf(t, r, c));
  return { instance: built.instance, items: built.items, marks: built.marks };
}

/**
 * A table edit that only changed cell contents (not the grid shape or its
 * row/col styling) → character ops on the changed cells' instances. Returns
 * null when the change is structural (add/remove row/col, header/colour/align),
 * so the caller writes it wholesale.
 */
function diffTableCells(oldContent: BlockContent, newContent: BlockContent, blockId: string, clientId: string): { ops: Operation[]; content: BlockContent } | null {
  const o = (oldContent as { table?: Grid }).table;
  const n = (newContent as { table?: Grid }).table;
  if (!o || !n || !Array.isArray(o.cells) || !Array.isArray(n.cells)) return null;
  // only once the server has CRDT-tracked this table (a GET brought cellItems)
  // do cell edits become character ops; a brand-new local table writes
  // wholesale until its next sync, so its cell instance ids match the server's
  if (!Array.isArray(o.cellItems)) return null;
  if (o.cells.length !== n.cells.length) return null;
  for (let r = 0; r < o.cells.length; r++) if ((o.cells[r]?.length ?? 0) !== (n.cells[r]?.length ?? 0)) return null;
  // row/col styling or header flags changed → structural, write wholesale
  if (o.headerRow !== n.headerRow || o.headerCol !== n.headerCol) return null;
  if (!sameJson(o.color, n.color) || !sameJson(o.bg, n.bg) || !sameJson(o.align, n.align)) return null;

  const ops: Operation[] = [];
  const cellItems: TableCell[][] = n.cells.map((row, r) => row.map((_, c) => cellInstance(n, r, c)));
  const cellsOut = n.cells.map((row) => [...row]);
  const htmlOut = (n.html ?? n.cells.map((row) => row.map(() => ""))).map((row) => [...row]);
  let changed = false;
  for (let r = 0; r < n.cells.length; r++) {
    for (let c = 0; c < n.cells[r].length; c++) {
      if (cellHtmlOf(o, r, c) === cellHtmlOf(n, r, c) && (o.cells[r]?.[c] ?? "") === (n.cells[r]?.[c] ?? "")) {
        cellItems[r][c] = cellInstance(o, r, c); // unchanged — keep the old instance
        continue;
      }
      changed = true;
      const inst = cellInstance(o, r, c);
      const path: TextPath = ["content", "table", "cellItems", r, c];
      const { ops: cops, instance } = computeTextOps(inst, cellHtmlOf(n, r, c), blockId, path, clientId, nextSeqFor(inst.items, clientId));
      ops.push(...cops);
      cellItems[r][c] = { instance: instance.instance, items: instance.items, marks: instance.marks };
      cellsOut[r][c] = renderText(instance.items);
      htmlOut[r][c] = renderHtml(instance.items, instance.marks);
    }
  }
  if (!changed) return null;
  const table: Grid = { ...n, cells: cellsOut, html: htmlOut, cellItems };
  return { ops, content: { ...(newContent as object), table } as BlockContent };
}

export function diffBlocks(prev: DiffableBlock[], next: DiffableBlock[], clientId = "local"): BlockDiff {
  const ops: Operation[] = [];
  const patches = new Map<string, BlockContent>();
  const prevById = new Map(prev.map((b) => [b.id, b]));
  const nextIds = new Set<string>();
  for (const b of next) {
    nextIds.add(b.id);
    const old = prevById.get(b.id);
    // Fast path: an untouched block keeps its object reference (mutate rebuilds
    // only the block it changed), so skip it before any JSON.stringify. Without
    // this, one keystroke ran a deep content compare on all 227 blocks — the
    // bulk of the typing cost on a big page.
    if (old === b) continue;
    if (!old) {
      // a new block: name its instance so the server adopts the same id and
      // this tab's later text ops are not refused as a stale instance
      const content = { ...(b.content as WithCrdt) };
      if (isTextBlock(b.type) && typeof content.textInstance !== "string") {
        const inst = textInstanceOf(content) ?? { instance: newInstanceId(), items: [], marks: [] };
        content.textInstance = typeof content.textInstance === "string" ? content.textInstance : inst.instance;
        content.items = inst.items;
        content.marks = inst.marks;
        content.html = renderHtml(inst.items, inst.marks);
        content.text = renderText(inst.items);
        patches.set(b.id, content);
      }
      ops.push({ command: "set", pointer: { table: "block", id: b.id }, path: [], args: { id: b.id, type: b.type, content: forWire(content), parentBlockId: b.parentBlockId ?? null, position: b.position } });
      continue;
    }

    // structural fields
    const args: UpdateArgs = {};
    if (old.type !== b.type) args.type = b.type;
    if ((old.parentBlockId ?? null) !== (b.parentBlockId ?? null)) args.parentBlockId = b.parentBlockId ?? null;
    if (old.position !== b.position) args.position = b.position;

    // a table whose cells changed but whose shape did not → character ops per
    // changed cell, so two people editing different cells of one table merge
    // (a wholesale write would clobber). Structural table changes fall through.
    if (b.type === "table" && args.type === undefined) {
      const cell = diffTableCells(old.content, b.content, b.id, clientId);
      if (cell) {
        ops.push(...cell.ops);
        patches.set(b.id, cell.content);
        if (Object.keys(args).length) ops.push({ command: "update", pointer: { table: "block", id: b.id }, path: [], args });
        continue;
      }
    }

    // text change → character ops (only when structure is otherwise stable and
    // the block is a text block; a type change rebuilds the text wholesale)
    const textChanged = (old.content as WithCrdt).html !== (b.content as WithCrdt).html || (old.content as WithCrdt).text !== (b.content as WithCrdt).text;
    const nonTextChanged = !sameJson(nonTextContent(old.content), nonTextContent(b.content));
    const canCharEdit = textChanged && !nonTextChanged && args.type === undefined && isTextBlock(b.type);

    if (canCharEdit) {
      const inst = textInstanceOf(old.content);
      if (inst) {
        const { ops: tops, instance } = computeTextOps(inst, (b.content as WithCrdt).html ?? "", b.id, MAIN_PATH, clientId, nextSeqFor(inst.items, clientId));
        ops.push(...tops);
        const content: BlockContent = { ...(b.content as WithCrdt), textInstance: instance.instance, items: instance.items, marks: instance.marks, html: renderHtml(instance.items, instance.marks), text: renderText(instance.items) };
        patches.set(b.id, content);
        if (Object.keys(args).length) ops.push({ command: "update", pointer: { table: "block", id: b.id }, path: [], args });
        continue;
      }
    }

    // otherwise: a wholesale content write (non-text change, type change, or a
    // block with no instance yet)
    if (nonTextChanged || textChanged) args.content = forWire(b.content);
    if (Object.keys(args).length) ops.push({ command: "update", pointer: { table: "block", id: b.id }, path: [], args });
  }
  for (const b of prev) {
    if (!nextIds.has(b.id)) ops.push({ command: "update", pointer: { table: "block", id: b.id }, path: [], args: { alive: false } });
  }
  return { ops, patches };
}
