import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", heic: "image/heic", pdf: "application/pdf",
};

/** Serve user uploads from public/uploads. A route (not static) so files
 * written after the build are still served — `next start` does not serve
 * post-build public assets, and Vercel's FS is ephemeral. */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
 // no traversal: a bare filename only
  if (!/^[\w.-]+$/.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "bad name" }, { status: 400 });
  }
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "uploads", name));
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
