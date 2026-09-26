import type { BlockContent, DbProperty, DbRow, TableData } from "@/lib/db/schema";
import { dateEnd, dateStart, findOption, personIds, resolveFilterValue, type RelatedSnapshots } from "@/lib/db-values";
import { treeOrder } from "@/lib/memory-parse";
import type { PBlock, PersonRef, PValue, RichText } from "./model";
import { isUuid } from "./input";
import { NOTION_TYPE } from "./properties";
import { cellPageLinks, htmlToRichText, text } from "./rich-text";

/**
 * ainmem → the Notion shape notion2prompt formats. Pure (no server imports).
 *
 * Blocks, ainmem type → Notion type:
 *   paragraph, heading1-3, bulleted_list, numbered_list, todo, toggle, quote,
 *   divider, code, callout, image, video, bookmark, embed, equation, table
 *   (cells → table_row children), column_list/column, toc → table_of_contents,
 *   child_page, link_to_page, database → child_database, template_button → template.
 * ainmem-only: a file block holding an x402 gift → "gift" (its label only);
 * button → "button"; ai_prompt (a one-shot prompt box that replaces itself) → nothing.
 * Notion types ainmem lacks (breadcrumb, pdf, synced_block, link_preview) are never
 * produced; the renderer still knows them.
 */

export interface MapCtx {
  /** where a page opens */
  pageUrl: (id: string) => string;
}

export interface RawBlock {
  id: string;
  type: string;
  content: BlockContent;
  parentBlockId?: string | null;
  position?: number | null;
}

