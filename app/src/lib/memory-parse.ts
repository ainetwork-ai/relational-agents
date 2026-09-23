import type { BlockType, BlockContent, PropertyType, SelectOption } from "@/lib/db/schema";
import { firstGlyphs, isEmojiGlyph } from "@/lib/glyph";

// ===========================================================================
// OKF (Open Knowledge Format): the md/csv files ARE the content DB. These are
// pure, dependency-free parsers + serializers used by the file-backed store.
// ===========================================================================

export interface ParsedBlock {
  id: string;
  type: BlockType;
  content: BlockContent;
  position: number;
  /** nesting level from the markdown's indentation (0 = top level).
   * The original nests one level per "indent ≥ the parent marker's width"
   * — measured 2026-09-10, docs/notion-indent.md §6(2). */
  depth?: number;
}

/** columns of leading whitespace; a tab counts as 4 (the original took `\t- x`
 * as one level under `- y`, whose content starts at column 2) */
function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

/** plain text → html, for folding a continuation line into the block above */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** drop up to `cols` columns of leading whitespace — a nested code fence is
 * written indented, and without this its own body grew 4 spaces per round trip */
function dedent(line: string, cols: number): string {
  let n = 0;
  let i = 0;
  while (i < line.length && n < cols) {
    if (line[i] === " ") n += 1;
    else if (line[i] === "\t") n += 4;
    else break;
    i += 1;
  }
  return line.slice(i);
}

/** where a list item's own content starts: `- ` → 2, `1. ` → 3, `- [ ] ` → 2
 * (measured: two spaces nest a checkbox, three are needed for `1. `) */
function markerWidth(t: string): number {
  const num = t.match(/^\d+\.\s/);
  return num ? num[0].length : 2;
}

/** parent id per block from its depth — the one place paste, AI insert and MCP
 * all read, so a nested markdown lands as the same tree in each. */
export function parentIdsByDepth(depths: number[], ids: string[]): (string | null)[] {
  const lastAt: string[] = [];
  return depths.map((dRaw, i) => {
    const d = Math.max(0, Math.min(dRaw, lastAt.length));
    lastAt.length = d;
    const parent = d === 0 ? null : lastAt[d - 1] ?? null;
    lastAt[d] = ids[i];
    return parent;
  });
}

const HASH_RE = /\s+[0-9a-f]{32}(?=\.|$|\/)/i;
export function cleanTitle(name: string): string {
  return name.replace(/\.(md|csv)$/i, "").replace(HASH_RE, "").trim() || "Untitled";
}
function stripLinks(s: string): string {
 // Links the app can follow survive to become anchors via mdInlineToHtml:
 // absolute app routes (`/p/{id}`), external URLs, `mailto:`/`tel:` and
 // in-page anchors (`#…`). Only workspace-export-internal relative links (raw
 // `.md` paths, which resolve to nothing once the file is gone) collapse to
 // their label — a mailto used to lose its address that way.
  return s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) =>
    /^(\/|#|https?:\/\/|mailto:|tel:)/i.test(href) ? m : label
  );
}

/** A paragraph whose text happens to start like a marker (`- x`, `# y`, `---`,
 * `1. z`, `| a |`) would come back as a bullet, a heading, a rule, a numbered
 * item or a table. CommonMark's answer is a backslash, so that is what we
 * write, and `unescapeMarker` takes it off again on the way in.
 *
 * Only what the reader ACTUALLY treats as a block marker is escaped: `**bold**`
 * and `*i*` are inline markdown (the mirror writes those), so the leading `*`
 * must survive — a bullet needs whitespace after its marker. */
