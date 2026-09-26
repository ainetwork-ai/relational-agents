import type { Annotations, Mention, RichText } from "./model";

/**
 * Rich text, both ways:
 *  - richTextToMarkdown: notion2prompt's rich_text_to_markdown (src/formatting/rich_text),
 *    rule for rule — styling order code → strike → bold → italic → underline → link,
 *    colour ignored, mentions and inline equations as it writes them.
 *  - htmlToRichText: ainmem's stored inline HTML (content.html — b/i/u/s/code/a/br and
 *    the mention / equation / colour spans of lib/rich-text.ts) → Notion-shaped segments.
 *
 * Pure: no server imports, so scripts/prompt-export.check.mts can load it.
 */

// ── URLs ──────────────────────────────────────────────────────────────────────

type UrlType = "notion" | "https" | "http" | "mailto" | "internal";

/** notion2prompt's determine_url_type: what counts as a link it keeps. */
export function urlType(url: string): UrlType | null {
  if (!url) return null;
  if (url.startsWith("https://")) return url.includes("notion.so/") || url.includes("notion.site/") ? "notion" : "https";
  if (url.startsWith("http://")) return "http";
  if (url.startsWith("mailto:")) return "mailto";
  if (url.startsWith("/") || url.startsWith("#")) return "internal";
  if (url.startsWith("notion://")) return "notion";
  return null;
}

/** 32 hex → 8-4-4-4-12. Anything else comes back as it was. */
export function hyphenate(id: string): string {
  const h = id.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(h) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : id;
}

/** The id as notion2prompt prints it: a uuid as 32 lowercase hex. An OKF id (base64url
 *  of a path, which may itself contain "-") is printed as it is. */
export function idHex(id: string): string {
  return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(id) ? id.replace(/-/g, "").toLowerCase() : id;
}

