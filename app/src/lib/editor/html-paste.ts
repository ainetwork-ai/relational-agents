// Rich-HTML paste → blocks.
//
// Two sources, two shapes:
// - Notion (copying inside notion.so puts Notion's LIVE DOM on the clipboard):
//   `htmlToNotionBlocks` walks that DOM into a TYPED TREE — headings, to-dos
//   with their checked state, toggles, callouts with icons, tables, nesting.
// - anything else (web pages / Google Docs): `htmlToMarkdownish` flattens tags
//   to markdown-ish text for the editor's markdown-paste pipeline.

import type { BlockType, BlockContent } from "@/lib/db/schema";
import { mdInlineToHtml, mdInlinePlain } from "@/lib/memory-parse";

function inline(el: Node): string {
  if (el.nodeType === Node.TEXT_NODE) return el.textContent ?? "";
  if (el.nodeType !== Node.ELEMENT_NODE) return "";
  const e = el as HTMLElement;
  const kids = Array.from(e.childNodes).map(inline).join("");
  switch (e.tagName) {
    case "B":
    case "STRONG":
      return kids.trim() ? `**${kids}**` : kids;
    case "I":
    case "EM":
      return kids.trim() ? `*${kids}*` : kids;
    case "S":
    case "DEL":
    case "STRIKE":
      return kids.trim() ? `~~${kids}~~` : kids;
    case "CODE":
      return kids.trim() ? `\`${kids}\`` : kids;
    case "A":
      return kids.trim() ? `[${kids}](${e.getAttribute("href") ?? ""})` : kids;
    case "BR":
      return "\n";
    case "STYLE":
    case "SCRIPT":
      return "";
    default:
      return kids;
  }
}

// ---- generic web HTML → markdown-ish ---------------------------------------

function walk(el: Element, out: string[]): void {
  for (const node of Array.from(el.children)) {
    const tag = node.tagName;
    if (tag === "H1") out.push(`# ${inline(node)}`);
    else if (tag === "H2") out.push(`## ${inline(node)}`);
    else if (tag === "H3" || tag === "H4" || tag === "H5" || tag === "H6")
      out.push(`### ${inline(node)}`);
    else if (tag === "UL") {
      for (const li of Array.from(node.children).filter((c) => c.tagName === "LI"))
        out.push(`- ${inline(li)}`);
    } else if (tag === "OL") {
      let n = 1;
      for (const li of Array.from(node.children).filter((c) => c.tagName === "LI"))
        out.push(`${n++}. ${inline(li)}`);
    } else if (tag === "BLOCKQUOTE") out.push(`> ${inline(node)}`);
    else if (tag === "PRE") out.push("```", node.textContent ?? "", "```");
    else if (tag === "HR") out.push("---");
    else if (tag === "P" || tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") {
 // containers with their own block children recurse; leaves emit a line
      if (node.querySelector("h1,h2,h3,h4,ul,ol,p,blockquote,pre")) walk(node, out);
      else {
        const t = inline(node).trim();
        if (t) out.push(t);
      }
    } else if (tag === "TABLE") {
      for (const tr of Array.from(node.querySelectorAll("tr")))
        out.push(
          `| ${Array.from(tr.children)
            .map((c) => (c.textContent ?? "").trim().replace(/\|/g, "\\|"))
            .join(" | ")} |`
        );
    } else {
      const t = inline(node).trim();
      if (t) out.push(t);
    }
  }
}

/** Convert clipboard HTML to markdown-ish text ("" when nothing structured).
 * Notion DOM should go through `htmlToNotionBlocks` instead. */
export function htmlToMarkdownish(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out: string[] = [];
    walk(doc.body, out);
    return out.join("\n").trim();
  } catch {
    return "";
  }
}

// ---- Notion DOM → typed block tree -----------------------------------------
// Every Notion block is a `div.notion-selectable.notion-<type>-block`, its
// text sits in a `[data-content-editable-leaf]`, and CHILD blocks nest inside
// the parent's own div — so depth falls out of the walk.

export interface PastedBlock {
  type: BlockType;
  content: BlockContent;
  depth: number;
}

const NOTION_BLOCK_SEL = '[class*="notion-selectable"][class*="-block"]';

/** the notion-<type>-block class, if el is a Notion block */
function notionType(el: Element): string | null {
  const cls = el.getAttribute("class") ?? "";
  if (!cls.includes("notion-selectable")) return null;
  const m = cls.match(/notion-([a-z_]+)-block/);
  return m ? m[1] : null;
}

/** this block's own text leaf — the first one not owned by a nested child */
function ownLeaf(block: Element): Element | null {
  for (const leaf of Array.from(block.querySelectorAll("[data-content-editable-leaf]"))) {
    if (leaf.parentElement?.closest(NOTION_BLOCK_SEL) === block) return leaf;
  }
  return null;
}

/** this block's own checkbox (a to-do's), skipping nested children's */
function ownCheckbox(block: Element): Element | null {
  for (const box of Array.from(block.querySelectorAll('input[type="checkbox"]'))) {
    if (box.closest(NOTION_BLOCK_SEL) === block) return box;
  }
  return null;
}

