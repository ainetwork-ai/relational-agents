// Notion's own clipboard format → blocks.
//
// Copying in Notion puts `text/_notion-blocks-v3-<env>` on the clipboard: the
// REAL block records (types, rich-text runs, checked state, icons, colors,
// children — collapsed toggles included). The HTML/plain flavors are lossy
// markdown round-trips — bold that starts or ends on a space comes out as
// literal `**`, callouts as literal `<aside>`, toggles as plain bullets — so
// when this format is present it always wins.
//
// Pure JSON → tree, no DOM: testable in Node against captured payloads.

import type { BlockType, BlockContent } from "@/lib/db/schema";
import type { PastedBlock } from "./html-paste";
import { CODE_LANGUAGES } from "./block-defs";

// A rich-text run: ["text"] or ["text", [["b"], ["a", href], …]].
type Run = [string, ...unknown[][][]];

interface NotionValue {
  id: string;
  type: string;
  alive?: boolean;
  properties?: Record<string, Run[]> | null;
  format?: Record<string, unknown> | null;
  content?: string[] | null;
}

type BlockMap = Record<string, { value?: NotionValue } | undefined>;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** date mention → the text Notion shows ("2026년 7월 16일") */
function dateText(d: unknown): string {
  const start = (d as { start_date?: string })?.start_date ?? "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : "";
}

/** rich-text runs → {text, html?} — annotations map 1:1 to sanitized inline
 * tags, never through markdown (a bold run ending on a space has no md form). */
function inline(runs: Run[] | undefined): { text: string; html?: string } {
  let text = "";
  let html = "";
  let rich = false;
  for (const run of runs ?? []) {
    let t = typeof run[0] === "string" ? run[0] : "";
    const anns = Array.isArray(run[1]) ? (run[1] as unknown[][]) : [];
    if (t === "‣") {
      // mention chip: dates keep their display text; user/page chips have no
      // local counterpart and no text to keep
      const date = anns.find((a) => a[0] === "d");
      if (!date) continue;
      t = dateText(date[1]);
      if (!t) continue;
      rich = true;
    }
    let h = esc(t).replace(/\n/g, "<br>");
    if (t.includes("\n")) rich = true;
    // a whitespace-only run must NOT be wrapped: sanitizeInline drops inline
    // tags with no visible text, and the space would vanish with the tag
    // (bold whitespace looks identical to plain whitespace anyway)
    if (!t.trim()) {
      text += t;
      html += h;
      continue;
    }
    for (const a of anns) {
      switch (a[0]) {
        case "b": h = `<b>${h}</b>`; rich = true; break;
        case "i": h = `<i>${h}</i>`; rich = true; break;
        case "s": h = `<s>${h}</s>`; rich = true; break;
        case "_": h = `<u>${h}</u>`; rich = true; break;
        case "c": h = `<code>${h}</code>`; rich = true; break;
        case "a": {
          const href = typeof a[1] === "string" ? a[1] : "";
          if (/^(https?:|mailto:)/.test(href)) {
            h = `<a href="${esc(href)}">${h}</a>`;
            rich = true;
          }
          break;
        }
        // "h" (color) has no sanitized-inline form — text survives, color drops
      }
    }
    text += t;
    html += h;
  }
  return rich ? { text, html } : { text };
}

function plain(runs: Run[] | undefined): string {
  return inline(runs).text;
}

/** notion block_color → our callout palette name */
function calloutColor(c: unknown): string | undefined {
  const m = /^([a-z]+)_background$/.exec(typeof c === "string" ? c : "");
  if (!m) return undefined;
  const name = m[1] === "teal" ? "green" : m[1];
  return ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"].includes(name)
    ? name
    : undefined;
}

/** only publicly fetchable image/file urls survive — Notion's private storage
 * (and `attachment:` pointers) need auth we don't have */