const BLOCK_MARKER =
  /^(\s*)(\\|[-*]{3,}$|[-*+](?=\s|$)|\d+\.(?=\s|$)|#{1,6}(?=\s)|>(?=\s)|`{3}|\$\$$|!(?=\[)|\|(?=.*\|\s*$))/;
export function escapeMarker(line: string): string {
  return line.replace(BLOCK_MARKER, (_m, sp: string, tok: string) => `${sp}\\${tok}`);
}
function unescapeMarker(line: string): string {
  return line.replace(/^(\s*)\\([-*+>|#\\`$!]|\d)/, "$1$2");
}

/** Split one table row into cells, honouring `\|` inside a cell. Splitting on
 * a bare `|` used to cut a cell that contained an escaped pipe in half. */
function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i += 1; continue; }
    if (t[i] === "|") { cells.push(cur); cur = ""; continue; }
    cur += t[i];
  }
  cells.push(cur);
 // a cell's own line breaks travel as <br> — a raw newline would end the row
  return cells.map((c) => c.trim().replace(/<br\s*\/?>/gi, "\n"));
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
export function mdInlinePlain(text: string): string {
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
 // Pasting is not a file read: a clipboard that starts with `---` is a divider
 // or a table, not frontmatter. Parsing it swallowed everything up to the next
 // `---` (opts.noTitle marks the paste/insert callers).
  const { meta, body } = opts.noTitle ? { meta: {} as Frontmatter, body: text.replace(/\r/g, "") } : splitFrontmatter(text);
  const lines = body.split("\n");
  let title = typeof meta.title === "string" ? meta.title : "";
  const drafts: { type: BlockType; content: BlockContent; depth: number; cont?: boolean }[] = [];
  let i = 0;
 // pasting markdown into a block keeps the first "# " line as a heading block
 // rather than consuming it as a page title (opts.noTitle).
  if (!opts.noTitle && lines[0]?.startsWith("# ")) {
    title = lines[0].slice(2).trim();
    i = 1;
  }
 // A code block's and an equation's text is verbatim — running the inline
 // markdown pass over it turned the backticks in a fenced body into <code>
 // and rewrote the source the user typed.
  const VERBATIM = new Set<BlockType>(["code", "equation"]);
  const push = (type: BlockType, content: BlockContent) => {
 // inline markdown (bold/italic/code/strike/links) becomes rich html; the
 // plain text mirror drops the markers (links keep their label via strip)
    if (!VERBATIM.has(type) && typeof content.text === "string" && content.text) {
      const html = mdInlineToHtml(content.text);
      if (html) {
        content = { ...content, html, text: mdInlinePlain(content.text) };
      }
    }
    drafts.push({ type, content, depth, cont: contLine });
    contLine = false;
  };

 // Open list items and the column their content starts at. The original nests
 // a line under the previous item when its indentation reaches that column
 // (`  - x` under `- y`, `   1. x` under `1. y`), and a NON-list line that deep
 // becomes that item's child block (its own markdown export relies on this).
 // Blank lines do not close the list. Measured 2026-09-10 (M2c/M2d).
  const openList: number[] = [];
  let depth = 0;
 // The original folds a run of plain lines with no blank line between them into
 // ONE block with line breaks (measured: `para-A / 4sp para-B / 8sp para-C`
 // arrived as one text block, M2d_indented_paragraphs), and a plain line right
 // under a LIST ITEM folds into that item — `1. num-B / para-A / para-B` came
 // back as one numbered item whose text has two line breaks (M2c). That is
 // CommonMark's lazy continuation. Our own writer puts a blank line after every
 // non-list block, so nothing of ours merges by accident.
  let contLine = false;
  let prevPlain: { depth: number } | null = null;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === "") { prevPlain = null; i++; continue; }
    {
      const ind = indentOf(line);
 // `- ` 뒤에 내용이 없는 빈 항목도 리스트다 — writer 가 빈 글머리를 그렇게 쓴다
      const isList = /^([-*](\s|$)|\d+\.(\s|$))/.test(t);
      while (openList.length && ind < openList[openList.length - 1]) openList.pop();
      if (isList) {
        depth = openList.length;
        openList.push(ind + markerWidth(t));
      } else if (openList.length && ind >= openList[openList.length - 1]) {
        depth = openList.length;
      } else {
        openList.length = 0;
        depth = 0;
      }
 // A leaf block (heading, rule, fence, quote, table) ends the paragraph above
 // it, so nothing can fold into it. A LIST ITEM does not — a plain line under
 // one continues it (M2c), so `prevPlain` is set after the item is pushed.
      if (/^(#{1,3}\s|---$|\*\*\*$|```|\$\$|>\s|\|)/.test(t)) prevPlain = null;
    }

 // With no list open, a line indented four columns or more is an indented CODE
 // block, not a nested paragraph — that is what the original does with it
 // (M5 2026-09-10: `AAA⏎⏎    BBB` came back as a paragraph and a code block).
 // It cannot interrupt a paragraph: `para-A⏎    para-B` with no blank line
 // between them is one block with a line break (M2d), hence the `!prevPlain`.
    if (!openList.length && !prevPlain && indentOf(line) >= 4) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) >= 4)) buf.push(dedent(lines[i++], 4));
      while (buf.length && buf[buf.length - 1].trim() === "") buf.pop();
      push("code", { text: buf.join("\n"), language: "plain" });
      prevPlain = null;
      continue;
    }

    if (t === "$$") {
      const buf: string[] = [];
      const own = indentOf(line);
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") buf.push(dedent(lines[i++], own));
      i++;
      push("equation", { text: buf.join("\n") });
      continue;
    }
    if (t.startsWith("```")) {
 // The fence is as long as the writer made it. A body containing ``` used to
 // close the block early and everything after it was thrown away, so the
 // writer now opens with one backtick more than the longest run inside and we
 // only close on a run at least that long.
      const open = t.match(/^`+/)![0].length;
      const lang = t.slice(open).trim() || "plain";
      const closeRe = new RegExp("^`{" + open + ",}\\s*$");
      const buf: string[] = [];
      const own = indentOf(line);
      i++;
      while (i < lines.length && !closeRe.test(lines[i].trim())) buf.push(dedent(lines[i++], own));
      i++;
      push("code", { text: buf.join("\n"), language: lang });
      continue;
    }
 // A table row needs a cell between two pipes. A paragraph that is just `|`
 // (or `|pipe|`-looking text) used to be eaten here and vanish from the file.
    if (t.startsWith("|") && t.endsWith("|") && t.length > 1 && (t.match(/(?<!\\)\|/g) ?? []).length >= 2) {
      const rows: string[][] = [];
 // the separator row carries per-column alignment (|:---:| / |---:|)
      let colAlign: string[] | null = null;
      const dashes = (c: string) => /^:?-{2,}:?$/.test(c);
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = splitRow(lines[i]).map((c) => stripLinks(c));
 // a row of only dashes is the separator; a row of only EMPTY cells is data
 // (it used to match this test and be dropped)
        if (cells.some(dashes) && cells.every((c) => dashes(c) || c === "")) {
          colAlign = cells.map((c) =>
            c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "default"
          );
        } else rows.push(cells);
        i++;
      }
      if (rows.length) {
        const align = colAlign?.some((a) => a !== "default")
          ? rows.map((row) => row.map((_, c) => colAlign![c] ?? "default"))
          : undefined;
        push("table", { table: { cells: rows, headerRow: true, ...(align ? { align } : {}) } });
      }
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
    if (/^-\s?\[[ x]\]/i.test(t)) {
      push("todo", { text: stripLinks(t.replace(/^-\s?\[[ x]\]\s*/i, "")), checked: /\[x\]/i.test(t) });
      prevPlain = { depth };
      i++; continue;
    }
 // an EMPTY item (`- `, which trims to `-`) is still a list item — the writer
 // emits exactly that for a bullet the user has not typed into yet
    if (/^[-*](\s|$)/.test(t)) { push("bulleted_list", { text: stripLinks(t.replace(/^[-*]\s?/, "")) }); prevPlain = { depth }; i++; continue; }
    if (/^\d+\.(\s|$)/.test(t)) { push("numbered_list", { text: stripLinks(t.replace(/^\d+\.\s?/, "")) }); prevPlain = { depth }; i++; continue; }
    if (t.startsWith("> ")) {
      // `> 💡 text` is the serialized form of a callout — an emoji right after
      // the marker brings it back as one (plain `> text` stays a quote).
      // Matched a grapheme at a time: a pictographic-plus-ZWJ pattern used to
      // drop 🧑‍💻, 👋🏽 and 🇰🇷 callouts back to quotes on every round trip.
      const rest = t.slice(2);
      const icon = firstGlyphs(rest, 1);
      const after = rest.slice(icon.length);
      if (isEmojiGlyph(icon) && /^\s/.test(after)) {
        push("callout", { icon, text: stripLinks(after.replace(/^\s+/, "")) });
      } else push("quote", { text: stripLinks(rest) });
      i++; continue;
    }
    // a line of nothing but 2+ images is an image ROW — same-place shots that
    // render side by side. It expands to the editor's column layout via depth
    // (column_list → column → image), which parentIdsByDepth turns into a tree.
    const rowImgs = [...t.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
    if (rowImgs.length >= 2 && !t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, "").trim()) {
      const rowDepth = depth;
      push("column_list", {});
      for (const m of rowImgs) {
        depth = rowDepth + 1;
        push("column", {});
        depth = rowDepth + 2;
        push("image", { url: m[2], text: "", ...(m[1] ? { caption: m[1] } : {}) });
      }
      depth = rowDepth;
      i++; continue;
    }
    const img = t.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (img) { push("image", { url: img[2], text: "", ...(img[1] ? { caption: img[1] } : {}) }); i++; continue; }
 // No blank line since the block above → this is its continuation, whatever
 // column it sits at. `1. num-B / para-A` puts para-A INSIDE the item even
 // though the line starts at column 0 (M2c), so the depths do not have to match.
    contLine = !!prevPlain;
    push("paragraph", { text: stripLinks(unescapeMarker(t)) });
    prevPlain = { depth };
    i++;
  }
 // What a plain line can fold into: a paragraph, or a list item (CommonMark's
 // lazy continuation, measured as M2c). A heading/quote/fence/table already
 // cleared `prevPlain`, so nothing reaches them here.
  const FOLDS_INTO = new Set(["paragraph", "bulleted_list", "numbered_list", "todo", "toggle"]);
  const folded: typeof drafts = [];
  for (const d of drafts) {
    const prev = folded[folded.length - 1];
    if (d.cont && prev && FOLDS_INTO.has(prev.type) && d.type === "paragraph") {
      prev.content = {
        ...prev.content,
        text: `${prev.content.text ?? ""}\n${d.content.text ?? ""}`,
        ...(prev.content.html || d.content.html
          ? { html: `${prev.content.html ?? escapeHtmlText(prev.content.text ?? "")}<br>${d.content.html ?? escapeHtmlText(d.content.text ?? "")}` }
          : {}),
      };
      continue;
    }
    folded.push(d);
  }
  const blocks = folded.map((d, idx) => ({ id: `${idPrefix}${idx}`, type: d.type, content: d.content, position: idx + 1, depth: d.depth }));
  return { title: title || "Untitled", meta, blocks };
}

