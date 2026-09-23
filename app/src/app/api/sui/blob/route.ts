import { NextResponse } from "next/server";
import {
  NOTE_BLOB_ID,
  PHOTO_BLOB_ID,
  WALLET_NOTE_BLOB_ID,
  PLAINTEXT_MARKER,
  walrusBlobUrl,
} from "@/lib/sui/demo";

export const dynamic = "force-dynamic";

/** Only the two blobs the /sui demo talks about — this is not an open proxy. */
const ALLOWED = new Set([NOTE_BLOB_ID, PHOTO_BLOB_ID, WALLET_NOTE_BLOB_ID]);

const HEAD_BYTES = 48;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Printable ASCII as itself, everything else as a dot — the xxd right column. */
function toAscii(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
    .join("");
}

/**
 * GET /api/sui/blob?id=<blobId>[&raw=1]
 *
 * Fetches the ciphertext from the Walrus testnet aggregator server-side (the
 * aggregator sends no CORS headers a browser will accept) and returns the head
 * of it plus the one check the demo turns on: the plaintext marker is not in
 * there. We serve this blob and we cannot read it either.
 *
 * With `raw=1` the whole ciphertext comes back as bytes instead, which is what
 * the in-browser Seal attempt feeds to `SealClient.decrypt`. Handing the bytes
 * over changes nothing: without a key server's share they stay unreadable.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get("id") ?? NOTE_BLOB_ID;
  const raw = params.get("raw") === "1";
  if (!ALLOWED.has(id)) {
    return NextResponse.json({ error: "unknown blob" }, { status: 400 });
  }

  const url = walrusBlobUrl(id);
  let buf: ArrayBuffer;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Walrus aggregator returned HTTP ${res.status}`, url },
        { status: 502 }
      );
    }
    buf = await res.arrayBuffer();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), url },
      { status: 502 }
    );
  }

  const all = new Uint8Array(buf);

  if (raw) {
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(all.byteLength),
        "Cache-Control": "no-store",
      },
    });
  }

  const head = all.slice(0, HEAD_BYTES);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(all);

  return NextResponse.json({
    blobId: id,
    url,
    totalBytes: all.byteLength,
    headBytes: head.byteLength,
    hex: toHex(head),
    ascii: toAscii(head),
    marker: PLAINTEXT_MARKER,
    containsMarker: text.includes(PLAINTEXT_MARKER),
    fetchedAt: new Date().toISOString(),
  });
}
