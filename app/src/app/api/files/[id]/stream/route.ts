import { NextResponse } from "next/server";
import { loadServableFile, openFileBytes, toWebStream } from "@/lib/files/serve";
import { isStreamableMedia } from "@/lib/files/streamable-media";

export const dynamic = "force-dynamic";

/**
 * GET → the file inline, for <img>/<video>/<audio>.
 *
 * Only what isStreamableMedia() passes: an uploaded html or svg served inline
 * would run its script in our origin. Anything else is 415 and belongs on the
 * download route.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadServableFile(id);
  if ("error" in loaded) return loaded.error;

  const { mimeType, fileName } = loaded.row;
  if (!isStreamableMedia(mimeType ?? "", fileName))
    return NextResponse.json(
      { error: "This file is not servable inline — use the download route" },
      { status: 415 }
    );

  const bytes = await openFileBytes(loaded.row.fileUrl);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(toWebStream(bytes.stream), {
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      ...(loaded.row.fileSize ? { "Content-Length": String(loaded.row.fileSize) } : {}),
    },
  });
}
