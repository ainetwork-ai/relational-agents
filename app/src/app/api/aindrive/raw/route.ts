import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { AindriveError, cleanPath, linkAllowed, readFileBytes } from "@/lib/aindrive";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", jfif: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon",
  svg: "image/svg+xml", apng: "image/apng", tif: "image/tiff", tiff: "image/tiff",
  pdf: "application/pdf", ai: "application/pdf",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus",
  m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", weba: "audio/webm",
  txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
  json: "application/json", html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", xml: "application/xml",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  zip: "application/zip",
};
// types a browser would render as an active document on our origin
const ACTIVE = new Set(["html", "htm", "svg", "xml", "xhtml"]);

/**
 * GET ?drive=<id>&path=<file>[&download=1] → the file's bytes, read over
 * aindrive's MCP. What an aindrive link in a page previews through.
 *
 * Signed-in people only, and only inside the folders this deployment offers
 * (the same scope any of them could link from Home) — the aindrive token is
 * shared, so the link a page holds must not reach past that.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const driveId = req.nextUrl.searchParams.get("drive") ?? "";
  let path: string;
  try {
    path = cleanPath(req.nextUrl.searchParams.get("path") ?? "");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!driveId || !path) return NextResponse.json({ error: "drive and path required" }, { status: 400 });
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (!linkAllowed({ driveId, root: dir }))
    return NextResponse.json({ error: "This file is outside the aindrive folders offered here" }, { status: 403 });

  let bytes: Buffer;
  try {
    bytes = await readFileBytes({ driveId, root: "" }, path);
  } catch (e) {
    const msg = (e as Error).message;
    const status = !(e instanceof AindriveError)
      ? 500
      : /\[forbidden\]/.test(msg)
        ? 403
        : /\[not_found\]|ENOENT/.test(msg)
          ? 404
          : /\[too_large\]/.test(msg)
            ? 413
            : 502;
    return NextResponse.json({ error: msg }, { status });
  }

  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const download = req.nextUrl.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "content-length": String(bytes.length),
    "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=60",
  };
  // an html/svg opened directly must not run as a page of this app
  if (ACTIVE.has(ext)) headers["content-security-policy"] = "sandbox";
  return new NextResponse(new Uint8Array(bytes), { headers });
}
