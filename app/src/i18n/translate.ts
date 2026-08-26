import { en } from "./en";
import type { Locale } from "./locales";

const DICTS: Record<Locale, Record<string, string> | null> = { ko: null, en };

export type Vars = Record<string, string | number>;

/** `{name}` placeholders; a missing var is left as-is so it is visible. */
function fill(s: string, vars?: Vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Translate a Korean source string for `locale`. Unknown keys fall back to
 *  the Korean text itself. */
export function translate(locale: Locale, key: string, vars?: Vars): string {
  const dict = DICTS[locale];
  return fill((dict && dict[key]) ?? key, vars);
}

export type T = (key: string, vars?: Vars) => string;

export function makeT(locale: Locale): T {
  return (key, vars) => translate(locale, key, vars);
}
