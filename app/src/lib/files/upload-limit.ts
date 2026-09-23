// The attachment ceiling, server-side only.
//
// Not in allowed-types.ts on purpose: that module is bundled for the browser
// too, and `MAX_UPLOAD_MB` is not NEXT_PUBLIC, so it reads as undefined there —
// the client would silently fall back to the default and never know an
// operator had lowered the limit. The client asks `GET /api/upload/limits`
// instead, which also keeps the value out of the build.
//
// The other caps are deliberately independent of this one: the buffered
// /api/upload path has its own safety cap (it reads the whole body into
// memory), and an avatar has a purpose-limit far below either.
//
// Ported from ainteams (web/src/lib/files/upload-limit.ts).

export const DEFAULT_MAX_UPLOAD_MB = 1024;

const MB = 1024 * 1024;

/**
 * Parse `MAX_UPLOAD_MB`. Anything that is not a positive integer falls back to
 * the default and says so — a typo must not quietly mean "unlimited" or "0".
 */
export function getMaxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_MB;
  if (!raw) return DEFAULT_MAX_UPLOAD_MB * MB;
  const mb = Number(raw);
  if (!Number.isInteger(mb) || mb < 1) {
    console.error(
      `[upload-limit] MAX_UPLOAD_MB is not usable ("${raw}") — falling back to ${DEFAULT_MAX_UPLOAD_MB}MB. It must be a positive integer number of MB.`
    );
    return DEFAULT_MAX_UPLOAD_MB * MB;
  }
  return mb * MB;
}
