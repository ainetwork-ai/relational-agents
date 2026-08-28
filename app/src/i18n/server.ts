import { cookies, headers } from "next/headers";
import { LANG_COOKIE, resolveLocale, type Locale } from "./locales";
import { makeT } from "./translate";

/** Locale for a server component / route. `saved` is users.language when the
 *  caller already has the user row; otherwise the cookie copy stands in. */
export async function getLocale(saved?: string | null): Promise<Locale> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    saved,
    cookie: c.get(LANG_COOKIE)?.value,
    acceptLanguage: h.get("accept-language"),
  });
}

export async function getT(saved?: string | null) {
  return makeT(await getLocale(saved));
}
