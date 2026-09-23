// Reads the family/style names out of a font's `name` table so the specimen
// can show "Nanum Barun Gothic · Regular" instead of the file name. Handles
// sfnt (ttf/otf/ttc) and WOFF 1; WOFF2's tables are Brotli-packed with a
// transformed directory, so callers fall back to the file name for it.

export type FontNames = { family?: string; style?: string; full?: string };

type Table = { offset: number; length: number; compLength: number };

function tag(v: DataView, o: number): string {
  return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<DataView> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new DataView(await new Response(stream).arrayBuffer());
}

async function nameTable(buf: ArrayBuffer): Promise<DataView | null> {
  const v = new DataView(buf);
  let sig = tag(v, 0);
  let base = 0;
  if (sig === "ttcf") { base = v.getUint32(12); sig = tag(v, base); }
  if (sig === "wOFF") {
    const n = v.getUint16(12);
    for (let i = 0; i < n; i++) {
      const r = 44 + i * 20;
      if (tag(v, r) !== "name") continue;
      const t: Table = { offset: v.getUint32(r + 4), compLength: v.getUint32(r + 8), length: v.getUint32(r + 12) };
      const raw = new Uint8Array(buf, t.offset, t.compLength);
      return t.compLength < t.length ? inflate(raw) : new DataView(buf, t.offset, t.length);
    }
    return null;
  }
  // sfnt: 0x00010000 (TrueType), "OTTO" (CFF), "true"
  const n = v.getUint16(base + 4);
  for (let i = 0; i < n; i++) {
    const r = base + 12 + i * 16;
    if (tag(v, r) === "name") return new DataView(buf, v.getUint32(r + 8), v.getUint32(r + 12));
  }
  return null;
}

/** Best-effort; returns {} for anything it can't read (e.g. WOFF2). */
export async function readFontNames(buf: ArrayBuffer): Promise<FontNames> {
  try {
    const t = await nameTable(buf);
    if (!t) return {};
    const count = t.getUint16(2), strings = t.getUint16(4);
    // Rank: Windows Unicode en-US > any Windows Unicode > Mac Roman.
    const best = new Map<number, { rank: number; value: string }>();
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12;
      const platform = t.getUint16(r), lang = t.getUint16(r + 4), id = t.getUint16(r + 6);
      const len = t.getUint16(r + 8), off = strings + t.getUint16(r + 10);
      if (![1, 2, 4, 16, 17].includes(id) || off + len > t.byteLength) continue;
      let value: string, rank: number;
      if (platform === 3 || platform === 0) {
        value = new TextDecoder("utf-16be").decode(new Uint8Array(t.buffer, t.byteOffset + off, len));
        rank = platform === 3 && lang === 0x409 ? 3 : 2;
      } else if (platform === 1) {
        value = new TextDecoder("latin1").decode(new Uint8Array(t.buffer, t.byteOffset + off, len));
        rank = 1;
      } else continue;
      if (value && (best.get(id)?.rank ?? 0) < rank) best.set(id, { rank, value });
    }
    const get = (id: number) => best.get(id)?.value;
    // 16/17 = typographic family/subfamily (groups weights under one family).
    return { family: get(16) ?? get(1), style: get(17) ?? get(2), full: get(4) };
  } catch {
    return {};
  }
}
