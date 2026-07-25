import type { BlockType, BlockContent, PropertyType, SelectOption } from "@/lib/db/schema";

// ===========================================================================
// OKF (Open Knowledge Format): the md/csv files ARE the content DB. These are
// pure, dependency-free parsers + serializers used by the file-backed store.
// ===========================================================================

export interface ParsedBlock {
  id: string;
  type: BlockType;
  content: BlockContent;
  position: number;
}

const HASH_RE = /\s+[0-9a-f]{32}(?=\.|$|\/)/i;
export function cleanTitle(name: string): string {
  return name.replace(/\.(md|csv)$/i, "").replace(HASH_RE, "").trim() || "Untitled";
}
function stripLinks(s: string): string {
 // Links the app can follow (absolute app routes like /p/{id}, external URLs)
 // survive to become anchors via mdInlineToHtml; workspace-export-internal
 // relative links (raw .md paths) still collapse to their label.
  return s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) =>
    /^(\/|https?:\/\/)/.test(href) ? m : label
  );
}

// ---- OKF YAML frontmatter (a minimal, dependency-free subset) --------------
export type Frontmatter = Record<string, string | string[]>;

export function splitFrontmatter(text: string): { meta: Frontmatter; body: string } {
  const t = text.replace(/\r/g, "");
  if (!t.startsWith("---\n")) return { meta: {}, body: t };
  const end = t.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: t };
  const yaml = t.slice(4, end);
  const body = t.slice(end + 4).replace(/^\n/, "");
  const meta: Frontmatter = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, k, raw] = m;
    const v = raw.trim();
    if (v.startsWith("[") && v.endsWith("]"))
      meta[k] = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else meta[k] = v.replace(/^["']|["']$/g, "");
  }
  return { meta, body };
}

export function serializeFrontmatter(meta: Frontmatter): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    else lines.push(`${k}: ${/[:#]/.test(v) ? JSON.stringify(v) : v}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

/** Inline markdown → sanitized-shape HTML (**b**, *i*, ~~s~~, `code`, [t](u)).
 * Returns undefined when the text carries no inline markers. */
export function mdInlineToHtml(text: string): string | undefined {
  if (!/(\*\*|\*|~~|`|\[[^\]]+\]\()/.test(text)) return undefined;
  let h = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  h = h.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  h = h.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return h === text ? undefined : h;
}

/** Strip inline markers for the plain-text mirror. */
function mdInlinePlain(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1");
}

