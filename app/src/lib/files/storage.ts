// No `server-only` marker: the minio SDK and node streams make this
// unbuildable for the browser anyway, and the marker cannot be resolved
// outside Next's bundler, which would put the contract check out of reach.
import { Client } from "minio";
import type { Readable } from "node:stream";

/**
 * Object storage (self-hosted MinIO) — where the bytes live.
 *
 * The split this introduces, and the reason for it:
 *
 *   bytes        MinIO, keyed by the content's own SHA-256 (`contentKey`)
 *   facts        Postgres — who attached what, where, under what name
 *   derived      thumbnails and the like, regenerable, never authoritative
 *
 * A pg_dump preserves the `s3://` STRING, not the bytes, so the two have to be
 * backed up separately and neither alone can restore. That separation is also
 * what removes the nightly `docker pause`: an object mirror reads through the
 * API and does not need the app frozen, which a tar of a live directory does.
 *
 * MinIO's port is never published. Bytes leave only through the app's own
 * proxy routes, so access control is ours and there are no presigned URLs
 * escaping into caches and chat logs.
 *
 * Ported from ainteams (web/src/lib/files/storage.ts), trimmed to what ainmem
 * needs. **Nothing here changes behaviour until something calls it**: with no
 * MINIO_* env, `isStorageConfigured()` is false and every caller keeps its
 * current disk path.
 */

const DEFAULT_BUCKET = "ainmem-files";

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY
  );
}

export function storageBucket(): string {
  return process.env.MINIO_BUCKET || DEFAULT_BUCKET;
}

/**
 * The one reader of the MINIO_* connection env. Two SDKs reading the same
 * variables and disagreeing about, say, whether a port is part of the host is
 * a bug that only shows up in one of them.
 *
 * `MINIO_ENDPOINT` is `host` or `host:port`, optionally with a scheme.
 */
export function minioConnection(): {
  host: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
} {
  const raw = process.env.MINIO_ENDPOINT ?? "";
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  const u = new URL(withScheme);
  const useSSL = process.env.MINIO_USE_SSL === "1" || u.protocol === "https:";
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : useSSL ? 443 : 9000,
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY ?? "",
    secretKey: process.env.MINIO_SECRET_KEY ?? "",
  };
}

let client: Client | null = null;
function getClient(): Client {
  if (client) return client;
  if (!isStorageConfigured())
    throw new Error(
      "[storage] MinIO is not configured — MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY are required. Callers must check isStorageConfigured() and fall back to disk."
    );
  const c = minioConnection();
  client = new Client({
    endPoint: c.host,
    port: c.port,
    useSSL: c.useSSL,
    accessKey: c.accessKey,
    secretKey: c.secretKey,
  });
  return client;
}

/** `s3://<bucket>/<key>` — the opaque token a database row stores. */
export function buildStorageUrl(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}

export function parseStorageUrl(url: string): { bucket: string; key: string } | null {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(url);
  return m ? { bucket: m[1], key: m[2] } : null;
}

export function isStorageUrl(url: string): boolean {
  return parseStorageUrl(url) !== null;
}

/**
 * Key = the content's SHA-256. The same bytes are therefore one object however
 * many times they are uploaded, and the file NAME is deliberately not in the
 * key — two people uploading the same pdf under different names must still
 * share the object, and the names belong to the database rows.
 */
export function contentKey(hash: string, ext: string): string {
  return `files/${hash}.${ext}`;
}

/** Derived, regenerable — a separate namespace so a backup can skip it. */
export function thumbnailKey(originalKey: string, width: number): string | null {
  const m = /^files\/([0-9a-f]{64})\.[a-z0-9]+$/.exec(originalKey);
  if (!m || !Number.isInteger(width) || width <= 0) return null;
  return `thumbs/${m[1]}_${width}.webp`;
}

let bucketReady = false;
/** Lazily create the bucket. A fresh install has none, and the first write
 *  must not be the one that discovers that. */
export async function ensureStorageBucket(): Promise<void> {
  if (bucketReady) return;
  const bucket = storageBucket();
  const c = getClient();
  if (!(await c.bucketExists(bucket).catch(() => false))) {
    await c.makeBucket(bucket).catch((e: unknown) => {
     // a concurrent request may have won the race
      const code = (e as { code?: string }).code;
      if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") throw e;
    });
  }
  bucketReady = true;
}

export async function putFile(key: string, data: Buffer, mimeType?: string): Promise<string> {
  await ensureStorageBucket();
  const bucket = storageBucket();
  await getClient().putObject(bucket, key, data, data.length, {
    "Content-Type": mimeType || "application/octet-stream",
  });
  return buildStorageUrl(bucket, key);
}

/** Stream a local file in, without holding it in memory — the upload path. */
export async function putStream(
  key: string,
  stream: Readable,
  size: number,
  mimeType?: string
): Promise<string> {
  await ensureStorageBucket();
  const bucket = storageBucket();
  await getClient().putObject(bucket, key, stream, size, {
    "Content-Type": mimeType || "application/octet-stream",
  });
  return buildStorageUrl(bucket, key);
}

/**
 * null when the object is not there. NoSuchBucket counts as "not there" on
 * purpose: on empty storage the dedup lookup legitimately runs before any
 * write, and throwing here made ainteams' very first upload a 500.
 */
export async function statFile(
  bucket: string,
  key: string
): Promise<{ size: number; etag?: string } | null> {
  try {
    const s = await getClient().statObject(bucket, key);
    return { size: s.size, etag: s.etag };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "NotFound" || code === "NoSuchKey" || code === "NoSuchBucket") return null;
    throw e;
  }
}

/** Read bytes out — the proxy route's source. `range` serves media seeking. */
export async function streamFile(
  bucket: string,
  key: string,
  range?: { start: number; end: number }
): Promise<Readable> {
  const c = getClient();
  if (range) return c.getPartialObject(bucket, key, range.start, range.end - range.start + 1);
  return c.getObject(bucket, key);
}

export async function removeFile(bucket: string, key: string): Promise<void> {
  await getClient().removeObject(bucket, key);
}