const NOTION_ID_IN_URL = /(?:[/-])([a-fA-F0-9]{32}|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})(?:[/?#]|$)/;

/** notion2prompt's is_database_reference + extract_notion_id: a Notion link whose text says
 *  "database" / "db" / "table" / "key highlights" is written as a database mention. */
function databaseReference(text: string, url: string): string | null {
  if (urlType(url) !== "notion") return null;
  const lower = text.toLowerCase();
  if (!["database", "db", "table", "key highlights"].some((w) => lower.includes(w))) return null;
  const m = url.match(NOTION_ID_IN_URL);
  return m ? m[1].replace(/-/g, "").toLowerCase() : null;
}

// ── rendering (notion2prompt parity) ──────────────────────────────────────────

/** MarkdownStyleRenderer::apply_styles */
export function applyStyles(content: string, a: Annotations | undefined, link?: string | null): string {
  let r = content;
  if (a?.code) r = `\`${r}\``;
  if (a?.strikethrough) r = `~~${r}~~`;
  if (a?.bold) r = `**${r}**`;
  if (a?.italic) r = `*${r}*`;
  if (a?.underline) r = `<u>${r}</u>`;
  if (link) r = `[${r}](${link})`;
  return r;
}

const isMarkdownLink = (s: string) => s.startsWith("[") && s.includes("](") && s.endsWith(")");
const notionUrl = (id: string) => `https://www.notion.so/${hyphenate(id)}`;

type Seg =
  | { kind: "plain"; text: string; a?: Annotations; link?: string | null }
  | { kind: "equation"; expression: string }
  | { kind: "mention"; base: MentionOut; a?: Annotations };

type MentionOut =
  | { k: "user"; name: string }
  | { k: "page"; title: string; url: string }
  | { k: "database"; title: string; url: string }
  | { k: "date"; start: string; end?: string | null }
  | { k: "link"; text: string; url: string };

const dateOnly = (s: string) => (s.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? s);

function linkMention(url: string, plain: string): MentionOut {
  return urlType(url) ? { k: "link", text: plain, url } : { k: "link", text: `${plain} (invalid URL: ${url})`, url: "about:blank" };
}

function mentionOut(m: Mention, plain: string): MentionOut {
  switch (m.type) {
    case "user":
      return { k: "user", name: m.name || m.id };
    case "page":
      return { k: "page", title: plain || "Page", url: m.url ?? notionUrl(m.id) };
    case "database":
      return { k: "database", title: plain || "Database", url: m.url ?? notionUrl(m.id) };
    case "date":
      return { k: "date", start: dateOnly(m.start), end: m.end ? dateOnly(m.end) : null };
    case "link_preview":
    case "link_mention":
      return linkMention(m.url, plain);
    default:
      return linkMention(m.url || "https://notion.so", plain);
  }
}

function toSegment(item: RichText): Seg | null {
  const a = item.annotations;
  const hrefLink = item.href && urlType(item.href) ? item.href : null;
  if (item.type === "equation") return { kind: "equation", expression: item.expression };
  if (item.type === "mention") {
    const out = mentionOut(item.mention, item.plainText);
    if (out.k === "link") {
      const id = databaseReference(out.text, out.url);
      if (id) return { kind: "mention", base: { k: "database", title: out.text, url: notionUrl(id) }, a };
    }
    return { kind: "mention", base: out, a };
  }
  let link = hrefLink;
  if (item.link && urlType(item.link)) {
    const id = databaseReference(item.content, item.link);
    if (id) return { kind: "mention", base: { k: "database", title: item.content, url: notionUrl(id) }, a };
    link = item.link;
  }
  return { kind: "plain", text: item.content, a, link };
}

function segmentEmpty(s: Seg): boolean {
  if (s.kind === "plain") return s.text === "";
  if (s.kind === "equation") return s.expression === "";
  return false;
}

function renderMention(m: MentionOut, a: Annotations | undefined): string {
  let base: string;
  switch (m.k) {
    case "user":
      base = `@${m.name}`;
      break;
    case "page":
      base = `[${m.title}](${m.url})`;
      break;
    case "database":
      base = `📊 **Child Database:** [${m.title}](${m.url})`;
      break;
    case "date":
      base = m.end ? `**${m.start} → ${m.end}**` : `**${m.start}**`;
      break;
    case "link":
      // a link mention is never styled
      return isMarkdownLink(m.text) ? m.text : `[${m.text}](${m.url})`;
  }
  return applyStyles(base, a, null);
}

/** notion2prompt's rich_text_to_markdown. */
export function richTextToMarkdown(items: RichText[] | undefined): string {
  let out = "";
  for (const item of items ?? []) {
    const seg = toSegment(item);
    if (!seg || segmentEmpty(seg)) continue;
    if (seg.kind === "plain") out += applyStyles(seg.text, seg.a, seg.link);
    else if (seg.kind === "equation") out += `$${seg.expression}$`;
    else out += renderMention(seg.base, seg.a);
  }
  return out;
}

/** Concatenated plain text (a code block's body, a title). */
export function richTextPlain(items: RichText[] | undefined): string {
  return (items ?? [])
    .map((i) => (i.type === "text" ? (i.plainText ?? i.content) : i.type === "equation" ? (i.plainText ?? i.expression) : i.plainText))
    .join("");
}

export const text = (content: string, annotations?: Annotations, href?: string | null): RichText =>
  annotations || href ? { type: "text", content, annotations, href: href ?? null } : { type: "text", content };

// ── ainmem inline HTML → segments ─────────────────────────────────────────────

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return ENTITY[k] ?? m;
  });
}

function attrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

interface Frame {
  tag: string;
  ann?: Partial<Annotations>;
  link?: string;
  /** a mention chip or an equation chip: its inner text is collected, not emitted */
  chip?: { mention?: Mention; tex?: string; text: string };
}

export interface HtmlOptions {
  /** where a page opens — `${origin}/p/${id}` in ainmem */
  pageUrl?: (id: string) => string;
}

const sameStyle = (x: RichText, y: RichText) =>
  x.type === "text" &&
  y.type === "text" &&
  (x.link ?? null) === (y.link ?? null) &&
  (x.href ?? null) === (y.href ?? null) &&
  JSON.stringify(x.annotations ?? {}) === JSON.stringify(y.annotations ?? {});

/**
 * ainmem's sanitized inline HTML → Notion-shaped rich text. Tags nest; each run of
 * text becomes one segment carrying the styles of the tags around it. A mention chip
 * (`<a class="mention" data-mention-type="page">`, `<span class="mention" …>`) becomes a
 * mention, an equation chip (`<span class="eq" data-tex>`) an inline equation, and a
 * colour span a colour the renderer then ignores, as notion2prompt does.
 */
