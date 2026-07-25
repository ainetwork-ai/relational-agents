// Rich-HTML paste (web pages / Google Docs) → markdown-ish text that the
// editor's existing markdown-paste pipeline turns into typed blocks.

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
    default:
      return kids;
  }
}

function walk(el: Element, out: string[], listPrefix = ""): void {
  for (const node of Array.from(el.children)) {
    const tag = node.tagName;
    if (tag === "H1") out.push(`# ${inline(node)}`);
    else if (tag === "H2") out.push(`## ${inline(node)}`);
    else if (tag === "H3" || tag === "H4") out.push(`### ${inline(node)}`);
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
      if (node.querySelector("h1,h2,h3,ul,ol,p,blockquote,pre")) walk(node, out, listPrefix);
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

/** Convert clipboard HTML to markdown-ish text ("" when nothing structured). */
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