function publicUrl(u: unknown): string | undefined {
  const url = typeof u === "string" ? u : "";
  if (!/^https?:\/\//.test(url)) return undefined;
  if (/notion-static\.com|notionusercontent\.com/.test(url)) return undefined;
  return url;
}

const PLAIN_MAP: Partial<Record<string, BlockType>> = {
  text: "paragraph",
  page: "paragraph", // a child-page ref pastes as its title; we can't mint pages
  alias: "paragraph",
  header: "heading1",
  sub_header: "heading2",
  sub_sub_header: "heading3",
  bulleted_list: "bulleted_list",
  numbered_list: "numbered_list",
  quote: "quote",
  equation: "equation",
};

function typed(type: BlockType, runs: Run[] | undefined, extra: BlockContent = {}): PastedBlock {
  return { type, content: { ...extra, ...inline(runs) }, depth: 0 };
}

function emit(v: NotionValue, map: BlockMap, depth: number, out: PastedBlock[]): void {
  const kids = (v.content ?? []).map((id) => map[id]?.value).filter((k): k is NotionValue => !!k && k.alive !== false);
  const title = v.properties?.title;
  const walkKids = (at: number, list: NotionValue[] = kids) => {
    for (const k of list) emit(k, map, at, out);
  };

  switch (v.type) {
    case "to_do":
      out.push({ ...typed("todo", title, { checked: plain(v.properties?.checked) === "Yes" }), depth });
      return walkKids(depth + 1);
    case "toggle":
      // Notion pastes toggles closed — and these originals live closed too
      out.push({ ...typed("toggle", title, { expanded: false }), depth });
      return walkKids(depth + 1);
    case "callout": {
      // v2 callouts keep no text of their own: the first inner text block IS
      // the callout line, the rest nest inside the box as children
      let line = inline(title);
      let rest = kids;
      let firstKids: NotionValue[] = [];
      if (!line.text && kids[0]?.type === "text") {
        line = inline(kids[0].properties?.title);
        firstKids = (kids[0].content ?? [])
          .map((id) => map[id]?.value)
          .filter((k): k is NotionValue => !!k && k.alive !== false);
        rest = kids.slice(1);
      }
      const icon = typeof v.format?.page_icon === "string" && !/^(https?:|attachment:|\/)/.test(v.format.page_icon)
        ? v.format.page_icon
        : null;
      out.push({
        type: "callout",
        content: { ...line, icon, ...(calloutColor(v.format?.block_color) ? { color: calloutColor(v.format?.block_color) } : {}) },
        depth,
      });
      walkKids(depth + 1, firstKids);
      return walkKids(depth + 1, rest);
    }
    case "code": {
      const lang = plain(v.properties?.language).toLowerCase();
      out.push({
        type: "code",
        content: { text: plain(title), language: CODE_LANGUAGES.includes(lang) ? lang : "plain" },
        depth,
      });
      return; // a code block's "children" are its own text, never blocks
    }
    case "divider":
      out.push({ type: "divider", content: {}, depth });
      return;
    case "image": {
      const url = publicUrl(v.properties?.source?.[0]?.[0] ?? v.format?.display_source);
      if (url) out.push({ type: "image", content: { url, text: "" }, depth });
      return;
    }
    case "file": {
      const url = publicUrl(v.properties?.source?.[0]?.[0]);
      const name = plain(title);
      if (name || url) out.push({ type: "file", content: { text: name, ...(url ? { url } : {}) }, depth });
      return;
    }
    case "table": {
      const order = Array.isArray(v.format?.table_block_column_order)
        ? (v.format.table_block_column_order as string[])
        : null;
      const cells = kids
        .filter((k) => k.type === "table_row")
        .map((row) => {
          const cols = order ?? Object.keys(row.properties ?? {});
          return cols.map((cid) => plain(row.properties?.[cid]));
        });
      if (cells.length)
        out.push({
          type: "table",
          content: { table: { cells, headerRow: v.format?.table_block_row_header === true } },
          depth,
        });
      return;
    }
    // layout containers: children keep flowing at this depth
    case "column_list":
    case "column":
      return walkKids(depth);
    // database views can't be minted by a paste — drop, don't leave shells
    case "collection_view":
    case "collection_view_page":
      return;
    default: {
      const mapped = PLAIN_MAP[v.type];
      if (!mapped) return walkKids(depth);
      // keep empty paragraphs — blank lines are part of the page
      out.push({ ...typed(mapped, title), depth });
      return walkKids(depth + 1);
    }
  }
}

/** `text/_notion-blocks-v3-*` payload → typed tree; null when unusable. */
export function notionClipboardToBlocks(json: string): PastedBlock[] | null {
  try {
    const data = JSON.parse(json) as { blocks?: { blockId?: string; blockSubtree?: { block?: BlockMap } }[] };
    if (!Array.isArray(data?.blocks)) return null;
    const out: PastedBlock[] = [];
    for (const top of data.blocks) {
      const map = top?.blockSubtree?.block;
      const root = top?.blockId ? map?.[top.blockId]?.value : undefined;
      if (!map || !root || root.alive === false) continue;
      emit(root, map, 0, out);
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}
