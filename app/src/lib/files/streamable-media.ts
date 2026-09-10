/**
 * The gate on inline serving (`/api/files/:id/stream`): only media that is
 * meant to be played or shown gets past it.
 *
 * This is a security boundary, not a convenience. **It is what lets the upload
 * allowlist accept executable documents** — html/htm and svg are in
 * allowed-types.ts precisely because they can never come back as an inline,
 * same-origin document: download forces `Content-Disposition: attachment`, and
 * this refuses to stream them.
 *
 * Read allowed-types.ts before widening it. Letting `text/*` through would
 * render an uploaded html as a document in our origin, which is session theft.
 *
 * Ported from ainteams (web/src/lib/files/streamable-media.ts).
 */

/** Rasters the browser can draw inline. No svg — it can carry script. */
export const RASTER_IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|avif)$/;

/**
 * Extension → MIME. **The gate and the response header must come off the same
 * table.** Split them and this happens: a `clip.mp4` row whose `files.mime_type`
 * is null passes the gate *by extension*, but the response goes out as
 * `application/octet-stream`, which together with `nosniff` makes the browser
 * refuse to play it — the very row the gate went out of its way to admit
 * becomes unusable. (ainteams learned this one; see its streamable-media.ts.)
 */
const MEDIA_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif",
};

const MEDIA_EXT_RE = new RegExp(`\\.(${Object.keys(MEDIA_MIME_BY_EXT).join("|")})$`, "i");

/** Whether this is video or audio — the callers that must honour Range. */
export function isTimedMedia(mimeType: string | null, fileName: string): boolean {
  const m = resolveContentType(mimeType, fileName);
  return m.startsWith("video/") || m.startsWith("audio/");
}

/**
 * The `Content-Type` to put on the response: the row's value when it has one,
 * else recovered from the extension through the table above. Neither →
 * `application/octet-stream`, a combination the gate has already refused.
 */
export function resolveContentType(mimeType: string | null, fileName: string): string {
  if (mimeType) return mimeType;
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return MEDIA_MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function isStreamableMedia(mimeType: string, fileName: string): boolean {
  const m = (mimeType || "").toLowerCase();
  if (m.startsWith("video/") || m.startsWith("audio/")) return true;
  if (RASTER_IMAGE_MIME_RE.test(m)) return true;
 // no mime type at all (the browser gave none) — decide on the extension, and
 // only media extensions pass
  if (!m) return MEDIA_EXT_RE.test(fileName);
  return false;
}
