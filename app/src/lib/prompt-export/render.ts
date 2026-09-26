import type { PBlock, PDatabase, PPage, PromptContent, RenderedFile, RenderedPrompt, RenderOptions, RichText, TreeNode } from "./model";
import { alignmentOf, escapeForTable, renderPropertyValue } from "./properties";
import { idHex, richTextPlain, richTextToMarkdown, type RichTextOptions } from "./rich-text";
import { renderTemplate, TEMPLATES } from "./template";

/**
 * The render stage — notion2prompt's render_prompt and everything under it
 * (src/formatting: block_renderer.rs, pure_visitor.rs, state.rs, databases/,
 * direct_template.rs), rule for rule. Pure and deterministic: the same content
 * tree and options give the same bytes, with no database or network.
 *
 * The notion2prompt quirks its golden files encode are kept on purpose (and the
 * check script pins them): numbering restarts after any non-list block and prints
 * "1." inside containers and bullet-started runs; a simple table's separator always
 * follows row 1; a callout has two spaces after its emoji; an inline database table
 * ends in "  " with no newline; "Database contains 1 pages."; no blank line before a
 * database summary's Metadata.
 */

// ── FormatContext (state.rs): immutable, threaded through siblings ────────────

interface Ctx {
  /** list stack: a number is a numbered list's next number, "b" a bulleted list */
  list: (number | "b")[];
  /** rows seen in the current simple table, null outside one */
  table: number | null;
}
const EMPTY: Ctx = { list: [], table: null };
const enterNumbered = (c: Ctx): Ctx => ({ ...c, list: [...c.list, 1] });
const enterBulleted = (c: Ctx): Ctx => ({ ...c, list: [...c.list, "b"] });
const currentNumber = (c: Ctx) => {
  const top = c.list[c.list.length - 1];
  return typeof top === "number" ? top : 1;
};
const increment = (c: Ctx): Ctx => {
  const top = c.list[c.list.length - 1];
  return typeof top === "number" ? { ...c, list: [...c.list.slice(0, -1), top + 1] } : c;
};
const enterTable = (c: Ctx): Ctx => ({ ...c, table: 0 });
const processRow = (c: Ctx): Ctx => (c.table === null ? c : { ...c, table: c.table + 1 });

