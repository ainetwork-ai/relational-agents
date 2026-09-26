import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { DEMO_VIDEO_FILE } from "@/lib/world-demo";

export const dynamic = "force-dynamic";

/**
 * The narrated demo for /world, streamed with what a <video> needs: its type
 * and byte ranges (Safari will not play a file it cannot range-request). The
 * file lives in the deploy's uploads volume, not in git (*.mp4 is ignored),
 * and /uploads serves every file as a download without ranges, so the video
 * has a route of its own.
 */
export async function GET(req: Request): Promise<Response> {
  let size: number;
  try {
    size = statSync(DEMO_VIDEO_FILE).size;
  } catch {
    return new Response("The demo video is not on this server.", { status: 404 });
  }
  const headers: Record<string, string> = {
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=3600",
  };
  const range = req.headers.get("range");
  if (!range) {
    const body = Readable.toWeb(createReadStream(DEMO_VIDEO_FILE)) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers: { ...headers, "content-length": String(size) } });
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  const start = m ? (m[1] ? Number(m[1]) : size - Number(m[2] || NaN)) : NaN;
  const end = m && m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (!Number.isInteger(start) || start < 0 || start >= size || end < start)
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  const body = Readable.toWeb(createReadStream(DEMO_VIDEO_FILE, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}