// ---- blocks → Markdown (write-back) ---------------------------------------
export function blocksToMarkdown(title: string, blocks: ParsedBlock[]): string {
  const out: string[] = [`# ${title}`, ""];
 // Where the blank lines go, byte for byte as the original writes them
 // (scratchpad/nind-M3-clipboard.json): NONE between two list items, and one
 // around a block that is not a list item, indented to the deeper of the two it
 // separates. The blank line matters for reading too — without it a child
 // paragraph would be read as a continuation of the item above it.
  const listish = (t: string) => t === "bulleted_list" || t === "numbered_list" || t === "todo" || t === "toggle";
  let prev: { type: string; pad: string } | null = null;
 // Children are written with FOUR spaces per level and the numbering restarts
 // inside each level — that is exactly what the original writes, and pasting it
 // back rebuilds the same tree (measured 2026-09-10: M3 out, M2d round-trip).
 // A block with no depth behaves as before.
  const numAt = new Map<number, number>();
  let prevDepth = -1;
 // One level is 4 spaces (what the original writes) — but ONLY under a list
 // item. Measured 2026-09-10 (M6): the original exports a paragraph's child
 // paragraph FLAT (`PA\n\nPB`), and it reads an indented line that follows a
 // blank line as an indented CODE block (M5). So indenting under a non-list
 // parent would not preserve the nesting, it would turn the child into code.
 // A marker wider than four (`100. `) gets its own width so it can be read back.
  const stepAt: number[] = [];
 // An image-only column layout collapses back to ONE md line of ![](…) tokens —
 // the round-trip form of side-by-side photos (one moment, several shots).
 // A mixed column layout just unwraps: wrappers vanish, children flow flat.
  const rowImage = (k: ParsedBlock) =>
    `![${String(k.content.caption ?? "").replace(/[\[\]]/g, "")}](${k.content.url})`;
  const seq: ParsedBlock[] = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.type === "column") continue;
    if (b.type !== "column_list") { seq.push(b); continue; }
    const d0 = Math.max(0, b.depth ?? 0);
    let j = bi + 1;
    const sub: ParsedBlock[] = [];
    while (j < blocks.length && Math.max(0, blocks[j].depth ?? 0) > d0) sub.push(blocks[j++]);
    const imgs = sub.filter((k) => k.type === "image" && k.content.url);
    if (imgs.length && sub.every((k) => k.type === "column" || (k.type === "image" && k.content.url))) {
      seq.push({ ...b, type: "image", content: { rowMd: imgs.map(rowImage).join(" ") } });
      bi = j - 1;
    }
  }
  for (const b of seq) {
    const depth = Math.max(0, b.depth ?? 0);
    const pad = stepAt.slice(0, depth).reduce((a, n) => a + " ".repeat(n), "");
    const text = b.content.text ?? "";
    if (depth < prevDepth) for (const k of [...numAt.keys()]) if (k > depth) numAt.delete(k);
    if (b.type === "numbered_list") numAt.set(depth, (numAt.get(depth) ?? 0) + 1);
    else numAt.delete(depth);
    prevDepth = depth;
    const num = numAt.get(depth) ?? 1;
    stepAt.length = depth;
    stepAt[depth] =
      b.type === "numbered_list" ? Math.max(4, `${num}. `.length)
      : listish(b.type) ? 4
      : 0;
 // a soft line break inside a block would otherwise land at column 0 and close
 // the list context, flattening everything nested after it
    if (prev && !(listish(prev.type) && listish(b.type))) out.push(prev.pad.length >= pad.length ? prev.pad : pad);
    prev = { type: b.type, pad };
 // A soft line break inside a list item has to land on the item's CONTENT
 // column. At the marker column the reader sees the item close, so everything
 // nested after it flattened; at column 0 it closed the whole list.
    const contPad =
      pad +
      " ".repeat(
        b.type === "numbered_list" ? `${num}. `.length
        : b.type === "todo" ? 7
        : listish(b.type) ? 2
        : 0
      );
 // `line` is for blocks whose text is the user's prose: its continuation lines
 // are indented and escaped, so a line that starts like a marker comes back as
 // text. `raw` is for the ones whose bytes are the content (code, equations,
 // table rows, links) — escaping those would corrupt them.
    const line = (v: string) => {
      const parts = String(v).split("\n");
      out.push(pad + parts[0]);
      for (const l of parts.slice(1)) out.push(contPad + escapeMarker(l));
    };
    const raw = (v: string) => { for (const l of String(v).split("\n")) out.push(pad + l); };
    switch (b.type) {
      case "heading1": line(`# ${text}`); break;
      case "heading2": line(`## ${text}`); break;
      case "heading3": line(`### ${text}`); break;
      case "bulleted_list": line(`- ${text}`); break;
      case "numbered_list": line(`${num}. ${text}`); break;
 // two spaces after the box is what the original writes (`- [ ]  t1`)
      case "todo": line(`- [${b.content.checked ? "x" : " "}]  ${text}`); break;
      case "quote": line(`> ${text}`); break;
      case "callout": line(`> ${b.content.icon || "💡"} ${text}`); break;
 // the original writes a toggle as a plain bullet; its children follow indented
      case "toggle": line(`- ${text}`); break;
      case "divider": raw("---"); break;
      case "toc": break; // outline is derived, not content
      case "link_to_page": if (b.content.childPageId) raw(`[page](/p/${b.content.childPageId})`); break;
      case "file": if (b.content.url) raw(`[${b.content.text || "file"}](${b.content.url})`); break;
      case "template_button": break; // interactive-only, no md form
      case "ai_prompt": break; // transient prompt UI, never persists content
      case "equation": if (b.content.text) { raw("$$"); for (const l of b.content.text.split("\n")) raw(l); raw("$$"); } break;
      case "code": {
 // a body containing ``` closed the block early and truncated the rest — open
 // with one backtick more than the longest run inside it
        const runs = (text.match(/`+/g) ?? []).map((m) => m.length + 1);
        const fence = "`".repeat(Math.max(3, ...runs, 3));
        raw(fence + (b.content.language ?? ""));
        for (const l of text.split("\n")) raw(l);
        raw(fence);
        break;
      }
      case "image":
 // rowMd carries a collapsed image ROW (several side-by-side photos on one line)
        if (typeof b.content.rowMd === "string") raw(b.content.rowMd);
        else if (b.content.url) raw(`![${String(b.content.caption ?? "").replace(/[\[\]]/g, "")}](${b.content.url})`);
        break;
      case "table": {
        const t = b.content.table;
        if (t?.cells?.length) {
          const w = Math.max(...t.cells.map((r) => r.length));
 // a raw newline in a cell would end the row and eat the rest of the table
          const padCells = (r: string[]) =>
            Array.from({ length: w }, (_, i) => (r[i] ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>"));
          raw(`| ${padCells(t.cells[0]).join(" | ")} |`);
 // markdown expresses alignment per column, so the first row's decides — the
 // .md route used to write a bare `---` and every centred column came back
 // left-aligned
          const alignRow = (t as { align?: string[][] }).align?.[0] ?? [];
          const bar = Array.from({ length: w }, (_, i) =>
            alignRow[i] === "center" ? ":---:" : alignRow[i] === "right" ? "---:" : "---"
          );
          raw(`| ${bar.join(" | ")} |`);
          for (let i = 1; i < t.cells.length; i++) raw(`| ${padCells(t.cells[i]).join(" | ")} |`);
        }
        break;
      }
      default: line(escapeMarker(text));
    }
  }
  out.push("");
  return out.join("\n");
}

/** Blocks in document order (a parent, then its subtree) with the depth each
 * one sits at. `position` alone is not an order: it only counts inside one
 * sibling list, so a flat sort interleaves children with top-level blocks. */
export function treeOrder<T extends { id: string; parentBlockId?: string | null; position?: number | null }>(
  rows: T[]
): { row: T; depth: number }[] {
  const kids = new Map<string | null, T[]>();
  for (const r of rows) {
    const k = r.parentBlockId ?? null;
    (kids.get(k) ?? kids.set(k, []).get(k)!).push(r);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const out: { row: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const r of kids.get(parent) ?? []) {
      if (seen.has(r.id)) continue; // a cycle would otherwise hang the export
      seen.add(r.id);
      out.push({ row: r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
 // A block whose parent is gone (or in a cycle) still belongs in the file. Walk
 // each such subtree from its own root so its children keep their shape instead
 // of being appended one by one at depth 0.
  for (const r of [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ row: r, depth: 0 });
    walk(r.id, 1);
  }
  return out;
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
