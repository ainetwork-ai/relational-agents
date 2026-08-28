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
import { parseStorageUrl, streamFile } from "./storage";

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

/**
 * Open the bytes, wherever they are. `s3://` goes to object storage; a legacy
 * `/uploads/<name>` still comes off disk, so the migration can move files
 * without the read path caring which have moved.
 */
export async function openFileBytes(
  fileUrl: string
): Promise<{ stream: Readable; size?: number } | null> {
  const parsed = parseStorageUrl(fileUrl);
  if (parsed) return { stream: await streamFile(parsed.bucket, parsed.key) };

  if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(fileUrl)) return null;
  const abs = path.join(process.cwd(), "public", fileUrl.replace(/^\//, ""));
  const s = await stat(abs).catch(() => null);
  if (!s) return null;
  return { stream: createReadStream(abs), size: s.size };
}

/** Node stream → the Response body a route handler returns. */
export function toWebStream(stream: Readable): ReadableStream {
  return stream as unknown as ReadableStream;
}
