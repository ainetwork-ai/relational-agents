const PROBE_ORIGIN = "http://return-to.invalid";

/** A post-login destination is honored only as a same-origin path: "/x…" but
 * not "//host" (protocol-relative) and not an absolute URL — anything else
 * would let a crafted login link bounce the visitor to a foreign site.
 * A URL parser reads "\" as "/" and drops tabs and newlines, so "/\evil.com"
 * and "/\t/evil.com" are "//evil.com" by the time a redirect is built: those
 * are refused outright, and what survives is resolved and must stay on origin. */
export function safeReturnTo(v: string | null | undefined): string | undefined {
  if (!v || !v.startsWith("/") || v.startsWith("//")) return undefined;
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return undefined;
  let url: URL;
  try {
    url = new URL(v, PROBE_ORIGIN);
  } catch {
    return undefined;
  }
  if (url.origin !== PROBE_ORIGIN) return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}
