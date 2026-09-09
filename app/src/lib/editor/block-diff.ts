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
import { newInstanceId, textInstanceOf } from "@/lib/text-crdt/content";
import { renderHtml, renderText } from "@/lib/text-crdt/html";
import { computeTextOps, nextSeqFor } from "@/lib/editor/text-edit";
import type { Mark, TextItem } from "@/lib/text-crdt/types";

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

export function diffBlocks(prev: DiffableBlock[], next: DiffableBlock[], clientId = "local"): BlockDiff {
  const ops: Operation[] = [];
  const patches = new Map<string, BlockContent>();
  const prevById = new Map(prev.map((b) => [b.id, b]));
  const nextIds = new Set<string>();
  for (const b of next) {
    nextIds.add(b.id);
    const old = prevById.get(b.id);
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
