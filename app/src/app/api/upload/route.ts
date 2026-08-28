import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireAuth } from "@/lib/auth/middleware";
import { getMaxUploadBytes } from "@/lib/files/upload-limit";
import { checkUploadType } from "@/lib/files/allowed-types";
import { createHash } from "crypto";
import {
  buildStorageUrl,
  contentKey,
  isStorageConfigured,
  putFile,
  statFile,
  storageBucket,
} from "@/lib/files/storage";

export const runtime = "nodejs";

// This path reads the whole body with formData() and is therefore not safe for
// large files; the real attachment ceiling lives with the tus path. Here the
// cap is whatever buffering can take — but an operator who LOWERS
// MAX_UPLOAD_MB must not find this route as a way around it, so take the
// smaller of the two.
const BUFFERED_CAP_BYTES = 50 * 1024 * 1024;
const maxBufferedBytes = () => Math.min(BUFFERED_CAP_BYTES, getMaxUploadBytes());

// The image-only allowlist for the default (non-file) path — an avatar or a
// cover is not a general attachment.
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

/** Blob upload: stores a file under public/uploads and returns its served URL. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  const maxBytes = maxBufferedBytes();
  if (file.size > maxBytes) {
    return NextResponse.json(
      {
        error: `File size ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit`,
      },
      { status: 413 }
    );
  }
 // kind=file → generic attachment (any type); default keeps the image allowlist
  const generic = form.get("kind") === "file";
  if (!generic && file.type && !ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "unsupported type" }, { status: 415 });
  }
 // a general attachment goes through the shared allowlist — the same one the
 // client pre-checks with, so a refusal here is one the user already saw
  if (generic) {
    const check = checkUploadType(file.name, file.type);
    if (!check.allowed)
      return NextResponse.json(
        {
          error:
            check.reason === "ext"
              ? `File type ".${check.ext}" is not allowed`
              : `File type "${check.mimeType}" is not allowed`,
          reason: check.reason,
        },
        { status: 415 }
      );
  }

  const ext = (file.name.split(".").pop() || "bin")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const bytes = Buffer.from(await file.arrayBuffer());

 // Object storage, when it is configured. Callers of this route (avatar, page
 // cover, workspace icon, home cover) put the returned value straight into an
 // <img src> and have no row to address it by, so they get the key-addressed
 // serving path — the same one the migration wrote into blocks.content. That
 // way nothing new lands on disk and /uploads/* can eventually go away.
  if (isStorageConfigured()) {
    const key = contentKey(createHash("sha256").update(bytes).digest("hex"), ext);
    const bucket = storageBucket();
    if (!(await statFile(bucket, key))) await putFile(key, bytes, file.type || undefined);
    return NextResponse.json({
      url: `/api/files/key/${key}`,
      storageUrl: buildStorageUrl(bucket, key),
      name: file.name,
      size: file.size,
    });
  }
 // The real extension is kept. html/htm/svg used to be flattened to .txt here
 // because /uploads/* is served same-origin; next.config.ts now serves that
 // path with `Content-Security-Policy: sandbox` + `nosniff`, which stops the
 // script without mangling the file. Undo that header and this has to come
 // back (see allowed-types.ts).
  const name = `${crypto.randomUUID()}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);

  return NextResponse.json({ url: `/uploads/${name}`, name: file.name, size: file.size });
}
