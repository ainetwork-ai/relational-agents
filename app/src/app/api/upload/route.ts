import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireAuth } from "@/lib/auth/middleware";

export const runtime = "nodejs";

// image/svg+xml is excluded — an SVG opened same-origin can run scripts
// (stored XSS), so it is not accepted as an image attachment.
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Blob upload: stores a file under public/uploads and returns its served URL. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }
  // kind=file → generic attachment (any type); default keeps the image allowlist
  const generic = form.get("kind") === "file";
  if (!generic && file.type && !ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "unsupported type" }, { status: 415 });
  }

  let ext = (file.name.split(".").pop() || "bin")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  // never store any upload under a same-origin browser-executable extension —
  // applies to every path (not just kind=file), so a mislabeled svg/html can't
  // land as an executable same-origin document (stored XSS).
  if (["html", "htm", "xhtml", "svg", "js", "mjs"].includes(ext)) ext = "txt";
  const name = `${crypto.randomUUID()}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ url: `/uploads/${name}`, name: file.name });
}
