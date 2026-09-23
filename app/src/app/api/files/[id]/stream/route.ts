import { NextResponse } from "next/server";
import { fileByteSize, loadServableFile, openFileBytes, toWebStream } from "@/lib/files/serve";
import { isStreamableMedia, isTimedMedia, resolveContentType } from "@/lib/files/streamable-media";
import { parseByteRange, unsatisfiableContentRange } from "@/lib/files/http-range";

export const dynamic = "force-dynamic";

/**
 * GET → the file inline, for <img>/<video>/<audio>.
 *
 * Only what isStreamableMedia() passes: an uploaded html or svg served inline
 * would run its script in our origin. Anything else is 415 and belongs on the
 * download route.
 *
 * **Honours `Range` with 206.** A <video> cannot seek without it, and iOS
 * Safari refuses to play a source that answers a Range request with 200 at all
 * (docs/notion-video.md §4 — the gap that made video unusable here even though
 * the storage layer took a range from the start).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadServableFile(id);
  if ("error" in loaded) return loaded.error;

  const { mimeType, fileName } = loaded.row;
  if (!isStreamableMedia(mimeType ?? "", fileName))
    return NextResponse.json(
      { error: "This file is not servable inline — use the download route" },
      { status: 415 }
    );

 // the row's value first, the store only when it has none — a Range must be
 // parsed against the real length or the last chunk of every seek is wrong
  const total = loaded.row.fileSize ?? (await fileByteSize(loaded.row.fileUrl));
  const contentType = resolveContentType(mimeType, fileName);
  const timed = isTimedMedia(mimeType, fileName);

  const spec = total ? parseByteRange(req.headers.get("range"), total) : null;
  if (spec === "unsatisfiable")
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": unsatisfiableContentRange(total ?? 0), "Accept-Ranges": "bytes" },
    });

  const bytes = await openFileBytes(loaded.row.fileUrl, spec ?? undefined);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  };
 // advertise Range for anything the player might seek in; a still image has
 // nothing to seek, so we do not invite partial requests it will never make
  if (timed || spec) headers["Accept-Ranges"] = "bytes";

  if (spec) {
    headers["Content-Range"] = `bytes ${spec.start}-${spec.end}/${total}`;
    headers["Content-Length"] = String(spec.end - spec.start + 1);
    return new NextResponse(toWebStream(bytes.stream), { status: 206, headers });
  }

  if (total) headers["Content-Length"] = String(total);
  return new NextResponse(toWebStream(bytes.stream), { headers });
}