export function htmlToRichText(html: string, opts: HtmlOptions = {}): RichText[] {
  const out: RichText[] = [];
  const stack: Frame[] = [];
  const current = (): { a: Annotations; link?: string } => {
    const a: Annotations = {};
    let link: string | undefined;
    for (const f of stack) {
      if (f.ann) Object.assign(a, f.ann);
      if (f.link) link = f.link;
    }
    return { a, link };
  };
  const chip = () => [...stack].reverse().find((f) => f.chip)?.chip;
  const push = (seg: RichText) => {
    const prev = out[out.length - 1];
    if (prev && seg.type === "text" && prev.type === "text" && sameStyle(prev, seg)) {
      prev.content += seg.content;
      return;
    }
    out.push(seg);
  };
  const emitText = (s: string) => {
    if (!s) return;
    const c = chip();
    if (c) {
      c.text += s;
      return;
    }
    const { a, link } = current();
    const clean = Object.fromEntries(Object.entries(a).filter(([, v]) => v)) as Annotations;
    const seg: RichText = { type: "text", content: s };
    if (Object.keys(clean).length) seg.annotations = clean;
    if (link) seg.link = link;
    push(seg);
  };
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)|(<)/g)) {
    if (m[5] !== undefined || m[6] !== undefined) {
      emitText(decodeEntities(m[5] ?? m[6]));
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "br") {
      emitText("\n");
      continue;
    }
    if (closing) {
      const at = stack.map((f) => f.tag).lastIndexOf(tag);
      if (at < 0) continue;
      const [f] = stack.splice(at, stack.length - at);
      if (f.chip) {
        const { a } = current();
        const clean = Object.fromEntries(Object.entries(a).filter(([, v]) => v)) as Annotations;
        const ann = Object.keys(clean).length ? clean : undefined;
        if (f.chip.tex !== undefined) out.push({ type: "equation", expression: f.chip.tex, ...(ann ? { annotations: ann } : {}) });
        else if (f.chip.mention) {
          const label = f.chip.text.replace(/^@/, "");
          const mention = f.chip.mention.type === "user" ? { ...f.chip.mention, name: label || null } : f.chip.mention;
          out.push({ type: "mention", mention, plainText: label, ...(ann ? { annotations: ann } : {}) });
        }
      }
      continue;
    }
    const at = attrs(m[3]);
    const cls = (at.class ?? "").split(/\s+/).filter(Boolean);
    const frame: Frame = { tag };
    if (tag === "b" || tag === "strong") frame.ann = { bold: true };
    else if (tag === "i" || tag === "em") frame.ann = { italic: true };
    else if (tag === "u") frame.ann = { underline: true };
    else if (tag === "s" || tag === "strike" || tag === "del") frame.ann = { strikethrough: true };
    else if (tag === "code") frame.ann = { code: true };
    else if (tag === "a" || tag === "span") {
      const kind = at["data-mention-type"];
      const id = at["data-mention-id"] ?? "";
      if (cls.includes("mention") && kind) {
        const pageId = kind === "page" ? id || (at.href ?? "").replace(/^\/p\//, "") : "";
        const mention: Mention =
          kind === "page"
            ? { type: "page", id: pageId, url: opts.pageUrl ? opts.pageUrl(pageId) : undefined }
            : kind === "person"
              ? { type: "user", id }
              : kind === "date"
                ? { type: "date", start: id }
                : { type: "other", kind, url: at.href ?? null };
        if (mention.type === "page" && mention.url === undefined) delete (mention as { url?: string }).url;
        frame.chip = { mention, text: "" };
      } else if (tag === "span" && cls.includes("eq") && at["data-tex"] !== undefined) {
        frame.chip = { tex: at["data-tex"], text: "" };
      } else if (tag === "a" && at.href) {
        frame.link = at.href;
      } else if (tag === "span") {
        const c = cls.find((x) => x.startsWith("c-"));
        const hl = cls.find((x) => x.startsWith("hl-"));
        if (c || hl) frame.ann = { color: hl ? `${hl.slice(3)}_background` : c!.slice(2) };
      }
    }
    if (m[4] === "/") continue; // self-closing: nothing inside
    stack.push(frame);
  }
  return out;
}