// ---- Markdown → blocks -----------------------------------------------------
export function parseMarkdown(
  text: string,
  idPrefix = "b",
  opts: { noTitle?: boolean } = {}
): { title: string; meta: Frontmatter; blocks: ParsedBlock[] } {
  const { meta, body } = splitFrontmatter(text);
  const lines = body.split("\n");
  let title = typeof meta.title === "string" ? meta.title : "";
  const drafts: { type: BlockType; content: BlockContent }[] = [];
  let i = 0;
 // pasting markdown into a block keeps the first "# " line as a heading block
 // rather than consuming it as a page title (opts.noTitle).
  if (!opts.noTitle && lines[0]?.startsWith("# ")) {
    title = lines[0].slice(2).trim();
    i = 1;
  }
  const push = (type: BlockType, content: BlockContent) => {
 // inline markdown (bold/italic/code/strike/links) becomes rich html; the
 // plain text mirror drops the markers (links keep their label via strip)
    if (typeof content.text === "string" && content.text) {
      const html = mdInlineToHtml(content.text);
      if (html) {
        content = { ...content, html, text: mdInlinePlain(content.text) };
      }
    }
    drafts.push({ type, content });
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === "") { i++; continue; }

    if (t === "$$") {
      const buf: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") buf.push(lines[i++]);
      i++;
      push("equation", { text: buf.join("\n") });
      continue;
    }
    if (t.startsWith("```")) {
      const lang = t.slice(3).trim() || "plain";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++;
      push("code", { text: buf.join("\n"), language: lang });
      continue;
    }
    if (t.startsWith("|") && t.endsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => stripLinks(c.trim()));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) rows.push(cells);
        i++;
      }
      if (rows.length) push("table", { table: { cells: rows, headerRow: true } });
      continue;
    }
    if (/^#{1,6}\s/.test(t)) {
 // '# ' after the title line is a heading1 block (the first '# ' was the title)
      const level = t.match(/^#+/)![0].length;
      const type = level === 1 ? "heading1" : level === 2 ? "heading2" : "heading3";
      push(type, { text: stripLinks(t.replace(/^#+\s/, "")) });
      i++; continue;
    }
    if (t === "---" || t === "***") { push("divider", {}); i++; continue; }
    if (/^-\s\[[ x]\]/i.test(t)) {
      push("todo", { text: stripLinks(t.replace(/^-\s\[[ x]\]\s*/i, "")), checked: /\[x\]/i.test(t) });
      i++; continue;
    }
    if (/^[-*]\s/.test(t)) { push("bulleted_list", { text: stripLinks(t.replace(/^[-*]\s/, "")) }); i++; continue; }
    if (/^\d+\.\s/.test(t)) { push("numbered_list", { text: stripLinks(t.replace(/^\d+\.\s/, "")) }); i++; continue; }
    if (t.startsWith("> ")) { push("quote", { text: stripLinks(t.slice(2)) }); i++; continue; }
    const img = t.match(/^!\[[^\]]*\]\(([^)]+)\)/);
    if (img) { push("image", { url: img[1], text: "" }); i++; continue; }
    push("paragraph", { text: stripLinks(t) });
    i++;
  }
  const blocks = drafts.map((d, idx) => ({ id: `${idPrefix}${idx}`, type: d.type, content: d.content, position: idx + 1 }));
  return { title: title || "Untitled", meta, blocks };
}

// ---- blocks → Markdown (write-back) ---------------------------------------
export function blocksToMarkdown(title: string, blocks: ParsedBlock[]): string {
  const out: string[] = [`# ${title}`, ""];
  let num = 0;
  for (const b of blocks) {
    const text = b.content.text ?? "";
    if (b.type === "numbered_list") num += 1; else num = 0;
    switch (b.type) {
      case "heading1": out.push(`# ${text}`); break;
      case "heading2": out.push(`## ${text}`); break;
      case "heading3": out.push(`### ${text}`); break;
      case "bulleted_list": out.push(`- ${text}`); break;
      case "numbered_list": out.push(`${num}. ${text}`); break;
      case "todo": out.push(`- [${b.content.checked ? "x" : " "}] ${text}`); break;
      case "quote": out.push(`> ${text}`); break;
      case "callout": out.push(`> 💡 ${text}`); break;
      case "divider": out.push("---"); break;
      case "toc": break; // outline is derived, not content
      case "link_to_page": if (b.content.childPageId) out.push(`[page](/p/${b.content.childPageId})`); break;
      case "file": if (b.content.url) out.push(`[${b.content.text || "file"}](${b.content.url})`); break;
      case "template_button": break; // interactive-only, no md form
      case "ai_prompt": break; // transient prompt UI, never persists content
      case "equation": if (b.content.text) out.push(`$$\n${b.content.text}\n$$`); break;
      case "code": out.push("```" + (b.content.language ?? ""), text, "```"); break;
      case "image": if (b.content.url) out.push(`![](${b.content.url})`); break;
      case "table": {
        const t = b.content.table;
        if (t?.cells?.length) {
          const w = Math.max(...t.cells.map((r) => r.length));
          const pad = (r: string[]) => Array.from({ length: w }, (_, i) => (r[i] ?? "").replace(/\|/g, "\\|"));
          out.push(`| ${pad(t.cells[0]).join(" | ")} |`);
          out.push(`| ${Array(w).fill("---").join(" | ")} |`);
          for (let i = 1; i < t.cells.length; i++) out.push(`| ${pad(t.cells[i]).join(" | ")} |`);
        }
        break;
      }
      default: out.push(text);
    }
    out.push("");
  }
  return out.join("\n");
}

// ---- CSV -------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
 // drop trailing all-empty rows (the final-newline artifact) but keep
 // intentional empty cells within data rows.
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}
export function toCsv(rows: string[][]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
export function normDate(v: string): string | null {
  let m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = Date.parse(v);
  if (!isNaN(d)) {
 // Date.parse reads "March 9, 2026 8:10 AM" as LOCAL time — format the
 // LOCAL day too (toISOString would shift early-morning times a day back)
    const t = new Date(d);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }
  return null;
}
const BOOL_RE = /^(true|false|yes|no|checked|unchecked|✓|✗)$/i;
const URL_RE = /^(https?:\/\/\S+|www\.\S+)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a cell into multi-select tokens (comma-separated). */
export function multiTokens(v: string): string[] {
  return v.split(",").map((t) => t.trim()).filter(Boolean);
}

/** Parse a CSV date cell into the editor's date value: a plain "YYYY-MM-DD"
 * string, or { start, end?, includeTime? } for "a → b" ranges / times. */
export function parseDateCell(raw: string): unknown {
  const norm = (s: string) => {
    const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
    if (m) return m[1];
    return normDate(s.trim()) ?? s.trim();
  };
  const parts = raw.split(/\s*→\s*/);
  if (parts.length === 2) {
    const start = norm(parts[0]);
    return { start, end: norm(parts[1]), includeTime: start.includes("T") };
  }
  const s = norm(raw);
  return s.includes("T") ? { start: s, includeTime: true } : s;
}

function inferType(values: string[]): PropertyType {
  const nn = values.filter((v) => v.trim() !== "");
  if (!nn.length) return "text";
  if (nn.every((v) => /^-?\d+(\.\d+)?%?$/.test(v.trim()))) return "number";
  if (nn.every((v) => BOOL_RE.test(v.trim()))) return "checkbox";
  if (nn.every((v) => URL_RE.test(v.trim()))) return "url";
  if (nn.every((v) => EMAIL_RE.test(v.trim()))) return "email";
  if (nn.every((v) => v.split(/\s*→\s*/).every((seg) => normDate(seg.trim()) !== null)))
    return "date";
 // multi_select: at least one cell carries several comma-separated tokens and
 // the whole vocabulary is bounded (otherwise it's free text).
  const tokenized = nn.map((v) => multiTokens(v));
  if (tokenized.some((t) => t.length > 1)) {
    const vocab = new Set(tokenized.flat());
    if (vocab.size <= 30) return "multi_select";
  }
  const distinct = new Set(nn.map((v) => v.trim()));
  if (distinct.size <= Math.max(8, nn.length * 0.5) && distinct.size <= 30) return "select";
  return "text";
}

export interface FsProperty { id: string; name: string; type: PropertyType; config: { options?: SelectOption[] }; position: number; }
export interface FsRow { id: string; values: Record<string, unknown>; position: number; }

const COLORS = ["gray", "blue", "green", "red", "yellow", "purple", "orange", "pink"];

/** Deterministic option identity — id and color derive from the option NAME,
 * never from appearance order, so adding/removing rows can't recolor options
 * (scienario 14). encodeURIComponent keeps ids unique per name. */
export function optionIdFor(name: string): string {
  return `opt_${encodeURIComponent(name)}`;
}
export function optionColorFor(name: string): string {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

export function parseCsvDatabase(
  text: string,
  rowLimit = Infinity
): { properties: FsProperty[]; rows: FsRow[]; totalRows: number } {
  const grid = parseCsv(text);
  if (!grid.length) return { properties: [], rows: [], totalRows: 0 };
  const headers = grid[0].map((h) => h.trim() || "Column");
  const allData = grid.slice(1);
  const totalRows = allData.length;
 // type inference samples up to 500 rows; rendering is capped by rowLimit.
  const sample = allData.slice(0, 500);
  const data = allData.slice(0, rowLimit);
  const properties: FsProperty[] = headers.map((name, idx) => {
    const col = sample.map((r) => r[idx] ?? "");
    const type: PropertyType = idx === 0 ? "title" : inferType(col);
    const options: SelectOption[] = [];
    if (type === "select") {
      for (const v of new Set(col.map((c) => c.trim()).filter(Boolean)))
        options.push({ id: optionIdFor(v), name: v, color: optionColorFor(v) });
    } else if (type === "multi_select") {
 // option vocabulary = every distinct token across the column
      for (const v of new Set(col.flatMap((c) => multiTokens(c))))
        options.push({ id: optionIdFor(v), name: v, color: optionColorFor(v) });
    }
    return { id: `col${idx}`, name, type, config: options.length ? { options } : {}, position: idx + 1 };
  });
  const rows: FsRow[] = data.map((r, ri) => {
    const values: Record<string, unknown> = {};
    properties.forEach((p, idx) => {
      const raw = (r[idx] ?? "").trim();
      if (!raw) return;
      if (p.type === "number") values[p.id] = Number(raw.replace("%", ""));
      else if (p.type === "date") values[p.id] = parseDateCell(raw);
      else if (p.type === "checkbox") values[p.id] = /^(true|yes|checked|✓)$/i.test(raw);
      else if (p.type === "select") {
        const opt = p.config.options?.find((o) => o.name === raw);
        if (opt) values[p.id] = opt.id;
      } else if (p.type === "multi_select") {
        const ids = multiTokens(raw)
          .map((t) => p.config.options?.find((o) => o.name === t)?.id)
          .filter((x): x is string => !!x);
        if (ids.length) values[p.id] = ids;
      } else values[p.id] = raw;
    });
    return { id: `row${ri}`, values, position: ri + 1 };
  });
  return { properties, rows, totalRows };
}
