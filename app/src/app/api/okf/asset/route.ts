import type { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "@/lib/auth/middleware";
import { decodeId, okfRoot } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";

// Serve a file asset (image/video/pdf…) that lives in the OKF tree. Exported
// Notion pages embed local files; parseMarkdown rewrites their relative URLs to
// `/api/okf/asset?p=<encoded OKF path>` so the browser can fetch them here.
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const p = req.nextUrl.searchParams.get("p");
  if (!p) return new Response("missing p", { status: 400 });
  let rel: string;
  try {
    rel = decodeId(p);
  } catch {
    return new Response("bad id", { status: 400 });
  }
  // attachments under participant-only paths are member-only (same gate as bodies)
  const gate = await okfGateFor(auth.user.id);
  if (!gate.canRead(rel)) return new Response("not found", { status: 404 });
  const root = okfRoot();
  const abs = path.resolve(root, rel);
  // never serve outside the OKF root
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new Response("not found", { status: 404 });
  }
  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  const buf = fs.readFileSync(abs);
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": type, "cache-control": "public, max-age=3600" },
  });
}