export interface RenderEnv extends RichTextOptions {
  /** databases a child_database block may point at (the gathered-databases map) */
  databases?: Record<string, PDatabase>;
  /** merged child pages: what goes right after a child page's placeholder */
  afterChildPage?: (pageId: string) => string;
  /** the slice render_blocks was given — what a table of contents lists */
  documentBlocks?: PBlock[];
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Rust's str::lines: split on \n, a final line ending adds no empty line, \r\n counts as one. */
function rustLines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

/** indent_block_content: indent non-empty lines, keep blank ones, one trailing newline. */
function indentBlockContent(text: string, indent: string): string {
  return rustLines(text).map((l) => (l === "" ? l : indent + l)).join("\n") + "\n";
}

/** format_text_content */
function textLine(rt: RichText[], prefix: string, env: RenderEnv): string {
  const md = richTextToMarkdown(rt, env);
  return md.trim() === "" ? `${prefix}\n` : `${prefix}${md}\n`;
}

const utf8 = new TextEncoder();
/** Rust String ordering: byte-wise over UTF-8. */
export function byteCompare(a: string, b: string): number {
  const x = utf8.encode(a);
  const y = utf8.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

// ── blocks ──────────────────────────────────────────────────────────────────

function renderChildren(blocks: PBlock[] | undefined, ctx: Ctx, env: RenderEnv): string {
  if (!blocks?.length) return "";
  let out = "";
  let c = ctx;
  for (const b of blocks) {
    const r = renderBlock(b, c, env);
    out += r.content;
    c = r.ctx;
  }
  return out;
}

function renderIndented(blocks: PBlock[] | undefined, ctx: Ctx, env: RenderEnv, indent: string): string {
  if (!blocks?.length) return "";
  return indentBlockContent(renderChildren(blocks, ctx, env), indent);
}

interface TocEntry {
  level: number;
  text: string;
}

function collectHeadings(blocks: PBlock[], out: TocEntry[], env: RenderEnv) {
  for (const b of blocks) {
    if (b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3") {
      const text = richTextToMarkdown(b.richText, env);
      if (text.trim()) out.push({ level: Number(b.type.slice(-1)), text: text.trim() });
    }
    if (b.children?.length) collectHeadings(b.children, out, env);
  }
}

/** create_anchor_link: lowercase, keep what Rust's char::is_alphanumeric keeps (the
 *  Unicode Alphabetic property — combining vowel signs of Devanagari, Thai, Bengali …
 *  included — or Numeric), char::is_whitespace (White_Space) → "-", drop the rest. */
export function anchorOf(text: string): string {
  let s = "";
  for (const ch of text.toLowerCase()) {
    if (/[\p{Alphabetic}\p{N}]/u.test(ch)) s += ch;
    else if (/\p{White_Space}/u.test(ch)) s += "-";
  }
  return s.replace(/^-+|-+$/g, "");
}

function tableOfContents(env: RenderEnv): string {
  if (!env.documentBlocks) return "[Table of Contents]\n";
  const entries: TocEntry[] = [];
  collectHeadings(env.documentBlocks, entries, env);
  if (!entries.length) return "[Table of Contents - No headings found]\n";
  let out = "## Table of Contents\n\n";
  for (const e of entries) out += `${"  ".repeat(Math.max(0, e.level - 1))}* [${e.text}](#${anchorOf(e.text)})\n`;
  return out + "\n";
}

function childDatabase(b: Extract<PBlock, { type: "child_database" }>, env: RenderEnv): string {
  const c = b.content;
  const lookup = (id?: string) => (id ? env.databases?.[id] : undefined);
  if (c.state === "linked") return `🗄️ **${b.title}** _(linked database — not retrievable via API)_\n`;
  if (c.state === "inaccessible") return `🗄️ [[${b.title}]]\n`;
  const db = lookup(c.databaseId);
  return db ? formatDatabaseInline(db, db.rows, "") : `🗄️ [[${b.title}]]\n`;
}

function renderBlock(b: PBlock, ctx: Ctx, env: RenderEnv): { content: string; ctx: Ctx } {
  let content: string;
  switch (b.type) {
    case "paragraph":
      content = textLine(b.richText, "", env) + renderChildren(b.children, ctx, env);
      break;
    case "heading_1":
    case "heading_2":
    case "heading_3":
      content = textLine(b.richText, `${"#".repeat(Number(b.type.slice(-1)))} `, env) + renderChildren(b.children, ctx, env);
      break;
    case "bulleted_list_item":
      content = textLine(b.richText, "- ", env) + renderIndented(b.children, enterBulleted(ctx), env, "   ");
      break;
    case "numbered_list_item":
      content = textLine(b.richText, `${currentNumber(ctx)}. `, env) + renderIndented(b.children, enterNumbered(ctx), env, "   ");
      break;
    case "to_do":
      content = textLine(b.richText, `- ${b.checked ? "[x]" : "[ ]"} `, env) + renderIndented(b.children, ctx, env, "  ");
      break;
    case "toggle":
      content = textLine(b.richText, "▸ ", env) + renderIndented(b.children, ctx, env, "  ");
      break;
    case "quote":
      content = textLine(b.richText, "> ", env) + renderChildren(b.children, ctx, env);
      break;
    case "callout": {
      const emoji = b.icon && "emoji" in b.icon ? `${b.icon.emoji} ` : "";
      content = textLine(b.richText, `> ${emoji} `, env) + renderChildren(b.children, ctx, env);
      break;
    }
    case "code": {
      const caption = b.caption?.length ? richTextToMarkdown(b.caption, env) : "";
      content = `\`\`\`${b.language}\n${richTextPlain(b.richText)}\n\`\`\`\n` + (caption ? `*${caption}*\n` : "");
      break;
    }
    case "divider":
      content = "---\n";
      break;
    case "equation":
      content = `$$\n${b.expression}\n$$\n`;
      break;
    case "image":
      content = `![${b.caption?.length ? richTextToMarkdown(b.caption, env) : "Image"}](${b.url})\n`;
      break;
    case "video":
      content = `[Video: ${b.url}]\n`;
      break;
    case "file":
      content = `[${b.caption?.length ? richTextToMarkdown(b.caption, env) : "File"}: ${b.url}]\n`;
      break;
    case "pdf":
      content = `[PDF: ${b.url}]\n`;
      break;
    case "bookmark":
      content = `[🔖 ${b.url}${b.caption?.length ? ` - ${richTextToMarkdown(b.caption, env)}` : ""}]\n`;
      break;
    case "embed":
      content = `[Embed: ${b.url}]\n`;
      break;
    case "child_page":
      content = `📄 [[${b.title}]]\n` + (b.pageId && env.afterChildPage ? env.afterChildPage(b.pageId) : "");
      break;
    case "child_database":
      content = childDatabase(b, env);
      break;
    case "link_to_page":
      // notion2prompt knows no title here and prints the id; ainmem draws a linked page
      // exactly like a sub-page, so once the fetch stage has its title it reads the same
      content =
        (b.title !== undefined ? `📄 [[${b.title}]]\n` : `[[${idHex(b.pageId)}]]\n`) +
        (env.afterChildPage ? env.afterChildPage(b.pageId) : "");
      break;
    case "table":
      content = renderChildren(b.children, enterTable(ctx), env);
      break;
    case "table_row": {
      let row = "|" + b.cells.map((c) => ` ${richTextToMarkdown(c, env)} |`).join("") + "\n";
      if (ctx.table === 0) row += "|" + " --- |".repeat(b.cells.length) + "\n";
      content = row;
      break;
    }
    case "column_list":
    case "column":
      content = renderChildren(b.children, ctx, env);
      break;
    case "synced_block":
      content = (b.syncedFrom ? `[Synced from: ${idHex(b.syncedFrom)}]\n` : "") + renderChildren(b.children, ctx, env);
      break;
    case "template":
      content = textLine(b.richText, "[Template] ", env) + renderChildren(b.children, ctx, env);
      break;
    case "link_preview":
      content = `[Link Preview: ${b.url}]\n`;
      break;
    case "breadcrumb":
      content = "[Breadcrumb]\n";
      break;
    case "table_of_contents":
      content = tableOfContents(env);
      break;
    case "unsupported":
      content = `[Unsupported block type: ${b.blockType}]\n`;
      break;
    case "gift":
      // ainmem's x402 gift: its label only — never the file, price or recipient behind it
      content = `[🎁 Gift: ${b.label}]\n`;
      break;
    case "button":
      content = `[Button: ${b.label}]\n`;
      break;
  }
  const next = b.type === "numbered_list_item" ? increment(ctx) : b.type === "table_row" ? processRow(ctx) : ctx;
  return { content, ctx: next };
}

const isListItem = (b: PBlock | undefined) => b?.type === "numbered_list_item" || b?.type === "bulleted_list_item";

/** render_blocks: a top-level run of list items shares one list context, restored after it. */
export function renderBlocks(blocks: PBlock[], env: RenderEnv = {}): string {
  const e: RenderEnv = { ...env, documentBlocks: blocks };
  let out = "";
  let ctx = EMPTY;
  const saved: Ctx[] = [];
  blocks.forEach((b, i) => {
    const list = isListItem(b);
    if (list && (i === 0 || !isListItem(blocks[i - 1]))) {
      saved.push(ctx);
      ctx = b.type === "numbered_list_item" ? enterNumbered(ctx) : enterBulleted(ctx);
    }
    const r = renderBlock(b, ctx, e);
    out += r.content;
    ctx = r.ctx;
    if (list && !isListItem(blocks[i + 1])) ctx = saved.pop() ?? ctx;
  });
  return out;
}

// ── databases (databases/mod.rs, builder.rs, render.rs) ───────────────────────

const propOf = (row: PPage, name: string) => row.properties.find((p) => p.name === name)?.value;

/** The table TableBuilder builds with include_empty_rows(true), rendered as markdown. */
export function tableMarkdown(db: PDatabase, rows: PPage[]): string {
  const cols = db.schema
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => (a.type === "title" && b.type === "title" ? 0 : a.type === "title" ? -1 : b.type === "title" ? 1 : byteCompare(a.name, b.name)));
  if (!cols.length || !rows.length) return "*No data available.*\n";
  let out = "| " + cols.map((c) => `${escapeForTable(c.name)} |`).join("") + "\n";
  out += "|" + cols.map((c) => ` ${alignmentOf(c.type)} |`).join("") + "\n";
  for (const row of rows) {
    const cells = cols.map((c) => {
      const v = renderPropertyValue(propOf(row, c.name));
      if (c.type === "title") return escapeForTable(v || `*Untitled Row (${idHex(row.id)})*`);
      return v ? escapeForTable(v) : "";
    });
    out += "| " + cells.map((c) => `${c} |`).join("") + "\n";
  }
  return out + "\n";
}

/** format_database_inline — note the result ends in the indent with no newline. */
export function formatDatabaseInline(db: PDatabase, rows: PPage[] = db.rows, parentIndent = ""): string {
  if (!rows.length) return `${parentIndent}🗄️ **${db.title}**\n${parentIndent}\n*No data available.*\n\n`;
  const indent = `${parentIndent}  `;
  const formatted = rustLines(tableMarkdown(db, rows)).map((l) => indent + l).join("\n");
  return db.title ? `${parentIndent}🗄️ **${db.title}**\n\n${formatted}` : formatted;
}

/** compose_database_summary: schema, row count and id — no rows (each row is its own file). */
export function composeDatabaseSummary(db: PDatabase): string {
  let out = `# ${db.title}\n\n## Schema\n\n`;
  if (db.schema.length) {
    out += "| Property | Type |\n|----------|------|\n";
    const lines = db.schema.map((s) => `| ${s.name.replace(/\|/g, "\\|")} | ${s.type} |\n`).sort(byteCompare);
    out += lines.join("") + "\n";
  }
  out += "## Data\n\n";
  out += db.rows.length ? `Database contains ${db.rows.length} pages.\n` : "*Database has no rows.*\n";
  out += `## Metadata\n\n- **Database ID**: ${idHex(db.id)}\n`;
  return out;
}

// ── pages ───────────────────────────────────────────────────────────────────

export interface PageRenderOptions {
  includeProperties: boolean | "auto";
}

function propertiesSection(page: PPage, include: boolean | "auto"): string {
  if (include === false) return "";
  const lines = page.properties
    .filter((p) => p.value.type !== "title")
    .map((p) => ({ name: p.name, v: renderPropertyValue(p.value) }))
    .filter((p) => p.v !== "")
    .map((p) => `- **${p.name}**: ${p.v}\n`)
    .sort(byteCompare);
  if (include === "auto" && !lines.length) return "";
  return "## Properties\n\n" + lines.join("") + "\n";
}

/** compose_page_markdown: title, properties, content, metadata. */
export function composePageMarkdown(page: PPage, opts: PageRenderOptions = { includeProperties: true }, env: RenderEnv = {}): string {
  const title = `# ${page.title}\n\n`;
  const props = propertiesSection(page, opts.includeProperties);
  const content = page.blocks.length ? renderBlocks(page.blocks, env) + "\n" : "";
  const meta = `## Metadata\n\n- **Page ID**: ${idHex(page.id)}\n- **URL**: ${page.url}\n`;
  return title + props + content + meta;
}

/** compose_block_markdown */
export function composeBlockMarkdown(block: PBlock, env: RenderEnv = {}): string {
  return `# Block ${idHex(block.id)}\n\n${renderBlocks([block], env)}`;
}

// ── files, paths, source tree, template (direct_template.rs) ─────────────────

/** Cut to at most `max` UTF-8 bytes without splitting a character (notion2prompt
 *  truncates bytes and would panic mid-character on a long Korean title). */
function truncateBytes(s: string, max: number): string {
  if (utf8.encode(s).length <= max) return s;
  let out = "";
  let n = 0;
  for (const ch of s) {
    const w = utf8.encode(ch).length;
    if (n + w > max) break;
    out += ch;
    n += w;
  }
  return out;
}

/** sanitize_filename */
export function sanitizeFilename(name: string): string {
  let s = [...name].map((c) => (/[/\\:*?"<>|]/.test(c) || /\p{Cc}/u.test(c) ? "_" : c)).join("");
  s = s.trim().replace(/^\.+|\.+$/g, "");
  s = truncateBytes(s, 100);
  return s || "unnamed";
}

/** create_clean_filename(title, id, use_short_id = false) */
export function cleanFilename(title: string, id: string): string {
  const safe = sanitizeFilename(title);
  return safe === "unnamed" ? `Untitled Page_${id}.md` : `${safe}_${id}.md`;
}

/** A file tree drawn from paths ("a/b.md"), in the order the files come. */
export function drawTree(rootLabel: string, paths: string[]): string {
  interface Dir {
    name: string;
    kids: (Dir | string)[];
  }
  const root: Dir = { name: rootLabel, kids: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let dir = root;
    for (const seg of parts.slice(0, -1)) {
      let next = dir.kids.find((k): k is Dir => typeof k !== "string" && k.name === seg);
      if (!next) {
        next = { name: seg, kids: [] };
        dir.kids.push(next);
      }
      dir = next;
    }
    dir.kids.push(parts[parts.length - 1]);
  }
  let out = `${rootLabel}\n`;
  const walk = (d: Dir, prefix: string) => {
    d.kids.forEach((k, i) => {
      const last = i === d.kids.length - 1;
      out += `${prefix}${last ? "└── " : "├── "}${typeof k === "string" ? k : `${k.name}/`}\n`;
      if (typeof k !== "string") walk(k, prefix + (last ? "    " : "│   "));
    });
  };
  walk(root, "");
  return out;
}

/** A path segment for a page title: sanitized, and a sibling with the same name gets its id. */
function segmentFor(title: string, id: string, taken: Set<string>): string {
  let s = sanitizeFilename(title);
  if (s === "unnamed") s = "Untitled";
  if (taken.has(s.toLowerCase())) s = `${s} (${idHex(id).slice(0, 8)})`;
  taken.add(s.toLowerCase());
  return s;
}

/** Rough token count for the reply — Latin text runs about 4 characters a token,
 *  Hangul and other scripts closer to one or two. Not a tokenizer. */
export function estimateTokens(s: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4 + other * 0.7);
}

/**
 * Defaults for the ainmem layout. includeProperties there is "auto" — a page gets a
 * `## Properties` section only when it has a property worth printing (a database row,
 * a page with a Status …), and a plain page none. With layout "notion2prompt" the
 * default is upstream's own: false (its CLI's --include-properties is off unless given,
 * and so is the Python library's include_properties), so that layout reproduces
 * upstream's default output byte for byte. An explicit true / false / "auto" wins in
 * either layout.
 */
export const DEFAULT_RENDER: RenderOptions = {
  template: "claude-xml",
  instruction: null,
  includeProperties: "auto",
  separateChildPages: true,
  layout: "ainmem",
};

/** includeProperties when the caller gave none: "auto" for ainmem, upstream's false for notion2prompt. */
export const defaultIncludeProperties = (layout: RenderOptions["layout"]): RenderOptions["includeProperties"] =>
  layout === "notion2prompt" ? false : DEFAULT_RENDER.includeProperties;

/**
 * The instruction as it goes into the template, or null for none.
 *  - layout "notion2prompt": upstream's rule. It hands config.instruction to handlebars
 *    as it is, and `{{#if instructions}}` is true for any non-empty string — so only ""
 *    (or none) drops the <instructions> block; "   " prints it, spaces and all, with the
 *    <final_instruction> after it.
 *  - layout "ainmem" (adapted): a whitespace-only instruction counts as none too. There
 *    it comes from a chat sentence (`instruction: "…"`), a form field or an API/MCP
 *    argument, where blank means "none", and a block of spaces plus a final instruction
 *    telling the model to follow it would only confuse it.
 */
export function instructionOf(instruction: string | null | undefined, layout: RenderOptions["layout"]): string | null {
  if (!instruction) return null;
  if (layout === "notion2prompt") return instruction;
  return instruction.trim() ? instruction : null;
}

/**
 * render_content: the prompt for a fetched content tree. Re-run it with another
 * template, instruction, properties switch or file layout without fetching again.
 */
export function renderPrompt(content: PromptContent, options: Partial<RenderOptions> = {}): RenderedPrompt {
  const opts: RenderOptions = { ...DEFAULT_RENDER, ...options };
  const n2p = opts.layout === "notion2prompt";
  opts.includeProperties = options.includeProperties ?? defaultIncludeProperties(opts.layout);
  const pageOpts: PageRenderOptions = { includeProperties: opts.includeProperties };
  // an inline page / database mention prints a title the fetch stage checked for the
  // readers (content.mentions, or a page / database it read) — else a neutral "Page" /
  // "Database", never the label stored in the chip, whatever built the content tree
  const mentionTitle = (kind: "page" | "database", id: string): string =>
    content.mentions?.[`${kind}:${id}`] ?? (kind === "page" ? content.pages[id]?.title : content.databases[id]?.title) ?? "";
  const files: RenderedFile[] = [];
  const nodeOf = new Map<string, TreeNode>();
  const index = (n: TreeNode) => {
    if (!nodeOf.has(`${n.kind}:${n.id}`)) nodeOf.set(`${n.kind}:${n.id}`, n);
    n.children.forEach(index);
  };
  index(content.tree);

  /** a page's markdown; in merged mode its tree children follow their placeholders */
  const emitted = new Set<string>();
  const pageMarkdown = (page: PPage, node: TreeNode | undefined): string => {
    const kids = new Set((node?.children ?? []).filter((c) => c.kind === "page").map((c) => c.id));
    const env: RenderEnv = { databases: content.databases, mentionTitle };
    if (!opts.separateChildPages)
      env.afterChildPage = (id) => {
        if (!kids.has(id) || emitted.has(id)) return "";
        const child = content.pages[id];
        if (!child) return "";
        emitted.add(id);
        return pageMarkdown(child, node?.children.find((c) => c.kind === "page" && c.id === id));
      };
    return composePageMarkdown(page, pageOpts, env);
  };

  /** separate mode: a page's file, then its child pages' files, depth first */
  const pageFiles = (node: TreeNode, dir: string, taken: Set<string>) => {
    const page = content.pages[node.id];
    if (!page) return;
    const seg = segmentFor(page.title, page.id, taken);
    const path = n2p ? cleanFilename(page.title, idHex(page.id)) : `${dir}${seg}.md`;
    files.push({ path, code: pageMarkdown(page, node) });
    if (!opts.separateChildPages) return;
    const kidTaken = new Set<string>();
    for (const c of node.children) if (c.kind === "page") pageFiles(c, `${dir}${seg}/`, kidTaken);
  };

  const root = content.root;
  if (root.kind === "page") {
    pageFiles(content.tree, "", new Set());
  } else if (root.kind === "database") {
    const db = content.databases[root.id];
    if (db) {
      const taken = new Set<string>();
      const seg = segmentFor(db.title, db.id, taken);
      files.push({ path: n2p ? cleanFilename(db.title, idHex(db.id)) : `${seg}.md`, code: composeDatabaseSummary(db) });
      const rowTaken = new Set<string>();
      for (const row of db.rows) {
        const node = content.tree.children.find((c) => c.kind === "page" && c.id === row.id);
        const page = content.pages[row.id] ?? row;
        if (node) pageFiles(node, `${seg}/`, rowTaken);
        else {
          const rseg = segmentFor(page.title, page.id, rowTaken);
          files.push({ path: n2p ? cleanFilename(page.title, idHex(page.id)) : `${seg}/${rseg}.md`, code: pageMarkdown(page, undefined) });
        }
      }
    }
  } else {
    const env: RenderEnv = { databases: content.databases, mentionTitle };
    const node = content.tree;
    const kids = new Set(node.children.filter((c) => c.kind === "page").map((c) => c.id));
    if (!opts.separateChildPages)
      env.afterChildPage = (id) => {
        if (!kids.has(id) || emitted.has(id)) return "";
        const child = content.pages[id];
        if (!child) return "";
        emitted.add(id);
        return pageMarkdown(child, node.children.find((c) => c.kind === "page" && c.id === id));
      };
    files.push({ path: `block_${idHex(root.block.id)}.md`, code: composeBlockMarkdown(root.block, env) });
    if (opts.separateChildPages) {
      const taken = new Set<string>();
      for (const c of node.children) if (c.kind === "page") pageFiles(c, `block_${idHex(root.block.id)}/`, taken);
    }
  }

  const projectPath = n2p ? "/direct_template" : "/" + content.location.segments.map((s) => s.replace(/\//g, "∕")).join("/");
  const sourceTree = n2p
    ? "direct_template/\n" + files.map((f) => `└── ${f.path}\n`).join("")
    : drawTree(`${content.location.segments[content.location.segments.length - 1]?.replace(/\//g, "∕") ?? ""}/`, files.map((f) => f.path));
  const prompt = renderTemplate(TEMPLATES[opts.template] ?? TEMPLATES["claude-xml"], {
    absolute_content_path: projectPath,
    source_tree: sourceTree,
    files,
    main_content: files[0]?.code ?? "",
    instructions: instructionOf(opts.instruction, opts.layout),
  });
  return { prompt, files, sourceTree, projectPath, chars: [...prompt].length, estimatedTokens: estimateTokens(prompt) };
}
