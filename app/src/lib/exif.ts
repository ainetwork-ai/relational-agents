/**
 * The few EXIF fields a photo album needs — when, where, on what — read
 * straight out of a JPEG's APP1 segment. No dependency: the TIFF structure is
 * small, and anything unexpected just yields fewer fields.
 */
export interface PhotoExif {
  /** "YYYY-MM-DDTHH:MM:SS" as the camera wrote it (local time) */
  takenAt?: string;
  lat?: number;
  lon?: number;
  make?: string;
  model?: string;
}

export function readExif(buf: Buffer): PhotoExif {
  const out: PhotoExif = {};
  try {
    if (buf.readUInt16BE(0) !== 0xffd8) return out;
    let off = 2;
    while (off + 4 < buf.length) {
      if (buf[off] !== 0xff) break;
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker === 0xe1 && buf.toString("latin1", off + 4, off + 10) === "Exif\0\0") {
        parseTiff(buf.subarray(off + 10, off + 2 + len), out);
        break;
      }
      if (marker === 0xda) break; // image data — no EXIF ahead
      off += 2 + len;
    }
  } catch {
    /* truncated or odd file: what was read so far stands */
  }
  return out;
}

function parseTiff(t: Buffer, out: PhotoExif) {
  const le = t.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const ascii = (o: number, n: number) => t.toString("latin1", o, o + n).replace(/\0+$/, "").trim();
  const entries = (ifd: number) => {
    const n = u16(ifd);
    return Array.from({ length: n }, (_, i) => {
      const e = ifd + 2 + i * 12;
      const count = u32(e + 4);
      return { tag: u16(e), type: u16(e + 2), count, value: e + 8, ptr: u32(e + 8) };
    });
  };
  const str = (e: { count: number; value: number; ptr: number }) => (e.count <= 4 ? ascii(e.value, e.count) : ascii(e.ptr, e.count));
  const rationals = (e: { count: number; ptr: number }) =>
    Array.from({ length: e.count }, (_, i) => u32(e.ptr + i * 8) / (u32(e.ptr + i * 8 + 4) || 1));
  let exifIfd = 0;
  let gpsIfd = 0;
  for (const e of entries(u32(4))) {
    if (e.tag === 0x010f) out.make = str(e);
    if (e.tag === 0x0110) out.model = str(e);
    if (e.tag === 0x0132 && !out.takenAt) out.takenAt = isoOf(str(e));
    if (e.tag === 0x8769) exifIfd = e.ptr;
    if (e.tag === 0x8825) gpsIfd = e.ptr;
  }
  if (exifIfd) for (const e of entries(exifIfd)) if (e.tag === 0x9003) out.takenAt = isoOf(str(e));
  if (gpsIfd) {
    let latRef = "N", lonRef = "E", lat: number[] | null = null, lon: number[] | null = null;
    for (const e of entries(gpsIfd)) {
      if (e.tag === 1) latRef = str(e);
      if (e.tag === 2) lat = rationals(e);
      if (e.tag === 3) lonRef = str(e);
      if (e.tag === 4) lon = rationals(e);
    }
    const deg = (v: number[]) => v[0] + (v[1] ?? 0) / 60 + (v[2] ?? 0) / 3600;
    if (lat) out.lat = deg(lat) * (latRef === "S" ? -1 : 1);
    if (lon) out.lon = deg(lon) * (lonRef === "W" ? -1 : 1);
  }
}

/** "2026:10:03 14:10:00" → "2026-10-03T14:10:00" */
function isoOf(s: string): string | undefined {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : undefined;
}
