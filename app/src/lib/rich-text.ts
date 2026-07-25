import sanitize from "sanitize-html";

/**
 * Inline rich-text layer (F6). Blocks store BOTH representations:
 *   content.text — plain text (search, markdown shortcuts, caret math)
 *   content.html — sanitized inline HTML (b/i/u/s/code/a only)
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
  allowedSchemes: ["http", "https", "mailto"],
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
