/**
 * Sanitized inline html ⇄ text items.
 *
 * The parser accepts exactly what `sanitizeInline` emits (well-formed, a
 * closed set of tags) and the renderer reproduces it byte for byte: tags are
 * kept as the raw open-tag strings, line breaks keep their own spelling
 * (`<br>` vs `<br />` both occur in stored data), and text is escaped the way
 * sanitize-html escapes it. `render(parse(html)) === html` is checked over
 * every stored block by scripts/text-crdt.check.mts.
 */
import type { ItemId, TextItem } from "./types";

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
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function tagName(openTag: string): string {
  const m = /^<([a-zA-Z][\w-]*)/.exec(openTag);
  return m ? m[1].toLowerCase() : "";
}

/**
 * html → items, all by one client with consecutive seqs starting at `seq`,
 * each chained to the previous one (the migration shape Notion also shows:
 * `prevItems[0] = { originId: "start", id: [c, 1], length: n }`).
 * Runs are already merged: one item per stretch of identical tag stack.
 */
export function itemsFromHtml(html: string, clientId: string, seq = 1): TextItem[] {
  const items: TextItem[] = [];
  const stack: string[] = [];
  let origin: ItemId | "start" = "start";
  let nextSeq = seq;
  const push = (text: string, br?: string) => {
    const last = items[items.length - 1];
    if (!br && last && !last.br && sameTags(last.tags, stack)) {
      last.text += text;
    } else {
      const id: ItemId = [clientId, nextSeq];
      items.push({ id, origin, text, tags: [...stack], ...(br ? { br } : {}) });
    }
    nextSeq += text.length;
    origin = [clientId, nextSeq - 1];
  };
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end < 0) {
        push(decodeText(html.slice(i)));
        break;
      }
      const tag = html.slice(i, end + 1);
      i = end + 1;
      if (VOID.test(tag)) push("\n", tag);
      else if (tag.startsWith("</")) stack.pop();
      else stack.push(tag);
      continue;
    }
    let j = html.indexOf("<", i);
    if (j < 0) j = html.length;
    // decode entity by entity so that item lengths count CHARACTERS
    for (const ch of decodeText(html.slice(i, j))) push(ch);
    i = j;
  }
  return items;
}

/** Plain text → items (one run, line breaks as `<br>`) — for content that has no html. */
export function itemsFromText(text: string, clientId: string, seq = 1): TextItem[] {
  return itemsFromHtml(escapeText(text).replace(/\n/g, "<br>"), clientId, seq);
}

/** Live items → the sanitized inline html the app stores and renders. */
export function renderHtml(items: TextItem[]): string {
  let out = "";
  let open: string[] = [];
  for (const it of items) {
    if (it.deleted) continue;
    let common = 0;
    while (common < open.length && common < it.tags.length && open[common] === it.tags[common]) common++;
    for (let k = open.length - 1; k >= common; k--) out += `</${tagName(open[k])}>`;
    for (let k = common; k < it.tags.length; k++) out += it.tags[k];
    open = it.tags;
    out += it.br ? it.br : escapeText(it.text);
  }
  for (let k = open.length - 1; k >= 0; k--) out += `</${tagName(open[k])}>`;
  return out;
}

/** Live items → plain text (a line break is "\n"), the `content.text` cache. */
export function renderText(items: TextItem[]): string {
  let out = "";
  for (const it of items) if (!it.deleted) out += it.text;
  return out;
}

export function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
