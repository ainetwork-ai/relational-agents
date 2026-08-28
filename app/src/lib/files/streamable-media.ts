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

const MEDIA_EXT_RE = /\.(mp4|mov|webm|m4v|mp3|m4a|wav|ogg|aac|png|jpe?g|gif|webp|avif)$/i;

export function isStreamableMedia(mimeType: string, fileName: string): boolean {
  const m = (mimeType || "").toLowerCase();
  if (m.startsWith("video/") || m.startsWith("audio/")) return true;
  if (RASTER_IMAGE_MIME_RE.test(m)) return true;
 // no mime type at all (the browser gave none) — decide on the extension, and
 // only media extensions pass
  if (!m) return MEDIA_EXT_RE.test(fileName);
  return false;
}
