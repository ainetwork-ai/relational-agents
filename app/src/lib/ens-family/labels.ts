// GENERATED from ens/src/labels.ts by ens/scripts/sync-to-app.mjs — edit it there, then re-run the script.
// ens/src/labels.ts
// What may become one ENS label in a family tree: lowercase a–z, 0–9 and inner hyphens,
// 1–32 characters (3+ for a .eth name). Stricter than ENSIP-15 on purpose: families type these.
// A double hyphen is refused too ("ab--c" is reserved for punycode-style labels).
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const MAX_LABEL = 32;

export type LabelCheck = { ok: true; label: string } | { ok: false; reason: "empty" | "too-short" | "too-long" | "invalid" };

export function checkLabel(input: string, opts: { min?: number } = {}): LabelCheck {
  const label = input.trim().toLowerCase().replace(/\s+/g, "-");
  if (!label) return { ok: false, reason: "empty" };
  if (label.length > MAX_LABEL) return { ok: false, reason: "too-long" };
  if (!LABEL.test(label) || label.includes("--")) return { ok: false, reason: "invalid" };
  if (label.length < (opts.min ?? 1)) return { ok: false, reason: "too-short" };
  return { ok: true, label };
}

/**
 * Candidate labels to try when `base` is taken — the caller keeps only the available ones.
 * `base` is normalized like `checkLabel` does; an invalid base yields none. Every candidate
 * passes `checkLabel` as returned, so a long base yields fewer than `n`.
 */
export function suggestLabels(base: string, n = 6): string[] {
  const checked = checkLabel(base);
  if (!checked.ok) return [];
  const b = checked.label;
  const candidates = [`${b}-family`, `the-${b}s`];
  for (let i = 2; candidates.length < n + 2; i++) candidates.push(`${b}${i}`);
  return candidates.filter((c) => checkLabel(c).ok).slice(0, n);
}
