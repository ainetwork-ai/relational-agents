/**
 * Sanitized inline html ⇄ (text items + formatting marks).
 *
 * The parser accepts exactly what `sanitizeInline` emits and produces text-only
 * items plus a mark per run of each open tag. The renderer walks the items,
 * resolves the marks to a per-character format set, and emits tags in a fixed
 * nesting order — so the html is CANONICAL (same DOM as the input, tag nesting
 * normalised). `render(parse(html))` preserves every character and the SET of
 * tags on it; scripts/text-crdt.check.mts verifies this over every stored block.
 */
import { anchorBefore, formatsAt, resolveFormats } from "./marks";
import type { Anchor, ItemId, Mark, TextItem } from "./types";

const VOID = /^<br\s*\/?>$/i;

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function decodeText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function tagName(openTag: string): string {
  const m = /^<([a-zA-Z][\w-]*)/.exec(openTag);
  return m ? m[1].toLowerCase() : "";
}

/**
 * The canonical format key + carried value for an open tag. Simple styling
 * tags collapse to a one-letter key; anything carrying attributes keeps its
 * whole open tag as the value so it round-trips (a link's href, a mention's
 * data-*), keyed by a stable identity so two identical tags share a mark.
 */
export function tagToMark(openTag: string): { key: string; value?: string } {
  const name = tagName(openTag);
  const bare = /^<[a-zA-Z][\w-]*\s*>$/.test(openTag); // no attributes
  switch (name) {
    case "b":
    case "strong":
      if (bare) return { key: "b" };
      break;
    case "i":
    case "em":
      if (bare) return { key: "i" };
      break;
    case "u":
      if (bare) return { key: "u" };
      break;
    case "s":
    case "del":
    case "strike":
      if (bare) return { key: "s" };
      break;
    case "code":
      if (bare) return { key: "code" };
      break;
  }
  // attribute-bearing or unusual tag: keep it verbatim, keyed by its content
  return { key: `${name}:${openTag}`, value: openTag };
}

/** The open tag to emit for a resolved format. */
function markToTag(key: string, value?: string): string {
  if (value) return value; // verbatim tag kept from the source
  switch (key) {
    case "b": return "<b>";
    case "i": return "<i>";
    case "u": return "<u>";
    case "s": return "<s>";
    case "code": return "<code>";
    default: return `<${key}>`;
  }
}

/**
 * html → { items, marks }. Text items are chained by one client with
 * consecutive seqs from `seq`; each open tag becomes a mark over the run it
 * wraps, anchored `before` its first character and `before` the character that
 * follows the run (so appended text at the run's right edge inherits it).
 * Migration marks get ts 0. Runs merge: one item per stretch of text.
 */
export function parseHtml(html: string, clientId: string, seq = 1): { items: TextItem[]; marks: Mark[] } {
  const items: TextItem[] = [];
  const marks: Mark[] = [];
  // open tags currently in scope, each with the char position where it opened
  const open: { tag: string; from: number }[] = [];
  let origin: ItemId | "start" = "start";
  let nextSeq = seq;
  let pos = 0; // code-unit position across items
  const push = (text: string, br?: string) => {
    const last = items[items.length - 1];
    if (!br && last && !last.br) last.text += text;
    else items.push({ id: [clientId, nextSeq], origin, text, ...(br ? { br } : {}) });
    nextSeq += text.length;
    pos += text.length;
    origin = [clientId, nextSeq - 1];
  };
  const closeTag = (name: string) => {
    for (let i = open.length - 1; i >= 0; i--) {
      if (tagName(open[i].tag) === name) {
        const o = open.splice(i, 1)[0];
        const { key, value } = tagToMark(o.tag);
        marks.push({ key, value, start: anchorAt(items, o.from), end: anchorAt(items, pos), ts: 0, by: clientId });
        return;
      }
    }
  };
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end < 0) { push(decodeText(html.slice(i))); break; }
      const tag = html.slice(i, end + 1);
      i = end + 1;
      if (VOID.test(tag)) push("\n", tag);
      else if (tag.startsWith("</")) closeTag(tagName(tag));
      else open.push({ tag, from: pos });
      continue;
    }
    let j = html.indexOf("<", i);
    if (j < 0) j = html.length;
    for (const ch of decodeText(html.slice(i, j))) push(ch); // per code point → item lengths count characters
    i = j;
  }
  // any still-open tag runs to the end
  for (let k = open.length - 1; k >= 0; k--) {
    const o = open[k];
    const { key, value } = tagToMark(o.tag);
    marks.push({ key, value, start: anchorAt(items, o.from), end: "end", ts: 0, by: clientId });
  }
  return { items, marks: marks.filter((m) => m.start !== undefined) };
}

/** Anchor "before the character at code-unit position pos" for a freshly built
 * item list (used only while parsing, where items grow left-to-right). */
function anchorAt(items: TextItem[], pos: number): Anchor {
  return anchorBefore(items, pos);
}

/** Plain text → items (one run, line breaks as `<br>`) — no marks. */
export function itemsFromText(text: string, clientId: string, seq = 1): { items: TextItem[]; marks: Mark[] } {
  return parseHtml(escapeText(text).replace(/\n/g, "<br>"), clientId, seq);
}

/** Live items + marks → the sanitized inline html the app stores and renders. */
export function renderHtml(items: TextItem[], marks?: Mark[]): string {
  const fmt = resolveFormats(items, marks);
  let out = "";
  let open: string[] = []; // currently emitted open tags (as their tag strings)
  let cu = 0; // code-unit cursor into fmt
  const setOpen = (want: { key: string; value?: string }[]) => {
    const wantTags = want.map((w) => markToTag(w.key, w.value));
    let common = 0;
    while (common < open.length && common < wantTags.length && open[common] === wantTags[common]) common++;
    for (let k = open.length - 1; k >= common; k--) out += `</${tagName(open[k])}>`;
    for (let k = common; k < wantTags.length; k++) out += wantTags[k];
    open = wantTags;
  };
  for (const it of items) {
    if (it.deleted) { cu += it.text.length; continue; }
    if (it.br) { setOpen([]); out += it.br; cu += it.text.length; continue; }
    for (const ch of chunkByFormat(it.text, cu, fmt)) {
      setOpen(ch.formats);
      out += escapeText(ch.text);
    }
    cu += it.text.length;
  }
  setOpen([]);
  return out;
}

/** Split a run's text where its per-character format set changes. */
function chunkByFormat(text: string, startCu: number, fmt: ReturnType<typeof resolveFormats>) {
  const chunks: { text: string; formats: { key: string; value?: string }[]; sig: string }[] = [];
  let cu = startCu;
  // iterate by code UNIT so cu stays aligned with fmt positions
  for (let idx = 0; idx < text.length; idx++) {
    const formats = fmt[cu] ? formatsAt(fmt[cu]) : [];
    const sig = formats.map((f) => f.key + (f.value ?? "")).join("|");
    const last = chunks[chunks.length - 1];
    if (last && last.sig === sig) last.text += text[idx];
    else chunks.push({ text: text[idx], formats, sig });
    cu++;
  }
  return chunks;
}

/** Live items → plain text (a line break is "\n"), the `content.text` cache. */
export function renderText(items: TextItem[]): string {
  let out = "";
  for (const it of items) if (!it.deleted) out += it.text;
  return out;
}
