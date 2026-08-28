import { buildStorageUrl, storageBucket } from "./storage";

/**
 * The two url shapes a browser may hold for a stored file, and the mapping back
 * to what a row stores. Kept free of Next and database imports on purpose:
 * finalize-upload.ts needs these, and the promotion check loads that file
 * under plain tsx where `server-only` and `@/lib/db` do not resolve.
 */

/**
 * Values a column may hold for an image the app renders directly (an avatar, a
 * page cover). Either the pre-migration disk path or the key-addressed serving
 * path — never an arbitrary url, or a row becomes a way to point the app's own
 * markup at somebody else's server.
 */
export function isServableAssetUrl(url: string): boolean {
  return (
    (/^\/uploads\/[\w.-]+$/.test(url) && !url.includes("..")) ||
    /^\/api\/files\/key\/files\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/.test(url)
  );
}

/** The serving path for a content key — what an upload hands the browser. */
export function servePathForKey(key: string): string {
  return `/api/files/key/${key}`;
}

/**
 * A url the client holds → what a `files` row stores. The browser only ever
 * sees the key-addressed serving path (or, pre-migration, a disk path); the
 * `s3://` token is derived here, on the server, so it never has to travel.
 * null for anything the upload path could not have produced.
 */
export function storageRefFromClientUrl(url: string): string | null {
  const m = /^\/api\/files\/key\/(files\/[0-9a-f]{64}\.[a-z0-9]{1,8})$/.exec(url);
  if (m) return buildStorageUrl(storageBucket(), m[1]);
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(url) && !url.includes("..")) return url;
  return null;
}