/** inline markdown → {text, html?} the way parseMarkdown stores blocks */
function typed(type: BlockType, md: string, extra: BlockContent = {}): PastedBlock {
  const html = mdInlineToHtml(md);
  const content: BlockContent = html
    ? { ...extra, html, text: mdInlinePlain(md) }
    : { ...extra, text: md };
  return { type, content, depth: 0 };
}

/** Notion's /image/<encoded upstream url> proxy — decode it; their private
 * storage needs auth we don't have, so only publicly fetchable hosts pass. */
function usableImageUrl(src: string | null): string | null {
  if (!src) return null;
  let url = src;
  const m = src.match(/^\/image\/(.+?)(?:\?|$)/);
  if (m) {
    try {
      url = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  }
  if (!/^https?:\/\//.test(url)) return null;
  if (/notion-static\.com|notionusercontent\.com/.test(url)) return null;
  return url;
}

function collectNotion(
  el: Element,
  out: PastedBlock[],
  depth: number,
  consumed: Set<Element>
): void {
  for (const node of Array.from(el.children)) {
    const type = notionType(node);
    if (!type) {
      collectNotion(node, out, depth, consumed);
      continue;
    }
    const leaf = ownLeaf(node);
    const md = leaf && !consumed.has(leaf) ? inline(leaf).replace(/\s+/g, " ").trim() : "";
    let emitted: PastedBlock | null = null;
    switch (type) {
 // a page block's own line is its title; pasting keeps it a heading block
      case "page":
      case "header":
        if (md) emitted = typed("heading1", md);
        break;
      case "sub_header":
        if (md) emitted = typed("heading2", md);
        break;
      case "sub_sub_header":
        if (md) emitted = typed("heading3", md);
        break;
      case "to_do": {
        const checked = ownCheckbox(node)?.hasAttribute("checked") ?? false;
        if (md) emitted = typed("todo", md, { checked });
        break;
      }
      case "bulleted_list":
        if (md) emitted = typed("bulleted_list", md);
        break;
      case "numbered_list":
        if (md) emitted = typed("numbered_list", md);
        break;
      case "toggle":
        if (md) emitted = typed("toggle", md);
        break;
      case "quote":
        if (md) emitted = typed("quote", md);
        break;
      case "callout": {
 // icon + the callout's FIRST inner text block become the callout itself;
 // that leaf is marked consumed so the recursion below nests the REST of
 // the callout's blocks as its children instead of repeating the first.
        const icon =
          node.querySelector(".notion-record-icon")?.textContent?.trim() || "💡";
        const inner = Array.from(node.querySelectorAll("[data-content-editable-leaf]")).find(
          (l) => l.parentElement?.closest(NOTION_BLOCK_SEL) !== node
        );
        const first = inner ? inline(inner).replace(/\s+/g, " ").trim() : md;
        emitted = typed("callout", first, { icon });
        if (inner) consumed.add(inner);
        break;
      }
      case "code":
        emitted = {
          type: "code",
          content: { text: node.textContent ?? "", language: "plain" },
          depth: 0,
        };
        break;
      case "divider":
        emitted = { type: "divider", content: {}, depth: 0 };
        break;
      case "table": {
 // Notion's simple table renders a real <table>
        const t = node.querySelector("table");
        if (t) {
          const cells = Array.from(t.querySelectorAll("tr")).map((tr) =>
            Array.from(tr.children).map((c) => (c.textContent ?? "").trim())
          );
          if (cells.length)
            emitted = {
              type: "table",
              content: { table: { cells, headerRow: !!t.querySelector("th") } },
              depth: 0,
            };
        }
        out.push(...(emitted ? [{ ...emitted, depth }] : []));
        continue; // never walk INTO a table looking for blocks
      }
      case "image": {
        const url = usableImageUrl(node.querySelector("img")?.getAttribute("src") ?? null);
        if (url) emitted = { type: "image", content: { url, text: "" }, depth: 0 };
        break;
      }
 // database views need a real database + rows on our side — a paste can't
 // create one faithfully, so these drop rather than leave broken shells
      case "collection_view":
      case "collection_view_page":
        continue;
      default:
        if (md) emitted = typed("paragraph", md);
    }
    if (emitted) out.push({ ...emitted, depth });
 // child blocks nest inside the parent's div; they belong UNDER the line we
 // just emitted (or at this level, when the block itself contributed none)
    collectNotion(node, out, emitted ? depth + 1 : depth, consumed);
  }
}

/** Notion clipboard DOM → typed tree; null when the HTML is not Notion's. */
export function htmlToNotionBlocks(html: string): PastedBlock[] | null {
  try {
    if (!html.includes("notion-selectable")) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc.querySelector(NOTION_BLOCK_SEL)) return null;
 // whole-page copies drag Notion's chrome along — and every sidebar row is
 // itself a notion-page-block. <main> holds just the page (title + body);
 // partial-selection copies have no <main> and no chrome, so body is safe.
    const scope = doc.querySelector("main") ?? doc.body;
    const out: PastedBlock[] = [];
    collectNotion(scope, out, 0, new Set());
    return out;
  } catch {
    return null;
  }
}
