// The resumable-upload server, one singleton.
//
// Why tus at all: at 1GB a single buffered request (`formData()`) does not fit
// in memory, and an interrupted one starts over. tus standardises chunked
// PATCH plus an offset query (HEAD), and tus-js-client brings
// fingerprint→URL storage and backoff retries with it.
//
// Ported from ainteams (web/src/lib/files/tus-server.ts), minus the MinIO
// branch: ainmem stores uploads on the app's own disk, so this always uses
// @tus/file-store and finalize moves the finished bytes into public/uploads.
// In-progress uploads live somewhere else on purpose — a half-written file
// must never be reachable under /uploads.
//
// Auth reaches the tus hooks through AsyncLocalStorage: the hooks have no idea
// what a session is, and cloning the Request to carry a header collides with
// the streaming PATCH body. Ownership is checked without touching the store,
// by baking the user id into the upload id — created as
// `tus-<userId>-<random>` and compared on every request that carries an id.
// A mismatch answers 404, not 403: a stranger should not learn the upload
// exists.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { readdir, rm, stat } from "node:fs/promises";
import { Server, type DataStore } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { checkUploadType } from "./allowed-types";
import { getMaxUploadBytes } from "./upload-limit";
import { finalizeTusUpload } from "./finalize-upload";
import { TUS_LOCAL_DIRECTORY } from "./tus-server-config";

export const TUS_PATH = "/api/upload/tus";

/** Namespace for in-progress uploads. A hyphen, not a slash: the id is the
 *  last path segment of the tus URL, and a slash would break routing. */
export const TUS_KEY_PREFIX = "tus-";

/** Unfinished uploads expire; after this HEAD/PATCH answer 410. */
export const TUS_EXPIRATION_MS = 24 * 60 * 60 * 1000;

export { TUS_LOCAL_DIRECTORY };

const authContext = new AsyncLocalStorage<{ userId: string }>();

/** The route runs tus handling inside this, after requireAuth. */
export function runWithTusUser<T>(userId: string, fn: () => T): T {
  return authContext.run({ userId }, fn);
}

function currentUserId(): string {
  const ctx = authContext.getStore();
 // a route calling in without runWithTusUser is a wiring bug — surface it as a
 // server error rather than treating it as "no auth", because the worst
 // outcome is a quietly anonymous upload
  if (!ctx) throw { status_code: 500, body: "tus auth context missing" };
  return ctx.userId;
}

const ownerPrefix = (userId: string) => `${TUS_KEY_PREFIX}${userId}-`;

/** Remove an upload's staging files. Both, and never throwing — a leftover
 *  here is rubbish, not a reason to fail a finished upload. */
export async function dropStagingEntry(id: string): Promise<void> {
  for (const f of [id, `${id}.json`])
    await rm(path.join(TUS_LOCAL_DIRECTORY, f), { force: true }).catch(() => {});
}

/**
 * Sweep staging.
 *
 * The library's `cleanUpExpiredUploads()` handles abandoned in-flight uploads —
 * ones where the data file is still there. It cannot handle the other shape we
 * produce: a sidecar whose data file finalize already moved out. Those are
 * invisible to it, so they are swept here by age.
 */
export async function sweepStaging(maxAgeMs = TUS_EXPIRATION_MS): Promise<number> {
  const entries = await readdir(TUS_LOCAL_DIRECTORY).catch(() => [] as string[]);
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
   // a pair is still a real upload — leave it to cleanUpExpiredUploads
    if (entries.includes(id)) continue;
    const p = path.join(TUS_LOCAL_DIRECTORY, name);
    const s = await stat(p).catch(() => null);
    if (!s || s.mtimeMs > cutoff) continue;
    await rm(p, { force: true }).catch(() => {});
    removed++;
  }
  return removed;
}

let server: Server | null = null;

export function getTusServer(): Server {
  if (server) return server;
  const store: DataStore = new FileStore({
    directory: TUS_LOCAL_DIRECTORY,
    expirationPeriodInMilliseconds: TUS_EXPIRATION_MS,
  });
  server = new Server({
    path: TUS_PATH,
    datastore: store,
   // a function, so changing MAX_UPLOAD_MB takes effect per request without a
   // restart. This is the authoritative refusal; the client's check is UX.
    maxSize: () => getMaxUploadBytes(),
   // relative Location — behind nginx we do not guess Host or protocol
    relativeLocation: true,
    namingFunction: () => `${ownerPrefix(currentUserId())}${randomBytes(16).toString("hex")}`,
    onIncomingRequest: async (_req, uploadId) => {
     // only requests that carry an id (HEAD/PATCH/DELETE) — creation has none yet
      if (uploadId && !uploadId.startsWith(ownerPrefix(currentUserId())))
        throw { status_code: 404, body: "Not found" };
    },
    onUploadCreate: async (_req, upload) => {
     // Upload-Defer-Length is refused: the size gate would only fire on the
     // last chunk, i.e. after accepting a gigabyte we were always going to
     // reject
      if (upload.size == null) throw { status_code: 400, body: "Upload-Length is required" };
      const check = checkUploadType(
        upload.metadata?.filename || "",
        upload.metadata?.filetype || ""
      );
      if (!check.allowed)
        throw {
          status_code: 415,
          body:
            check.reason === "ext"
              ? `File type ".${check.ext}" is not allowed`
              : `File type "${check.mimeType}" is not allowed`,
        };
      return {};
    },
    onUploadFinish: async (_req, upload) => {
     // creation guarantees a size (deferred length is a 400) — missing here is a bug
      if (upload.size == null) throw { status_code: 500, body: "finished upload has no size" };
     // hand off to the storage contract — content-addressed when MinIO is
     // configured, the old disk move when it is not
      const finalized = await finalizeTusUpload({
        id: upload.id,
        size: upload.size,
        metadata: upload.metadata,
      });
     // Clear the staging entry ourselves. `store.remove()` looks the upload up
     // first, and finalize has already moved the data file away, so it cannot
     // find it — the sidecar stayed behind, and the library's own collector
     // never sees it either: FileKvStore.list() only reports an id when BOTH
     // <id> and <id>.json are present. 58 orphans had accumulated in dev
     // before anyone looked.
      await dropStagingEntry(upload.id);
     // outside the tus spec, but tus-js-client reads it — same shape as the
     // buffered /api/upload response, so callers consume one thing
      const { storageUrl: _token, ...forClient } = finalized;
      void _token;
      return {
        status_code: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forClient),
      };
    },
  });
  return server;
}
