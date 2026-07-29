/**
 * Initials for avatars and workspace icons.
 *
 * `"💞".slice(0, 1)` returns half a surrogate pair. React then compares the
 * server's lone `\ud83d` against the browser's replacement char and reports a
 * hydration mismatch — plus the tile renders a broken glyph. Spreading the
 * string iterates code points instead, so both sides agree.
 *
 * (Emoji built from ZWJ sequences — 👩‍❤️‍👨 — still yield only their first code
 * point, but deterministically on both sides, so hydration stays intact.)
 */

/** First visible character, uppercased. Empty input → `fallback`. */
export function initial(value: string | null | undefined, fallback = "?"): string {
  const first = [...(value ?? "")][0];
  return first ? first.toUpperCase() : fallback;
}

/** First `count` visible characters — for generated icon text. */
export function firstGlyphs(value: string | null | undefined, count: number): string {
  return [...(value ?? "")].slice(0, count).join("");
}