/** A block's rich text: its stored inline HTML when it has one, else its plain text. */
export function richOf(content: BlockContent, ctx: MapCtx): RichText[] {
  if (typeof content.html === "string" && content.html) return htmlToRichText(content.html, { pageUrl: ctx.pageUrl });
  return typeof content.text === "string" && content.text ? [text(content.text)] : [];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A simple table. A cell's page link is stored as `[Label](/p/<uuid>)` and drawn as a
 *  mention chip; it becomes a page mention here, so the fetch stage checks it for the
 *  readers like any other (the stored label may name a page they cannot see). */
function tableBlock(id: string, t: TableData | undefined, ctx: MapCtx): PBlock {
  const cells = t?.cells ?? [];
  const width = cells.reduce((m, r) => Math.max(m, r.length), 0);
  return {
    id,
    type: "table",
    width,
    hasColumnHeader: !!t?.headerRow,
    hasRowHeader: !!t?.headerCol,
    children: cells.map((row, r) => ({
      id: `${id}:row${r}`,
      type: "table_row" as const,
      cells: row.map((cell, c) => {
        const html = t?.html?.[r]?.[c];
        return cellPageLinks(html ? htmlToRichText(html, { pageUrl: ctx.pageUrl }) : cell ? [text(cell)] : [], ctx.pageUrl);
      }),
    })),
  };
}

/** One ainmem block → its Notion counterpart, or null for one that renders as nothing. */
export function mapBlock(raw: RawBlock, children: PBlock[], ctx: MapCtx): PBlock | null {
  const c = raw.content ?? {};
  const id = raw.id;
  const kids = children.length ? { children } : {};
  const rt = () => richOf(c, ctx);
  switch (raw.type) {
    case "paragraph":
      return { id, type: "paragraph", richText: rt(), ...kids };
    case "heading1":
    case "heading2":
    case "heading3":
      return { id, type: `heading_${raw.type.slice(-1)}` as "heading_1", richText: rt(), ...kids };
    case "bulleted_list":
      return { id, type: "bulleted_list_item", richText: rt(), ...kids };
    case "numbered_list":
      return { id, type: "numbered_list_item", richText: rt(), ...kids };
    case "todo":
      return { id, type: "to_do", richText: rt(), checked: !!c.checked, ...kids };
    case "toggle":
      return { id, type: "toggle", richText: rt(), ...kids };
    case "quote":
      return { id, type: "quote", richText: rt(), ...kids };
    case "divider":
      return { id, type: "divider" };
    case "code": {
      const caption = str(c.caption);
      return { id, type: "code", richText: [text(str(c.text))], language: str(c.language), ...(caption ? { caption: [text(caption)] } : {}) };
    }
    case "callout": {
      const icon = c.icon === null ? null : (str(c.icon) || str(c.emoji) || "💡");
      return {
        id,
        type: "callout",
        richText: rt(),
        icon: icon === null ? null : /^(https?:|\/|data:)/.test(icon) ? { url: icon } : { emoji: icon },
        ...kids,
      };
    }
    case "image": {
      const caption = str(c.caption);
      return { id, type: "image", url: str(c.url), ...(caption ? { caption: [text(caption)] } : {}) };
    }
    case "video":
      return { id, type: "video", url: str(c.url) };
    case "bookmark": {
      const url = str(c.url);
      const caption = str(c.caption) || (str(c.text) !== url ? str(c.text) : "");
      return { id, type: "bookmark", url, ...(caption ? { caption: [text(caption)] } : {}) };
    }
    case "embed":
      return { id, type: "embed", url: str(c.url) };
    case "file": {
      const gift = c.gift as { spec?: { title?: unknown } } | undefined;
      if (gift && typeof gift === "object") return { id, type: "gift", label: str(c.text) || str(gift.spec?.title) || "Gift" };
      const name = str(c.text);
      return { id, type: "file", url: str(c.url), ...(name ? { caption: [text(name)] } : {}) };
    }
    case "equation":
      return { id, type: "equation", expression: str(c.text) };
    case "table":
      return tableBlock(id, c.table, ctx);
    case "column_list":
      return { id, type: "column_list", ...kids };
    case "column":
      return { id, type: "column", ...kids };
    case "toc":
      return { id, type: "table_of_contents" };
    case "child_page":
      return { id, type: "child_page", title: str(c.text), ...(c.childPageId ? { pageId: c.childPageId } : {}) };
    case "link_to_page":
      return c.childPageId ? { id, type: "link_to_page", pageId: c.childPageId } : null;
    case "database":
      return c.databaseId ? { id, type: "child_database", title: "", content: { state: "not_fetched", databaseId: c.databaseId } } : null;
    case "template_button": {
      const body = str(c.template);
      const inner: PBlock[] = body ? [{ id: `${id}:template`, type: "paragraph", richText: [text(body)] }] : [];
      return { id, type: "template", richText: rt(), ...(inner.length || children.length ? { children: [...inner, ...children] } : {}) };
    }
    case "button":
      return { id, type: "button", label: str(c.text) || "Button" };
    case "ai_prompt":
      return null;
    default:
      return { id, type: "unsupported", blockType: raw.type, ...kids };
  }
}

/** Nesting deeper than this is cut (notion2prompt's BLOCK_MAX_RENDER_DEPTH). */
export const MAX_BLOCK_NESTING = 100;

/** A page's flat block rows (parentBlockId + position) → the nested Notion blocks. */
export function nestBlocks(rows: RawBlock[], ctx: MapCtx): PBlock[] {
  const ordered = treeOrder(rows);
  interface Slot {
    raw: RawBlock;
    depth: number;
    kids: Slot[];
  }
  const roots: Slot[] = [];
  const stack: Slot[] = [];
  for (const { row, depth } of ordered) {
    if (depth >= MAX_BLOCK_NESTING) continue;
    const slot: Slot = { raw: row, depth, kids: [] };
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1].kids.push(slot);
    else roots.push(slot);
    stack.push(slot);
  }
  const build = (s: Slot): PBlock | null => mapBlock(s.raw, s.kids.map(build).filter((b): b is PBlock => !!b), ctx);
  return roots.map(build).filter((b): b is PBlock => !!b);
}

/** OKF blocks carry a depth instead of a parent id. */
export function nestByDepth(rows: { id: string; type: string; content: BlockContent; depth?: number }[], ctx: MapCtx): PBlock[] {
  const ids = rows.map((r) => r.id);
  const parents: (string | null)[] = [];
  const lastAt: string[] = [];
  rows.forEach((r, i) => {
    const d = Math.max(0, Math.min(r.depth ?? 0, lastAt.length));
    lastAt.length = d;
    parents.push(d === 0 ? null : lastAt[d - 1] ?? null);
    lastAt[d] = ids[i];
  });
  return nestBlocks(
    rows.map((r, i) => ({ id: r.id, type: r.type, content: r.content, parentBlockId: parents[i], position: i + 1 })),
    ctx
  );
}

// ── property values ─────────────────────────────────────────────────────────

export interface ValueCtx {
  /** display name / email by user id */
  users: Map<string, { name?: string | null; email?: string | null }>;
  /** every property of the row's database (formulas read their neighbours) */
  props: DbProperty[];
  /** target databases of relations and rollups the readers may see */
  related?: RelatedSnapshots;
}

const person = (id: string, ctx: ValueCtx): PersonRef => {
  const u = ctx.users.get(id);
  return { id, name: u?.name ?? null, email: u?.email ?? null };
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : "");

