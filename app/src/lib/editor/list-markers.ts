/**
 * List markers by nesting level, and how far one level indents.
 *
 * Measured on app.notion.com 2026-09-10 (docs/notion-indent.md §3): both marker
 * families cycle with period 3, and the cycle counts LIST ancestors — a bullet
 * nested under a PARAGRAPH is still `•` (T21), while a bullet under a bullet is
 * `◦` (T18). So the level here is "how many list items of the same kind are
 * above me", not the block's depth.
 *
 *   depth in its own list   bulleted   numbered
 *   0                       •          1.
 *   1                       ◦          a.
 *   2                       ▪          i.
 *   3                       •          1.   (back to the top)
 */

const BULLETS = ["•", "◦", "▪"] as const;

export const bulletGlyph = (level: number): string => BULLETS[((level % 3) + 3) % 3];

/** 1 → a, 26 → z, 27 → aa (bijective base 26) */
function alpha(n: number): string {
  let out = "";
  let k = Math.max(1, Math.floor(n));
  while (k > 0) {
    const rem = (k - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    k = Math.floor((k - 1) / 26);
  }
  return out;
}

const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

function roman(n: number): string {
  let k = Math.max(1, Math.floor(n));
  let out = "";
  for (const [v, s] of ROMAN) while (k >= v) { out += s; k -= v; }
  return out;
}

/** the label without the trailing period — "1", "a", "i" */
export function numberLabel(n: number, level: number): string {
  const mode = ((level % 3) + 3) % 3;
  return mode === 0 ? String(n) : mode === 1 ? alpha(n) : roman(n);
}
