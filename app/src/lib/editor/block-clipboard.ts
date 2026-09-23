/**
 * What ⌘C puts on the clipboard for a block selection or a text selection that
 * spans blocks — measured on Notion 2026-09-09 (docs/notion-selection-copy.md
 * §3): `text/plain` is markdown (`### `, `- `, `1. `, children indented four
 * spaces, a blank line between non-list blocks), `text/html` is semantic
 * (h1–h3, p, ul/ol/li nested, blockquote, pre, img, hr, table), plus an
 * internal block tree the editor's paste reads first. Pure, so it can be
 * checked without a browser.
 */
import type { BlockContent, BlockType } from "@/lib/db/schema";
import type { PastedBlock } from "@/lib/editor/html-paste";
import { inlineHtmlToMd, sanitizeInline } from "@/lib/rich-text";

export const AINMEM_MIME = "text/_ainmem-blocks-v1";

export interface ClipBlock {
  id: string;
  type: BlockType;
  content: BlockContent;
  parentBlockId: string | null;
  position: number;
}
export interface ClipPayload {
  text: string;
  html: string;
  tree: PastedBlock[];
}

/** Blocks with no text of their own. A text drag that reaches one of these
 * turns into a block selection (Notion D); a drag across the others stays a
 * text selection (Notion B·C·H). */
const NON_TEXT = new Set<string>([
  "image", "file", "divider", "database", "child_page", "column", "column_list", "table",
  "bookmark", "embed", "video", "toc", "template_button", "button", "equation", "ai_prompt",
]);
export const isTextBlockType = (t: string): boolean => !NON_TEXT.has(t);

const LIST = new Set<string>(["bulleted_list", "numbered_list", "todo", "toggle"]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => esc(s).replace(/"/g, "&quot;");
const inlineHtml = (c: BlockContent, o?: string) => (o !== undefined ? o : c.html ? sanitizeInline(c.html) : esc(c.text ?? ""));
const inlineMd = (c: BlockContent, o?: string) => (o !== undefined ? inlineHtmlToMd(o) : c.html ? inlineHtmlToMd(c.html) : (c.text ?? ""));
const plainOf = (html: string) => inlineHtmlToMd(html).replace(/[*_~`]/g, "");

type Ctx = {
  kids: Map<string | null, ClipBlock[]>;
  /** unfiltered siblings, for list numbering */
  fullKids: Map<string | null, ClipBlock[]>;
  overrides?: Map<string, string>;
  md: string[];
  html: string[];
  tree: PastedBlock[];
};

/** 1-based index of a numbered item among its consecutive numbered siblings. */
function numberOf(b: ClipBlock, sibs: ClipBlock[]): number {
  let n = 0;
  for (const s of sibs) {
    if (s.type === "numbered_list") n++;
    else n = 0;
    if (s.id === b.id) return n;
  }
  return 1;
}

/** The content that travels: no CRDT items/marks/instance (the receiver mints
 * its own), the inline html (possibly the selected part) and its plain text. */
function travelContent(c: BlockContent, o?: string): BlockContent {
  const { items: _i, marks: _m, textInstance: _t, ...rest } = c as BlockContent & { items?: unknown; marks?: unknown; textInstance?: unknown };
  if (o !== undefined) return { ...rest, html: o, text: plainOf(o) } as BlockContent;
  return rest as BlockContent;
}

function emitMd(ctx: Ctx, b: ClipBlock, depth: number, sibs: ClipBlock[]): void {
  const o = ctx.overrides?.get(b.id);
  const c = b.content;
  const t = inlineMd(c, o);
  const ind = "    ".repeat(depth);
  const line = (s: string) => ctx.md.push(ind + s);
  switch (b.type) {
    case "heading1": line(`# ${t}`); break;
    case "heading2": line(`## ${t}`); break;
    case "heading3": line(`### ${t}`); break;
    case "bulleted_list": line(`- ${t}`); break;
    case "toggle": line(`- ${t}`); break;
    case "numbered_list": line(`${numberOf(b, ctx.fullKids.get(b.parentBlockId ?? null) ?? sibs)}. ${t}`); break;
    case "todo": line(`- [${c.checked ? "x" : " "}] ${t}`); break;
    case "quote": line(`> ${t}`); break;
    case "callout": line(`> ${c.icon || "💡"} ${t}`); break;
    case "divider": line("---"); break;
    case "code": line("```" + (c.language ?? "")); for (const l of (c.text ?? "").split("\n")) line(l); line("```"); break;
    case "image": if (c.url) line(`![${String(c.caption ?? c.text ?? "").replace(/[\[\]]/g, "")}](${c.url})`); break;
    case "file": if (c.url) line(`[${c.text || "file"}](${c.url})`); break;
    case "child_page": case "link_to_page": if (c.childPageId) line(`[${c.text || "page"}](/p/${c.childPageId})`); break;
    case "equation": if (c.text) { line("$$"); line(c.text); line("$$"); } break;
    case "table": {
      const tb = c.table;
      if (tb?.cells?.length) {
        const w = Math.max(...tb.cells.map((r) => r.length));
        const pad = (r: string[]) => Array.from({ length: w }, (_, i) => (r[i] ?? "").replace(/\|/g, "\\|"));
        line(`| ${pad(tb.cells[0]).join(" | ")} |`);
        line(`| ${Array(w).fill("---").join(" | ")} |`);
        for (let i = 1; i < tb.cells.length; i++) line(`| ${pad(tb.cells[i]).join(" | ")} |`);
      }
      break;
    }
    case "toc": case "template_button": case "button": case "ai_prompt": case "database": case "column_list": case "column": case "bookmark": case "embed": case "video":
      if (t) line(t);
      break;
    default: line(t);
  }
  const kids = ctx.kids.get(b.id) ?? [];
  for (const k of kids) emitMd(ctx, k, depth + 1, kids);
}

function emitHtmlGroup(ctx: Ctx, blocks: ClipBlock[]): void {
  // consecutive list siblings share one <ul>/<ol>, like the original's html
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "bulleted_list" || b.type === "todo" || b.type === "toggle" || b.type === "numbered_list") {
      const ordered = b.type === "numbered_list";
      const run: ClipBlock[] = [];
      while (i < blocks.length && (ordered ? blocks[i].type === "numbered_list" : blocks[i].type !== "numbered_list" && LIST.has(blocks[i].type))) run.push(blocks[i++]);
      const start = ordered ? numberOf(run[0], ctx.fullKids.get(run[0].parentBlockId ?? null) ?? blocks) : 1;
      ctx.html.push(ordered ? (start > 1 ? `<ol start="${start}">` : "<ol>") : "<ul>");
      for (const li of run) {
        const o = ctx.overrides?.get(li.id);
        const box = li.type === "todo" ? `<input type="checkbox" disabled${li.content.checked ? " checked" : ""}> ` : "";
        const kids = ctx.kids.get(li.id) ?? [];
        if (kids.length) {
          ctx.html.push(`<li>${box}${inlineHtml(li.content, o)}`);
          emitHtmlGroup(ctx, kids);
          ctx.html.push("</li>");
        } else ctx.html.push(`<li>${box}${inlineHtml(li.content, o)}</li>`);
      }
      ctx.html.push(ordered ? "</ol>" : "</ul>");
      continue;
    }
    emitHtmlOne(ctx, b);
    i++;
  }
}

