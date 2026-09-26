"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "./locales";
import { makeT, type T } from "./translate";

interface Ctx {
  locale: Locale;
  t: T;
}

const LocaleContext = createContext<Ctx>({ locale: DEFAULT_LOCALE, t: makeT(DEFAULT_LOCALE) });

/** The server resolves the locale (saved setting → cookie → Accept-Language)
 *  and hands it down here; changing it is a PATCH /api/auth/me followed by
 *  router.refresh(), so the server, `<html lang>` and this context agree. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** `t("Add icon")` — the English source string is the key. */
export function useT(): T {
  return useContext(LocaleContext).t;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

/** The Intl locale (ko-KR / en-US) for dates and numbers. */
export function useIntlLocale(): string {
  return INTL_LOCALE[useContext(LocaleContext).locale];
}
