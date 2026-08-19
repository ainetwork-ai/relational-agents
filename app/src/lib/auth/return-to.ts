/** A post-login destination is honored only as a same-origin path: "/x…" but
 * not "//host" (protocol-relative) and not an absolute URL — anything else
 * would let a crafted login link bounce the visitor to a foreign site. */
export function safeReturnTo(v: string | null | undefined): string | undefined {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : undefined;
}
