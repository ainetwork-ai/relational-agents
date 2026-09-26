// The one list of upload types. The server gate (/api/upload, the tus hooks)
// and the client's pre-check share it, so a file that will be refused is
// refused before the round trip instead of after it.
//
// Ported from ainteams (web/src/lib/files/allowed-types.ts) — same policy, so
// the two services agree on what may be attached. Client-safe: no node
// imports, string logic only.
//
// Executable extensions (js, mjs, exe …) stay out. svg and html/htm are IN,
// and they rest on next.config.ts serving /uploads/* with
// `Content-Security-Policy: sandbox` and `nosniff` — take that header away and
// these two have to come out with it.

export const ALLOWED_EXTENSIONS = new Set([
  // Images — heic/heif is the iPhone's default photo format. avif matches the render check
  // (isImageFile) (it used to be missing from the allowlist, so the two disagreed). Inline heic
  // rendering depends on the browser (Safari yes / Chrome no), so it is best-effort — when it
  // cannot be drawn it degrades to a file card/download.
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'heic', 'heif', 'bmp', 'tif', 'tiff',
  // Video (UX audit #14)
  'mp4', 'mov', 'webm', 'm4v',
  // Audio (UX audit #14)
  'mp3', 'm4a', 'wav', 'ogg', 'aac',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf',
  // Text / data — for dev-team collaboration. Executable script types (js/mjs/exe, etc.) stay excluded.
  // lottie: animation assets designers hand over (dotLottie = a zip holding JSON + images). Not
  // played inline, only handled as a file card/download — it is on par with zip, not executable.
  'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'log', 'lottie',
  // html/htm — people want to share reports and saved web pages. They can carry active content,
  // but no serving path renders them as an app-origin document: download = always attachment,
  // stream = the isStreamableMedia gate (streamable-media.ts), /uploads = CSP sandbox + nosniff
  // (next.config.ts). These are the same defences svg, with the same risk, already relies on.
  // The first two are pinned by route tests (download/route.test.ts · stream/route.test.ts) —
  // only the /uploads header is static config.
  'html', 'htm',
  // OpenDocument (LibreOffice/OpenOffice)
  'odt', 'ods', 'odp',
  // Korean Hancom (Hangul word processor) documents
  'hwp', 'hwpx',
  // Archives
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
  // Everything else Google Drive previews (support.google.com/drive/answer/37603),
  // so what it can show, an attachment here can too (components/previews).
  // Still no script types a browser would run (js/mjs stay out).
  'jpe', 'jfif', 'apng', 'ico', 'dib',
  'psd', 'ai', 'eps', 'ps', 'xps', 'oxps', 'dxf',
  'mkv', 'ogv', 'avi', 'wmv', 'flv', '3gp', 'mpg', 'mpeg',
  'opus', 'oga', 'flac', 'weba',
  'docm', 'dotx', 'xlsm', 'xlsb', 'pptm', 'ppsx', 'pps', 'pot', 'dot',
  'key', 'numbers', 'pages', 'wpd',
  'ttf', 'otf', 'woff', 'woff2',
  'tsv', 'srt', 'vtt', 'css', 'c', 'cpp', 'h', 'hpp', 'java', 'py',
  'tgz', 'xz',
]);

// text/* covers md/xml/yaml/log/plain/html, etc. — safe because the extension gate runs first and
// blocks executable types (js and other disallowed extensions). The video/audio/image prefixes
// allow every mime in those families.
// font/* too: a font is data, not code (ttf/otf/woff previews as a specimen)
export const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'text/', 'font/'];

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Korean Hancom (Hangul word processor) — .hwp / .hwpx (only sent when Hancom Office is
  // installed; otherwise browsers fall back to octet-stream/empty, handled below)
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwp',
  'application/vnd.hancom.hwpx',
  'application/hwp+zip',
  'text/plain',
  'text/csv',
  'application/json',
  'application/rtf',
  // OpenDocument
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-bzip2',
  'application/x-xz',
  // the Google-Drive-previewable rest (above) — what browsers label them with
  'application/postscript',
  'application/illustrator',
  'application/vnd.ms-xpsdocument',
  'application/oxps',
  'application/dxf',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.apple.keynote',
  'application/vnd.apple.numbers',
  'application/vnd.apple.pages',
  'application/x-iwork-keynote-sffkey',
  'application/x-iwork-numbers-sffnumbers',
  'application/x-iwork-pages-sffpages',
  'application/vnd.wordperfect',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/font-woff',
  'application/x-matroska',
  'application/vnd.rn-realmedia',
  'application/x-shockwave-flash',
]);

/** Extracts the extension (no node path dependency) — empty string when there is no dot or it ends in one. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

export type UploadTypeCheck =
  | { allowed: true }
  | { allowed: false; reason: 'ext' | 'mime'; ext: string; mimeType: string };

/**
 * Whether the extension and MIME type are allowed (size checks are the caller's job — the server
 * route and the client each enforce their own limit). The extension gate must pass first, and the
 * MIME must be one of prefix/allowlist/unknown. Browsers send "" or application/octet-stream for
 * formats the OS has no mapping for (e.g. .hwp without Hancom installed), so that is trusted once
 * the extension gate has passed.
 */
export function checkUploadType(fileName: string, mimeType: string): UploadTypeCheck {
  const ext = fileExtension(fileName);
  const mt = (mimeType || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return { allowed: false, reason: 'ext', ext, mimeType: mt };
  const isUnknownMime = mt === '' || mt === 'application/octet-stream';
  const mimeAllowed =
    ALLOWED_MIME_PREFIXES.some((p) => mt.startsWith(p)) ||
    ALLOWED_MIME_TYPES.has(mt) ||
    isUnknownMime;
  if (!mimeAllowed) return { allowed: false, reason: 'mime', ext, mimeType: mt };
  return { allowed: true };
}
