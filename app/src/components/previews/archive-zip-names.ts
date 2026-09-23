// Recovers zip entry names written in a legacy code page (CP949/EUC-KR,
// Shift_JIS, GBK — what Windows Explorer and old Korean archivers produce).
// libarchive.js decodes every name as UTF-8 and the wasm build has no other
// locales, so those names arrive as U+FFFD soup. We read the raw name bytes
// from the central directory and decode them ourselves.

const LEGACY_ENCODINGS = ["euc-kr", "shift_jis", "gbk", "windows-1252"];

function decodeLegacy(bytes: Uint8Array): string {
  for (const enc of LEGACY_ENCODINGS) {
    try { return new TextDecoder(enc, { fatal: true }).decode(bytes); } catch { /* next */ }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Entry names in libarchive's listing order (central-directory records sorted
 * by local-header offset), or null when the file isn't a zip or every name is
 * already valid UTF-8 (nothing to fix).
 */
export function legacyZipNames(buf: ArrayBuffer): string[] | null {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  if (b.length < 22 || v.getUint32(0, true) !== 0x04034b50) return null;
  // End-of-central-directory record: last 22 bytes + up to 64 KiB comment.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const recs: Array<{ offset: number; name: string }> = [];
  let legacy = false;
  for (let n = 0; n < count; n++) {
    // Zip64 archives (0xffffffff offsets) or a truncated directory: give up.
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) return null;
    const flags = v.getUint16(p + 8, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const raw = b.subarray(p + 46, p + 46 + nameLen);
    let name: string;
    if (flags & 0x800) name = new TextDecoder("utf-8").decode(raw); // EFS: declared UTF-8
    else {
      try { name = utf8.decode(raw); } catch { name = decodeLegacy(raw); legacy = true; }
    }
    recs.push({ offset: v.getUint32(p + 42, true), name });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!legacy) return null;
  return recs.sort((a, c) => a.offset - c.offset).map((r) => r.name);
}
