import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rename, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileExtension } from "./allowed-types";
import {
  buildStorageUrl,
  contentKey,
  isStorageConfigured,
  putStream,
  statFile,
  storageBucket,
} from "./storage";
import { TUS_LOCAL_DIRECTORY } from "./tus-server-config";
import { servePathForKey } from "./client-url";

/**
 * Promote a finished tus upload to the storage contract.
 *
 * tus only knows how to pile bytes under its own id. The contract — **key =
 * the content's SHA-256**, url = an opaque `s3://` token, same bytes = one
 * object — is ours, and this is where the handoff happens.
 *
 * The hash is streamed. `arrayBuffer()` does not exist at a gigabyte, which is
 * the whole reason the upload became resumable in the first place.
 *
 * Idempotent on purpose: a client retry can re-run the finish hook, and the
 * `statFile` pre-check absorbs the second promotion instead of re-uploading.
 * That same check is the deduplication — the tenth person to attach the same
 * pdf writes no bytes at all.
 *
 * With no MinIO configured this keeps today's behaviour exactly: the staged
 * file is moved into public/uploads under a random name.
 */
export interface FinalizedUpload {
  /** what the browser may hold: the key-addressed serving path, or a disk path */
  url: string;
  /** the `s3://` token a row stores — server-side only, never sent to a client */
  storageUrl?: string;
  name: string;
  size: number;
  mimeType: string;
}

export async function finalizeTusUpload(upload: {
  id: string;
  size: number;
  metadata?: Record<string, string | null> | null;
}): Promise<FinalizedUpload> {
  const name = upload.metadata?.filename || "file";
  const mimeType = upload.metadata?.filetype || "application/octet-stream";
  const staged = path.join(TUS_LOCAL_DIRECTORY, upload.id);
  const ext = (fileExtension(name) || "bin").replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";

  if (!isStorageConfigured()) {
   // disk mode — unchanged from before object storage existed
    const stored = `${randomUUID()}.${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await rename(staged, path.join(dir, stored));
    return { url: `/uploads/${stored}`, name, size: upload.size, mimeType };
  }

  const hash = await sha256File(staged);
  const key = contentKey(hash, ext);
  const bucket = storageBucket();

 // already there? then this is either a duplicate upload or a retried finish
  const existing = await statFile(bucket, key);
  if (!existing) {
    const size = (await stat(staged)).size;
    await putStream(key, createReadStream(staged), size, mimeType);
  }
 // The client gets the serving path, not the token. It was handing the raw
 // s3:// url back to us (and, in the AI chat, writing it into the message
 // body, where it neither rendered nor belonged); a row derives the token from
 // the path on the server instead — storageRefFromClientUrl.
  return {
    url: servePathForKey(key),
    storageUrl: buildStorageUrl(bucket, key),
    name,
    size: upload.size,
    mimeType,
  };
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(file);
    s.on("data", (c) => h.update(c));
    s.on("error", reject);
    s.on("end", () => resolve(h.digest("hex")));
  });
}
