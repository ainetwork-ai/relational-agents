/**
 * Parses `Range: bytes=…` — builds the input for a partial storage read (`streamFile(bucket, key, range)`).
 *
 * Why it is needed: `<video>` seeking and iOS Safari playback **assume 206 Partial Content**.
 * Serve the whole file as 200 and Safari refuses to play at all, and other browsers cannot seek.
 * Our `streamFile` in `lib/files/storage.ts` accepted a range from the start, but no route
 * ever passed one (measured: `docs/notion-video.md` §4).
 *
 * Taken from ainteams `backend/src/domain/shared/http-range.ts`. Carrying over the warning in
 * its comment as-is — **copies always drift apart.** If the grammar ever needs a fix, look at both places.
 */

export interface ByteRange {
  /** inclusive */
  start: number;
  /** inclusive */
  end: number;
}

/**
 * A single byte-range per RFC 7233 §2.1. **Includes the suffix form (`bytes=-N`, the last N bytes).**
 *
 * The three return values mean different things:
 *   - `ByteRange` — **206** with that span.
 *   - `"unsatisfiable"` — grammatically valid but cannot be satisfied → **416**.
 *   - `null` — an unrecognised form (multiple ranges, etc.) or no header → **200 with the whole file**.
 *
 * Why `null` and `"unsatisfiable"` are kept apart: answering 416 to a request we could not even
 * parse breaks playback outright, whereas serving the whole file is merely slow but works. Conversely,
 * a valid range that falls outside the file is an error the client needs to know about.
 *
 * Why suffixes are supported: mp4/mov keep the container metadata (`moov`) at the **end** of the
 * file, so players probe with `bytes=-65536` first. Leave it unsupported and every such request sends
 * the **whole** file — silently expensive, the exact opposite of what Range is for.
 */
export function parseByteRange(
  header: string | null | undefined,
  totalSize: number
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // unsupported form (multiple ranges, etc.) → serve the whole file
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return "unsatisfiable"; // `bytes=-`
  if (!Number.isFinite(totalSize) || totalSize <= 0) return "unsatisfiable";

  let start: number;
  let end: number;
  if (rawStart === "") {
    const n = Number(rawEnd);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, totalSize - n);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    if (start >= totalSize) return "unsatisfiable";
    end = rawEnd === "" ? totalSize - 1 : Number(rawEnd);
    if (end < start) return "unsatisfiable";
  }

  return { start, end: Math.min(end, totalSize - 1) };
}

/** The `Content-Range: bytes * /<total>` a 416 has to carry. */
export function unsatisfiableContentRange(totalSize: number): string {
  return `bytes */${Math.max(0, totalSize)}`;
}
