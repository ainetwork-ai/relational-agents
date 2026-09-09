/**
 * Where the CRDT lives inside a block's `content` (docs/text-crdt-design.md §1,
 * §7, §12), and the conversions the server needs:
 *
 * - a wholesale text write (`set`, `update {content:{text,html}}` from the
 *   editor until step ③, from PUT /blocks, MCP, a restore) becomes a NEW
 *   instance — the id changes and items+marks are rebuilt from the html.
 *   Measured on Notion: after an API-style replace the next insert carried a
 *   new textInstanceId; history is cut, not merged.
 * - a block that has no instance yet gets one lazily from its html/text.
 *
 * `content.text` and `content.html` stay the render cache everything else
 * reads; `content.textInstance` / `content.items` / `content.marks` are the
 * truth once present. Table blocks carry one instance per cell under
 * `content.table.cellItems`.
 */
import type { BlockContent } from "@/lib/db/schema";
import { parseHtml, itemsFromText, renderHtml, renderText } from "./html";
import { liveMarks } from "./marks";
import type { Mark, TextInstance, TextItem } from "./types";

const MIGRATION_CLIENT = "m";

export function newInstanceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 22) : String(Date.now());
}

/** Build the instance a wholesale text write describes. */
export function instanceFromContent(text: string | undefined, html: string | undefined, clientId = MIGRATION_CLIENT): TextInstance {
  const { items, marks } = html !== undefined && html !== null ? parseHtml(html, clientId) : itemsFromText(text ?? "", clientId);
  return { instance: newInstanceId(), items, marks };
}

type Textual = BlockContent & { textInstance?: string; items?: TextItem[]; marks?: Mark[] };
type CellInstance = { instance: string; items: TextItem[]; marks?: Mark[] };
type TableContent = BlockContent & {
  table?: { cells: string[][]; cellItems?: CellInstance[][]; html?: string[][]; headerRow?: boolean; headerCol?: boolean } & Record<string, unknown>;
};

/**
 * Attach CRDT state to content arriving from a wholesale write. When the
 * writer already speaks items (a step-③ client), they are kept and the cache
 * is regenerated from them; otherwise items+marks are rebuilt from html/text
 * as a new instance. Returns the content to store.
 */
export function withTextInstance(content: BlockContent): BlockContent {
  const c = { ...(content as Textual) };
  const table = (c as TableContent).table;
  if (table && Array.isArray(table.cells)) {
    const cellItems = table.cells.map((row, r) =>
      row.map((cell, col) => {
        const existing = table.cellItems?.[r]?.[col];
        if (existing && Array.isArray(existing.items)) return existing;
        const cellHtml = (table as { html?: string[][] }).html?.[r]?.[col];
        const inst = cellHtml !== undefined ? instanceFromContent(undefined, cellHtml) : instanceFromContent(cell, undefined);
        return { instance: inst.instance, items: inst.items, marks: inst.marks };
      })
    );
    (c as TableContent).table = { ...table, cellItems };
  }
  if (Array.isArray(c.items) && typeof c.textInstance === "string") {
    // a client that speaks items: the cache follows the items
    c.marks = liveMarks(c.items, c.marks);
    c.html = renderHtml(c.items, c.marks);
    c.text = renderText(c.items);
    return c;
  }
  if (c.text !== undefined || c.html !== undefined) {
    const built = instanceFromContent(c.text, c.html);
    // A client that named the instance (a freshly created block) but did not
    // send items: adopt its id so the client's later text ops match this
    // block instead of being refused as a stale instance. The items are the
    // same either way — both sides build them from the same html.
    c.textInstance = typeof c.textInstance === "string" ? c.textInstance : built.instance;
    c.items = built.items;
    c.marks = built.marks;
  }
  return c;
}

/** The instance of a block's main text, built lazily when absent. */
export function textInstanceOf(content: BlockContent): TextInstance | null {
  const c = content as Textual;
  if (Array.isArray(c.items) && typeof c.textInstance === "string") return { instance: c.textInstance, items: c.items, marks: c.marks };
  if (c.text === undefined && c.html === undefined) return null;
  return instanceFromContent(c.text, c.html);
}
