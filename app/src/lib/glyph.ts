/**
 * Initials for avatars and workspace icons.
 *
 * `"💞".slice(0, 1)` returns half a surrogate pair. React then compares the
 * server's lone `\ud83d` against the browser's replacement char and reports a
 * hydration mismatch — plus the tile renders a broken glyph.
 *
 * Iterating graphemes instead keeps whole emoji intact, including the ZWJ
 * sequences that used to survive only as their first code point (🧑‍💻 came out
 * as 🧑, 👩‍❤️‍👨 as 👩). The locale is pinned so the server and the browser
 * segment identically no matter where either one runs; without `Intl.Segmenter`
 * we fall back to code points, which is the old behaviour.
 */

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

/** Visible characters, so an emoji counts as one no matter how it is encoded. */
function graphemes(value: string): string[] {
  if (!segmenter) return [...value];
  return Array.from(segmenter.segment(value), (s) => s.segment);
}

/** First visible character, uppercased. Empty input → `fallback`. */
export function initial(value: string | null | undefined, fallback = "?"): string {
  const first = graphemes(value ?? "")[0];
  return first ? first.toUpperCase() : fallback;
}

/** First `count` visible characters — for generated icon text. */
export function firstGlyphs(value: string | null | undefined, count: number): string {
  return graphemes(value ?? "").slice(0, count).join("");
}

/** Regional indicators (🇰🇷) and enclosing keycaps (#️⃣) are emoji without being
 * pictographic themselves, so all three properties are needed. */
const EMOJI_GLYPH = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{20E3}]/u;

/** Is this one visible character an emoji? Takes a grapheme, so it answers yes
 * for whole sequences — 🧑‍💻, 👋🏽, 🇰🇷, 🏴󠁧󠁢󠁳󠁣󠁴󠁿 — not just their first code point. */
export function isEmojiGlyph(glyph: string): boolean {
  return !!glyph && EMOJI_GLYPH.test(glyph);
}
