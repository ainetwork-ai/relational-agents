/**
 * Where the CRDT lives inside a block's `content` (docs/text-crdt-design.md §1,
 * §7), and the two conversions the server needs from stage 3 step ①:
 *
 * - a wholesale text write (`set`, `update {content:{text,html}}` from the
 *   editor until step ③, from PUT /blocks, MCP, a restore) becomes a NEW
 *   instance — the id changes and the items are rebuilt from the html.
 *   Measured on Notion: after an API-style replace the next insert carried a
 *   new textInstanceId and `prevItems:[start]`; history is cut, not merged.
 * - a block that has no instance yet gets one lazily from its html/text
 *   (`["m", 1..n]` items, chained from "start").
 *
 * `content.text` and `content.html` stay the render cache everything else
 * reads; `content.textInstance` / `content.items` are the truth once present.
 * Table blocks carry one instance per cell under `content.table.cellItems`.
 */
import type { BlockContent } from "@/lib/db/schema";
import { itemsFromHtml, itemsFromText, renderHtml, renderText } from "./html";
import type { TextInstance, TextItem } from "./types";

const MIGRATION_CLIENT = "m";

export function newInstanceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 22) : String(Date.now());
}

/** Build the instance a wholesale text write describes. */
export function instanceFromContent(text: string | undefined, html: string | undefined, clientId = MIGRATION_CLIENT): TextInstance {
  const items = html !== undefined && html !== null ? itemsFromHtml(html, clientId) : itemsFromText(text ?? "", clientId);
  return { instance: newInstanceId(), items };
}

type TextualContent = BlockContent & { textInstance?: string; items?: TextItem[] };
type TableContent = BlockContent & {
  table?: { cells: string[][]; cellItems?: { instance: string; items: TextItem[] }[][]; headerRow?: boolean; headerCol?: boolean } & Record<string, unknown>;
};

/**
 * Attach CRDT state to content arriving from a wholesale write. When the
 * writer already speaks items (a step-③ client), they are kept and the cache
 * is regenerated from them; otherwise the items are rebuilt from html/text as
 * a new instance. Returns the content to store.
 */
export function withTextInstance(content: BlockContent): BlockContent {
  const c = { ...(content as TextualContent) };
  const table = (c as TableContent).table;
  if (table && Array.isArray(table.cells)) {
    const cellItems = table.cells.map((row, r) =>
      row.map((cell, col) => {
        const existing = table.cellItems?.[r]?.[col];
        if (existing && Array.isArray(existing.items)) return existing;
        return instanceFromContent(undefined, cell);
      })
    );
    (c as TableContent).table = { ...table, cellItems };
  }
  if (Array.isArray(c.items) && typeof c.textInstance === "string") {
    // a client that speaks items: the cache follows the items
    c.html = renderHtml(c.items);
    c.text = renderText(c.items);
    return c;
  }
  if (c.text !== undefined || c.html !== undefined) {
    const inst = instanceFromContent(c.text, c.html);
    c.textInstance = inst.instance;
    c.items = inst.items;
  }
  return c;
}

/** The instance of a block's main text, built lazily when absent. */
export function textInstanceOf(content: BlockContent): TextInstance | null {
  const c = content as TextualContent;
  if (Array.isArray(c.items) && typeof c.textInstance === "string") return { instance: c.textInstance, items: c.items };
  if (c.text === undefined && c.html === undefined) return null;
  return instanceFromContent(c.text, c.html);
}
