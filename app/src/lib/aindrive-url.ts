/**
 * aindrive file links, as people share them: `<aindrive>/d/<driveId>?path=<path>`
 * — what the aindrive web UI puts in the address bar for a file. A block that
 * holds one of these shows the file (the way a Google Drive link unfurls);
 * the bytes come through this app's `/api/aindrive/raw`, which reads them over
 * aindrive's MCP. Client-safe: string logic only.
 */

export interface AindriveRef {
  driveId: string;
  /** drive-relative file path */
  path: string;
}

/** The shareable aindrive link for a file. `base` is the aindrive web origin. */
export function aindriveFileUrl(base: string, ref: AindriveRef): string {
  return `${base.replace(/\/+$/, "")}/d/${encodeURIComponent(ref.driveId)}?path=${encodeURIComponent(ref.path)}`;
}

/** The drive + path an aindrive link points at, or null for any other URL.
 *  With `base`, only links on that aindrive server count. */
export function parseAindriveUrl(url: string, base?: string | null): AindriveRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (base) {
    try {
      if (u.origin !== new URL(base).origin) return null;
    } catch {
      return null;
    }
  }
  const m = u.pathname.match(/^\/d\/([A-Za-z0-9_-]+)\/?$/);
  const path = u.searchParams.get("path");
  if (!m || !path || path.endsWith("/")) return null;
  return { driveId: m[1], path: path.replace(/^\/+/, "") };
}

/** Where this app serves the file's bytes (same origin, access-checked). */
export function aindriveRawUrl(ref: AindriveRef, download = false): string {
  const q = new URLSearchParams({ drive: ref.driveId, path: ref.path });
  if (download) q.set("download", "1");
  return `/api/aindrive/raw?${q}`;
}

/** A small thumbnail (~256px webp) of an image file, proxied from aindrive's
 *  thumbnail endpoint. Mobile agents use the system's gallery cache (~20 KB
 *  vs 10-40 MB originals); much faster for grids. */
export function aindriveThumbUrl(ref: AindriveRef): string {
  return `/api/aindrive/thumb?drive=${encodeURIComponent(ref.driveId)}&path=${encodeURIComponent(ref.path)}`;
}

/** The URL to fetch a file's bytes from: an aindrive link becomes the proxy,
 *  anything else is used as it is. */
export function fileBytesUrl(url: string, base?: string | null): string {
  const ref = parseAindriveUrl(url, base);
  return ref ? aindriveRawUrl(ref) : url;
}

/** A thumbnail URL for an image: aindrive links use the thumbnail proxy,
 *  others are used as-is (no external thumbnail service). */
export function fileThumbUrl(url: string, base?: string | null): string {
  const ref = parseAindriveUrl(url, base);
  return ref ? aindriveThumbUrl(ref) : url;
}

/** Last path segment — the file's name. */
export function aindriveFileName(ref: AindriveRef): string {
  return ref.path.slice(ref.path.lastIndexOf("/") + 1);
}
