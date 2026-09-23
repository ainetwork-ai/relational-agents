import sanitize from "sanitize-html";

/**
 * Inline rich-text layer. Blocks store BOTH representations:
 * content.text — plain text (search, markdown shortcuts, caret math)
 * content.html — sanitized inline HTML (b/i/u/s/code/a only)
 * Every write path MUST pass through sanitizeInline — the editor renders
 * content.html with innerHTML.
 */

const OPTIONS: sanitize.IOptions = {
 // <span> is allowed ONLY to carry mention chips (class restricted below).
  allowedTags: ["b", "strong", "i", "em", "u", "s", "strike", "del", "code", "a", "br", "span"],
 // mention chips (@page / @person / @date) persist their type+id so they
 // survive save→reload; class is constrained to "mention" via allowedClasses.
  allowedAttributes: {
    a: ["href", "class", "data-mention-type", "data-mention-id"],
    span: ["class", "data-mention-type", "data-mention-id", "data-tex", "contenteditable"],
  },
 // "mention" for chips, "comment-highlight" for inline range-comment anchors,
 // "eq" for inline equations (KaTeX chips)
  allowedClasses: { a: ["mention"], span: ["mention", "comment-highlight", "eq", "c-*", "hl-*"] },
 // inline equation chips canonicalize to `$tex$` text — the KaTeX markup a
 // live chip carries in the DOM must never reach storage
  transformTags: {
    span: (tagName, attribs) => {
      if ((attribs.class ?? "").split(/\s+/).includes("eq") && attribs["data-tex"]) {
        return { tagName, attribs, text: `$${attribs["data-tex"]}$` };
      }
      return { tagName, attribs };
    },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  disallowedTagsMode: "discard",
 // Range splits leave empty tag shells (<a></a>) that break caret placement
 // in the new block — drop any inline tag with no text (but keep <br>).
  exclusiveFilter: (frame) => frame.tag !== "br" && !frame.text.trim(),
};

export function sanitizeInline(html: string): string {
  return sanitize(html, OPTIONS);
}

/** Inline HTML → markdown (for the md mirror). */
export function inlineHtmlToMd(html: string): string {
  let s = sanitizeInline(html);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<(b|strong)>(.*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(i|em)>(.*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<(s|strike|del)>(.*?)<\/\1>/gi, "~~$2~~");
  s = s.replace(/<u>(.*?)<\/u>/gi, "$1"); // md has no underline
  s = s.replace(/<code>(.*?)<\/code>/gi, "`$1`");
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  s = s.replace(/<[^>]+>/g, ""); // strip remaining tags (e.g. span mentions → @label)
  return decodeEntities(s);
}

/**
 * Plain text → inline HTML with bare URLs turned into links, for text that is
 * STORED as plain text but rendered in a contenteditable (a database's 설명).
 *
 * Line breaks are <br>, not literal newlines: Chrome's editing engine treats a
 * newline character in a contenteditable as removable whitespace and eats it as
 * soon as you type near it (verified — two Enters then a keystroke lost a line).
 * A trailing <br> gets a second one, the filler every editor needs: a lone
 * trailing <br> renders no line and domToPlainText reads it back as nothing, so
 * without it the last empty line would vanish on every save.
 */
export function plainTextToLinkedHtml(text: string): string {
  const url = /(?:https?:\/\/|www\.)[^\s<>()]*[^\s<>().,;:!?'"]/gi;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(url)) {
    const raw = m[0];
    const at = m.index ?? 0;
    out += escapeHtml(text.slice(last, at));
    const href = raw.startsWith("www.") ? `https://${raw}` : raw;
    out += `<a href="${escapeHtml(href)}">${escapeHtml(raw)}</a>`;
    last = at + raw.length;
  }
  out = (out + escapeHtml(text.slice(last))).replace(/\n/g, "<br>");
  return out.endsWith("<br>") ? `${out}<br>` : out;
}

const BLOCK_TAG = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE)$/;

/**
 * A contenteditable's DOM → the plain text it shows. `innerText` cannot do this
 * job: Chrome answers a pasted blank line (`<div><br></div>`) with TWO newlines
 * — one for the block boundary, one for the <br> — so every save spread the
 * lines further apart. Here a block boundary is one newline, and a <br> with
 * nothing after it is the filler that makes an empty line visible, worth none.
 */
export function domToPlainText(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child as Text).data;
      } else if (child.nodeName === "BR") {
        if (child.nextSibling) out += "\n";
      } else if (BLOCK_TAG.test(child.nodeName)) {
        if (out !== "") out += "\n";
        walk(child);
      } else {
        walk(child); // <a>, <span>, <b>… contribute only their text
      }
    }
  };
  walk(root);
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function htmlToText(html: string): string {
  return decodeEntities(sanitizeInline(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
