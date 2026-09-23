import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import type { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments, files } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/middleware";
import { requirePagePermission } from "@/lib/auth/share-token";
import { parseStorageUrl, statFile, streamFile } from "./storage";
import type { ByteRange } from "./http-range";

/**
 * What both proxy routes need before they can send a byte.
 *
 * The bytes never leave object storage directly — MinIO's port is not
 * published and there are no presigned URLs — so this is the only door, and
 * the permission check lives here rather than in each route.
 *
 * A file inherits the access of the comment it hangs off, which inherits the
 * page's. Anyone who may read the page may read its attachments.
 */
export async function loadServableFile(id: string) {
  const auth = await requireAuth();
  if ("error" in auth) return { error: auth.error } as const;

  const [row] = await db.select().from(files).where(eq(files.id, id)).limit(1);
 // 404, not 403, for a file that exists but is not yours — a stranger should
 // not learn it exists
  if (!row) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;

  const [comment] = await db
    .select({ pageId: comments.pageId })
    .from(comments)
    .where(eq(comments.id, row.commentId))
    .limit(1);
  if (!comment)
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;

  const allowed = await requirePagePermission(comment.pageId, auth.user.id, "view");
  if (allowed !== true)
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;

  return { row } as const;
}

/** The on-disk path a legacy `/uploads/<name>` refers to, or null if it is not one.
 *  `..` matches the character class but would resolve to public/ itself and hand
 *  createReadStream a directory. */
function localUploadPath(fileUrl: string): string | null {
  if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(fileUrl) || fileUrl.includes("..")) return null;
  return path.join(process.cwd(), "public", fileUrl.replace(/^\//, ""));
}

/**
 * How many bytes the file has — the denominator a `Range` request is parsed
 * against. `files.file_size` is the cheap answer but it can be null or stale,
 * so this asks the store when it has to.
 */
export async function fileByteSize(fileUrl: string): Promise<number | null> {
  const parsed = parseStorageUrl(fileUrl);
  if (parsed) return (await statFile(parsed.bucket, parsed.key))?.size ?? null;
  const abs = localUploadPath(fileUrl);
  if (!abs) return null;
  return (await stat(abs).catch(() => null))?.size ?? null;
}

/**
 * Open the bytes, wherever they are. `s3://` goes to object storage; a legacy
 * `/uploads/<name>` still comes off disk, so the migration can move files
 * without the read path caring which have moved.
 *
 * `range` is inclusive on both ends and serves media seeking: without it a
 * `<video>` cannot seek and iOS Safari refuses to play at all
 * (docs/notion-video.md §4). Neither branch reads the whole file into memory —
 * MinIO does a partial GET, disk uses a start/end read stream.
 */
export async function openFileBytes(
  fileUrl: string,
  range?: ByteRange
): Promise<{ stream: Readable; size?: number } | null> {
  const parsed = parseStorageUrl(fileUrl);
  if (parsed) return { stream: await streamFile(parsed.bucket, parsed.key, range) };

  const abs = localUploadPath(fileUrl);
  if (!abs) return null;
  const s = await stat(abs).catch(() => null);
  if (!s) return null;
  return {
    stream: range ? createReadStream(abs, { start: range.start, end: range.end }) : createReadStream(abs),
    size: s.size,
  };
}

/** Node stream → the Response body a route handler returns. */
export function toWebStream(stream: Readable): ReadableStream {
  return stream as unknown as ReadableStream;
}

// the url-shape helpers live in client-url.ts (no Next/db imports, so the
// contract checks can load them under plain tsx); re-exported for callers here
export { isServableAssetUrl, servePathForKey, storageRefFromClientUrl } from "./client-url";