function emitHtmlOne(ctx: Ctx, b: ClipBlock): void {
  const o = ctx.overrides?.get(b.id);
  const c = b.content;
  const t = inlineHtml(c, o);
  switch (b.type) {
    case "heading1": ctx.html.push(`<h1>${t}</h1>`); break;
    case "heading2": ctx.html.push(`<h2>${t}</h2>`); break;
    case "heading3": ctx.html.push(`<h3>${t}</h3>`); break;
    case "quote": ctx.html.push(`<blockquote>${t}</blockquote>`); break;
    case "callout": ctx.html.push(`<blockquote>${c.icon ? esc(String(c.icon)) + " " : ""}${t}</blockquote>`); break;
    case "divider": ctx.html.push("<hr>"); break;
    case "code": ctx.html.push(`<pre><code${c.language ? ` class="language-${attr(String(c.language))}"` : ""}>${esc(c.text ?? "")}</code></pre>`); break;
    case "image": if (c.url) ctx.html.push(`<p><img src="${attr(String(c.url))}" alt="${attr(String(c.caption ?? c.text ?? ""))}"></p>`); break;
    case "file": if (c.url) ctx.html.push(`<p><a href="${attr(String(c.url))}">${esc(c.text || "file")}</a></p>`); break;
    case "child_page": case "link_to_page": if (c.childPageId) ctx.html.push(`<p><a href="/p/${attr(String(c.childPageId))}">${esc(c.text || "page")}</a></p>`); break;
    case "table": {
      const tb = c.table;
      if (tb?.cells?.length) {
        ctx.html.push("<table>");
        tb.cells.forEach((row, r) => { const tag = r === 0 && tb.headerRow ? "th" : "td"; ctx.html.push(`<tr>${row.map((cell) => `<${tag}>${esc(cell)}</${tag}>`).join("")}</tr>`); });
        ctx.html.push("</table>");
      }
      break;
    }
    default: if (t || b.type === "paragraph") ctx.html.push(`<p>${t}</p>`);
  }
  const kids = ctx.kids.get(b.id) ?? [];
  if (kids.length) emitHtmlGroup(ctx, kids);
}

