import { NextResponse } from "next/server";
import { loadServableFile, openFileBytes, toWebStream } from "@/lib/files/serve";

export const dynamic = "force-dynamic";

/**
 * GET → the file, always as a download.
 *
 * `Content-Disposition: attachment` is fixed and the content type is
 * deliberately generic: this route must never render anything as a document in
 * our origin. That guarantee, together with the stream route's media gate, is
 * what allows html/htm and svg into the upload allowlist.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadServableFile(id);
  if ("error" in loaded) return loaded.error;

  const bytes = await openFileBytes(loaded.row.fileUrl);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const name = loaded.row.fileName.replace(/["\\\r\n]/g, "_");
  return new NextResponse(toWebStream(bytes.stream), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(loaded.row.fileName)}; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      ...(loaded.row.fileSize ? { "Content-Length": String(loaded.row.fileSize) } : {}),
    },
  });
}
