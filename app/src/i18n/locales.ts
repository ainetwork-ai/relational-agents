/** Languages the UI can be shown in. Keys are BCP-47; `ko` is the source
 *  language (every string in the code is written in Korean and `en` is a
 *  dictionary over those Korean keys — docs/i18n-plan.md §3 D3). */
export const LOCALES = ["ko", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ko";

/** Notion's language menu shows each entry as `native name / name in the
 *  current language`; the second line comes from the dictionary. */
export const LOCALE_NATIVE: Record<Locale, string> = { ko: "한국어", en: "English (US)" };

/** Intl locale for dates/numbers. */
export const INTL_LOCALE: Record<Locale, string> = { ko: "ko-KR", en: "en-US" };

export const LANG_COOKIE = "lang";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Pick the UI language: saved setting → cookie copy → Accept-Language → ko. */
export function resolveLocale(opts: {
  saved?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(opts.saved)) return opts.saved;
  if (isLocale(opts.cookie)) return opts.cookie;
  const al = opts.acceptLanguage ?? "";
  for (const part of al.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