function numberOf(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const fileName = (url: string) => {
  const last = url.split(/[?#]/)[0].split("/").pop() ?? url;
  try {
    return decodeURIComponent(last) || url;
  } catch {
    return last || url;
  }
};

/** The id a Postgres database row is printed under — its own page's id when it has one
 *  (a row opened as a page: values.__page), else the row's — as source-db.ts gives each row. */
export function rowPageId(row: Pick<DbRow, "id" | "values">): string {
  const pid = row.values?.__page;
  return typeof pid === "string" && isUuid(pid) ? pid : row.id;
}

/** One stored cell → its Notion-shaped value. */
export function mapValue(prop: DbProperty, row: DbRow, ctx: ValueCtx): PValue {
  const v = row.values?.[prop.id];
  switch (prop.type) {
    case "title":
      return { type: "title", richText: v === null || v === undefined || v === "" ? [] : [text(String(v))] };
    case "text":
      return { type: "rich_text", richText: v === null || v === undefined || v === "" ? [] : [text(String(v))] };
    case "number":
      return { type: "number", number: numberOf(v) };
    case "select":
    case "status":
      return { type: prop.type, name: findOption(prop, v)?.name ?? null };
    case "multi_select":
      return {
        type: "multi_select",
        names: (Array.isArray(v) ? v : v ? [v] : []).map((x) => findOption(prop, x)?.name).filter((x): x is string => !!x),
      };
    case "date": {
      const start = dateStart(v);
      const end = dateEnd(v);
      return { type: "date", start: start || null, end: end || null };
    }
    case "person":
      return { type: "people", people: personIds(v).map((id) => person(id, ctx)) };
    case "checkbox":
      return { type: "checkbox", checked: v === true || v === "true" };
    case "url":
      return { type: "url", url: typeof v === "string" && v ? v : null };
    case "email":
      return { type: "email", value: typeof v === "string" && v ? v : null };
    case "phone":
      return { type: "phone_number", value: typeof v === "string" && v ? v : null };
    case "files":
      return {
        type: "files",
        files: (Array.isArray(v) ? v : []).filter((u): u is string => typeof u === "string" && !!u).map((url) => ({ name: fileName(url), url })),
      };
    case "relation": {
      const r = resolveFilterValue(row, prop, ctx.props, ctx.related);
      const ids = Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : typeof r === "string" && r ? [r] : [];
      // a relation stores target ROW ids; each is printed as that row prints its own
      // Page ID (its page's id when it has one), so the model can join them — as upstream,
      // where a relation lists the related pages' ids
      const target = prop.config?.mirrorOf?.databaseId ?? prop.config?.relationDatabaseId;
      const rows = target ? ctx.related?.[target]?.rows : undefined;
      if (!rows) return { type: "relation", ids };
      const pageOf = new Map(rows.map((x) => [x.id, rowPageId(x)]));
      return { type: "relation", ids: ids.map((id) => pageOf.get(id) ?? id) };
    }
    case "formula": {
      const r = resolveFilterValue(row, prop, ctx.props, ctx.related);
      return { type: "formula", formula: { type: "number", number: numberOf(r) } };
    }
    case "rollup": {
      const r = resolveFilterValue(row, prop, ctx.props, ctx.related);
      return { type: "rollup", rollup: { type: "number", number: numberOf(r) } };
    }
    case "created_time":
      return { type: "created_time", time: iso(row.createdAt) };
    case "last_edited_time":
      return { type: "last_edited_time", time: iso(row.updatedAt) };
    case "created_by":
      return row.createdBy ? { type: "created_by", user: person(row.createdBy, ctx) } : { type: "people", people: [] };
    case "last_edited_by":
      return row.updatedBy ? { type: "last_edited_by", user: person(row.updatedBy, ctx) } : { type: "people", people: [] };
    default:
      return { type: "rich_text", richText: v === null || v === undefined || v === "" ? [] : [text(String(v))] };
  }
}

/** A database's schema as notion2prompt prints it (unknown types read "title", as upstream). */
export function schemaOf(props: DbProperty[]): { name: string; type: string }[] {
  return props.map((p) => ({ name: p.name, type: NOTION_TYPE[p.type] ?? "title" }));
}

/** Row properties in schema order. */
export function rowProperties(props: DbProperty[], row: DbRow, ctx: ValueCtx) {
  return props.map((p) => ({ name: p.name, value: mapValue(p, row, ctx) }));
}

/** A row's title as plain text. */
export function rowTitle(props: DbProperty[], row: DbRow): string {
  const t = props.find((p) => p.type === "title");
  const v = t ? row.values?.[t.id] : undefined;
  return v === null || v === undefined ? "" : String(v);
}
