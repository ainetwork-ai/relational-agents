// Rich-HTML paste (web pages / Google Docs / Notion) → markdown-ish text that
// the editor's existing markdown-paste pipeline turns into typed blocks.

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

function walk(el: Element, out: string[], listPrefix = ""): void {
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
      if (node.querySelector("h1,h2,h3,h4,ul,ol,p,blockquote,pre")) walk(node, out, listPrefix);
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

// ---- Notion ----------------------------------------------------------------
// Copying inside notion.so puts Notion's LIVE DOM on the clipboard: every
// block is a `div.notion-selectable.notion-<type>-block`, its text sits in a
// `[data-content-editable-leaf]`, and child blocks nest INSIDE the parent's
// div. The generic walker above saw only anonymous divs and flattened whole
// pages into plain paragraphs — headings, to-dos, callouts, everything.

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

/** Walk Notion's DOM emitting one markdown line per block. `consumed` leaves
 * were already folded into an earlier line (a callout's first inner text).
 * Child blocks nest inside their parent's div, so each handled block also
 * recurses — flattened, since the markdown pipeline has no nesting. */
function walkNotion(el: Element, out: string[], consumed: Set<Element>): void {
  for (const node of Array.from(el.children)) {
    const type = notionType(node);
    if (!type) {
      walkNotion(node, out, consumed);
      continue;
    }
    const leaf = ownLeaf(node);
    const text = leaf && !consumed.has(leaf) ? inline(leaf).replace(/\s+/g, " ").trim() : "";
    switch (type) {
 // a nested page block's OWN line is its h1 title; pasted with noTitle it
 // stays a heading block rather than becoming the page title
      case "page":
      case "header":
        if (text) out.push(`# ${text}`);
        break;
      case "sub_header":
        if (text) out.push(`## ${text}`);
        break;
      case "sub_sub_header":
        if (text) out.push(`### ${text}`);
        break;
      case "to_do": {
        const checked = ownCheckbox(node)?.hasAttribute("checked") ?? false;
        if (text) out.push(`- [${checked ? "x" : " "}] ${text}`);
        break;
      }
      case "bulleted_list":
        if (text) out.push(`- ${text}`);
        break;
      case "numbered_list":
        if (text) out.push(`1. ${text}`);
        break;
 // no markdown form for a toggle — its text survives as a bullet
      case "toggle":
        if (text) out.push(`- ${text}`);
        break;
      case "quote":
        if (text) out.push(`> ${text}`);
        break;
      case "callout": {
 // `> 💬 text` is the parser's callout form: icon + the callout's FIRST
 // inner text block on one line. That leaf is marked consumed so the
 // recursion below doesn't emit it again; further inner blocks become
 // their own lines.
        const icon =
          node.querySelector(".notion-record-icon")?.textContent?.trim() || "💡";
        const inner = Array.from(node.querySelectorAll("[data-content-editable-leaf]")).find(
          (l) => l.parentElement?.closest(NOTION_BLOCK_SEL) !== node
        );
        const first = inner ? inline(inner).replace(/\s+/g, " ").trim() : text;
        if (first || icon) out.push(`> ${icon} ${first}`.trimEnd());
        if (inner) consumed.add(inner);
        break;
      }
      case "code":
        out.push("```", node.textContent ?? "", "```");
        break;
      case "divider":
        out.push("---");
        break;
      case "table":
      case "collection_view":
      case "collection_view_page":
      case "image":
 // no faithful markdown form from the DOM — drop rather than emit garbage
        break;
      default:
        if (text) out.push(text);
    }
    walkNotion(node, out, consumed);
  }
}

/** Convert clipboard HTML to markdown-ish text ("" when nothing structured). */
export function htmlToMarkdownish(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out: string[] = [];
    if (doc.querySelector(NOTION_BLOCK_SEL)) {
 // whole-page copies drag Notion's chrome along — and every sidebar row is
 // itself a notion-page-block. <main> holds just the page (title + body);
 // partial-selection copies have no <main> and no chrome, so body is safe.
      const scope = doc.querySelector("main") ?? doc.body;
      walkNotion(scope, out, new Set());
    } else {
      walk(doc.body, out);
    }
    return out.join("\n").trim();
  } catch {
    return "";
  }
}
