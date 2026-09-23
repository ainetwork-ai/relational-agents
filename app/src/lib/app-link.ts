/**
 * What a stored `url` value actually points at.
 *
 * Most values the app writes are app-relative paths (`/p/<id>` for a page,
 * `/uploads/<file>` for an upload), so coercing every value to
 * `https://<value>` produces `https:///p/<id>` — a link that goes nowhere, for
 * a page that lives right here. Classifying first is what lets a page render
 * as its title instead of its id, and an upload as the picture it is.
 *
 * Absolute http(s) values are always treated as external. Detecting our own
 * origin would need `window`, which the server render does not have, and the
 * two passes disagreeing is a hydration mismatch — not worth it for a case the
 * app never writes.
 */
export type AppLink =
  | { kind: "page"; href: string; pageId: string }
  | { kind: "image"; href: string; name: string }
  | { kind: "file"; href: string; name: string }
  | { kind: "internal"; href: string; label: string }
  /** sibling service on another port of this host (":3111/?call=zoe") */
  | { kind: "service"; href: string; label: string }
  | { kind: "external"; href: string; label: string }
  /** not a usable link — rendering it as one would fabricate a destination */
  | { kind: "text"; label: string };

/** Page ids are UUIDs or base64url-encoded OKF paths. */
const PAGE_PATH = /^\/p\/([A-Za-z0-9_-]+)\/?$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
/** "example.com", "sub.example.co.uk/path" — enough of a host to prefix a scheme onto */
const BARE_HOST = /^[\w-]+(\.[\w-]+)+([/?:]|$)/;
/** the port-relative form resolveAppUrl() understands */
const PORT_RELATIVE = /^:\d+([/?]|$)/;

/** Uploads are stored under a generated uuid, so the "file name" of one is
 *  36 characters of noise. Nothing is lost by not showing it. */
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\w+$/i;

function fileName(path: string): string {
  const last = path.split("/").pop() ?? path;
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
   // keep the raw segment
  }
  return UUID_FILE.test(name) ? "" : name;
}

export function classifyLink(raw: string): AppLink {
  const value = (raw ?? "").trim();
  if (!value) return { kind: "text", label: "" };

  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      const rest = u.pathname === "/" ? "" : u.pathname;
      return { kind: "external", href: value, label: u.host + rest };
    } catch {
      return { kind: "external", href: value, label: value };
    }
  }

  const page = PAGE_PATH.exec(value);
  if (page) return { kind: "page", href: value, pageId: page[1] };

  if (value.startsWith("/uploads/")) {
    const name = fileName(value);
    return IMAGE_EXT.test(value)
      ? { kind: "image", href: value, name }
      : { kind: "file", href: value, name };
  }

  if (value.startsWith("/")) return { kind: "internal", href: value, label: value };

 // ":3111/?call=zoe" — the port-relative form the dashboard scripts write for
 // sibling services (VIDEOCALL_URL). Only the browser knows the host to put in
 // front of it, so the href is finished at render time by resolveAppUrl().
  if (PORT_RELATIVE.test(value)) return { kind: "service", href: value, label: value };

  if (BARE_HOST.test(value)) return { kind: "external", href: `https://${value}`, label: value };

  return { kind: "text", label: value };
}

/** The shareable form of a link: an app path or a port-relative service URL
 *  needs a host in front of it to survive a paste anywhere else. */
export function absoluteHref(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (typeof window === "undefined") return href;
  if (PORT_RELATIVE.test(href)) {
    return `${window.location.protocol}//${window.location.hostname}${href}`;
  }
  return new URL(href, window.location.origin).toString();
}
