import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { statFile, storageBucket, streamFile } from "@/lib/files/storage";
import { isStreamableMedia } from "@/lib/files/streamable-media";
import { toWebStream } from "@/lib/files/serve";

export const dynamic = "force-dynamic";

/**
 * GET /api/files/key/files/<sha256>.<ext> — bytes addressed by their key.
 *
 * The id-addressed routes cover comment attachments, which have a `files` row
 * and therefore an owner and a page to inherit permission from. Page block
 * images and page covers do not: they are referenced by URL from inside
 * `blocks.content` and `pages.cover_url`, with no row of their own. This is
 * the door for those.
 *
 * Access is "any signed-in user". That is **stricter than what it replaces** —
 * today those files sit at /uploads/* and are served to anyone at all, with no
 * session required. Tightening it to per-page would mean giving every block
 * asset a row, which is a bigger change than this migration.
 *
 * The same media gate applies: anything isStreamableMedia refuses is handed
 * back as a download, never rendered as a document in our origin.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const key = (await params).key.join("/");
 // only our own content keys — no traversal, no reaching other prefixes
  if (!/^files\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/.test(key))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bucket = storageBucket();
  const head = await statFile(bucket, key).catch(() => null);
  if (!head) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ext = key.split(".").pop() ?? "";
  const mimeType = MIME[ext] ?? "";
  const inline = isStreamableMedia(mimeType, `x.${ext}`);

  return new NextResponse(toWebStream(await streamFile(bucket, key)), {
    headers: {
      "Content-Type": inline ? mimeType : "application/octet-stream",
      "Content-Disposition": inline ? "inline" : `attachment; filename="${key.split("/").pop()}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(head.size),
     // the key IS the content hash, so the bytes behind it can never change
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

/** Extension → type, for the handful we serve inline. Anything absent here
 *  falls through to a download, which is the safe direction. */
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
};