function emitTree(ctx: Ctx, b: ClipBlock, depth: number): void {
  ctx.tree.push({ type: b.type, content: travelContent(b.content, ctx.overrides?.get(b.id)), depth });
  for (const k of ctx.kids.get(b.id) ?? []) emitTree(ctx, k, depth + 1);
}

/**
 * Serialize `rootIds` (in visual order; descendants come along) out of `all`.
 * `overrides` maps a block id to the inline html of just its SELECTED part —
 * how a text selection that spans blocks copies the first and last block.
 */
export function serializeBlocks(
  all: ClipBlock[],
  rootIds: string[],
  overrides?: Map<string, string>,
  opts: { onlyListed?: boolean } = {}
): ClipPayload {
  // a text selection names exactly the blocks it touched — descendants that
  // were not part of it must not come along
  // numbering always counts the REAL siblings (the original keeps "2." when the
  // selection starts at the second item), even when only some travel
  const fullKids = new Map<string | null, ClipBlock[]>();
  for (const b of all) {
    const p = b.parentBlockId ?? null;
    if (!fullKids.has(p)) fullKids.set(p, []);
    fullKids.get(p)!.push(b);
  }
  for (const list of fullKids.values()) list.sort((a, b) => a.position - b.position);
  if (opts.onlyListed) {
    const keep = new Set(rootIds);
    all = all.filter((b) => keep.has(b.id));
  }
  const kids = new Map<string | null, ClipBlock[]>();
  for (const b of all) {
    const p = b.parentBlockId ?? null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(b);
  }
  for (const list of kids.values()) list.sort((a, b) => a.position - b.position);
  const byId = new Map(all.map((b) => [b.id, b]));
  const roots = rootIds.map((id) => byId.get(id)).filter((b): b is ClipBlock => !!b);
  // a root whose ancestor is also a root is already covered by that ancestor
  const rootSet = new Set(roots.map((r) => r.id));
  const covered = (b: ClipBlock) => { let p = b.parentBlockId; while (p) { if (rootSet.has(p)) return true; p = byId.get(p)?.parentBlockId ?? null; } return false; };
  const top = roots.filter((r) => !covered(r));

  const ctx: Ctx = { kids, fullKids, overrides, md: [], html: [], tree: [] };
  // markdown: one block after another; a blank line between blocks unless
  // both are list items (the original's `### h\n\n- item` vs `1. a\n- b`)
  const mdParts: string[] = [];
  let prevList = false;
  top.forEach((b, i) => {
    ctx.md = [];
    const sibs = kids.get(b.parentBlockId ?? null) ?? [b];
    emitMd(ctx, b, 0, sibs);
    const isList = LIST.has(b.type);
    if (i > 0) mdParts.push(isList && prevList ? "\n" : "\n\n");
    mdParts.push(ctx.md.join("\n"));
    prevList = isList;
  });
  emitHtmlGroup(ctx, top);
  for (const b of top) emitTree(ctx, b, 0);
  return { text: mdParts.join(""), html: ctx.html.join("\n"), tree: ctx.tree };
}

/** Put a payload on a clipboard event's DataTransfer (call from a copy handler). */
export function writePayload(dt: DataTransfer, p: ClipPayload): void {
  dt.setData("text/plain", p.text);
  dt.setData("text/html", p.html);
  dt.setData(AINMEM_MIME, JSON.stringify(p.tree));
}

/**
 * Copy a payload when there is no native selection to piggyback on (a block
 * selection blurs the caret). Chrome only fires `copy` from execCommand when
 * something is selected, so a throwaway textarea holds a space, our one-shot
 * capture listener overrides the data, and the textarea goes away again.
 */
export function copyPayload(p: ClipPayload): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = " ";
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(ta);
  const active = document.activeElement as HTMLElement | null;
  ta.focus();
  ta.select();
  const onCopy = (ev: ClipboardEvent) => {
    if (!ev.clipboardData) return;
    ev.preventDefault();
    writePayload(ev.clipboardData, p);
  };
  document.addEventListener("copy", onCopy, { capture: true, once: true });
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  document.removeEventListener("copy", onCopy, true);
  ta.remove();
  if (active && active !== document.body) active.focus?.();
  else (document.activeElement as HTMLElement | null)?.blur?.();
  if (!ok) void navigator.clipboard?.writeText(p.text).catch(() => {});
  return ok;
}

/** Parse our own clipboard flavor back into the paste tree; null if absent/bad. */
export function readPayloadTree(dt: DataTransfer): PastedBlock[] | null {
  const raw = dt.getData(AINMEM_MIME);
  if (!raw) return null;
  try {
    const tree = JSON.parse(raw) as PastedBlock[];
    return Array.isArray(tree) && tree.every((b) => b && typeof b.type === "string" && typeof b.depth === "number") ? tree : null;
  } catch {
    return null;
  }
}
