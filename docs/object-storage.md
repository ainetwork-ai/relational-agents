# Object storage migration (in progress)

Moving file bytes off the app container's disk and into MinIO. It follows ainteams' EPIC87/64
structure; the goal is for both services to use the same contract.

## Why

As `public/uploads` grew to 5GB, the backup compressed that whole tree every night and, for
consistency, **paused the app for 3 min 10 s**. The app healthcheck is `interval 30s / retries 3`, so it
goes unhealthy after about 90 s, and the watchdog cannot tell "frozen" from "broken" — so from
2026-08-14 **production restarted every day at 04:01** (15 of 21 watchdog log entries).

With files in object storage, the backup becomes an object mirror through the API and **needs no
pause**. What remains is a 2MB pg_dump, nowhere near 90 s.

## How the data is split

| Layer | What is the source of truth | If lost |
|---|---|---|
| MinIO | **Bytes** — the key is the SHA-256 of the content (`files/<sha256>.<ext>`) | Unrecoverable |
| Postgres | **Facts** — who attached it, when, where, and under what name | Files survive but are orphaned |
| `thumbs/` | None (derived) | Just regenerate |

**The file name is not part of the key.** If two people upload the same pdf under different names,
there is one object, and each name lives in its own DB row. Mixing the name into the key breaks dedup.

pg_dump only preserves the `s3://` **path strings** — it does not protect the bytes. **You must back up
both; neither one alone is enough to restore.**

## How bytes leave the system

The MinIO port is **not exposed.** Presigned URLs are not used either (they leak into caches and chat
logs, and access control leaves our hands). Bytes go out only through the app's proxy routes:

- `/api/files/[id]/download` — always `Content-Disposition: attachment`
- `/api/files/[id]/stream` — inline only for media that passes `isStreamableMedia`
- `/api/files/key/files/<sha256>.<ext>` — **key address**. The door for things that, unlike comment
  attachments, have no `files` row (block images, page covers). It only requires being logged in, which is
  stronger than the `/uploads/*` it replaces (accessible to **anyone**). Going as far as per-page permissions
  would require rows for block assets too, which is a bigger job than the migration.

**The client only ever holds serving paths.** Both `/api/upload` and the tus completion response return
`/api/files/key/…` (before migration, `/uploads/…`) as `url`, and the `s3://` token lives only inside the
server — when a row is needed, `storageRefFromClientUrl` builds the token from that path (comment POST).
Initially tus returned the token as-is, and AI chat was embedding it in message bodies (it did not render,
and the key stayed in the conversation history). The DM message validator and the agent's image
recognition accept the same two shapes.

**These two routes are what justify allowing html/svg in the upload allowlist.** Right now that role is
played by the `/uploads/*` CSP sandbox + nosniff in `next.config.ts`, and it moves over here in step 6.

## Steps

- [x] **1. Storage layer** — `app/src/lib/files/storage.ts`. MinIO client, key rules,
      `putFile/putStream/statFile/streamFile`, lazy bucket. When `isStorageConfigured()` is
      false (= no MINIO_* env), **every caller keeps the current disk path as-is**, so behavior does
      not change. `e2e/storage-layer.check.mjs` pins the key rules and the fallback.
- [x] **2. `files` table + proxy routes** — attachments became first-class rows (`comment_id` cascade).
      `/api/files/[id]/download` is always attachment, `/api/files/[id]/stream` only for media passing
      `isStreamableMedia`. Both routes read **both** `s3://` and pre-migration `/uploads/`, so step 5
      can be done file by file. Nothing uses them yet.
      `e2e/file-routes.check.mjs` pins the contract. Local MinIO is
      `docker-compose.local.yml`.
- [x] **3. Promotion in the tus completion hook** — `finalize-upload.ts`. Streaming hash
      (`arrayBuffer()` does not hold up at 1GB) → `contentKey` → skip if `statFile` finds it.
      That single lookup is **both dedup and idempotency** — the tenth person attaching the same pdf
      writes zero bytes, and it is safe even if a client retry reruns the completion hook.
      If MinIO is not configured, it moves the file to disk as before.
      `e2e/upload-promotion.check.mjs` (needs a real MinIO) pins four things: key is the content hash ·
      same bytes with different names = 1 object · safe to rerun · disk when unconfigured.
- [x] **4. Comment attachments into `files` rows** — removed the `comments.attachments` jsonb.
      POST creates `files` rows along with the comment, and GET sends **only ids** —
      the client never holds storage keys and reaches bytes only via `/api/files/<id>/{stream,download}`.
      Incoming urls must be an `s3://` in our bucket or a pre-migration `/uploads/` file name
      (blocks attempts to make the proxy fetch someone else's resource).
      Because prod never had that column, the real-data migration was zero.
- [x] **5. Migration (dev only)** — `scripts/migrate-uploads-to-storage.mjs`. Dry-run by default,
      writes only with `--apply`. It **does not delete the originals** (to roll back, just revert the
      DB references) and is **idempotent** (already-moved references are skipped, identical bytes are
      filtered by statFile).
      dev result: 1,046 references (covers 3 · blocks 1,043), 4,369MB transferred,
      **711MB of duplicates removed automatically** — the real payoff of content addressing.
      Why there are two reference shapes: comment attachments have `files` rows and are addressed by
      **id**, while blocks and covers have no row and render directly from `content.url`, so the
      **key-address path** is put in its place. That is why not a single renderer had to change.
      **prod also done (2026-08-28)**: 1,062 references (covers 3 · blocks 1,059), 4,459MB transferred,
      **711MB of duplicates removed**, 963 MinIO objects. The one reference that was not on disk had been
      broken since before the migration, so it was left as is. The original `deploy/uploads` was not deleted.
      The script now takes `POSTGRES_URL`·`MINIO_*`·`UPLOADS_DIR` as environment variables and works for
      both dev and prod. Prod has no MinIO port, so it runs in a one-off container inside the compose
      network:
      ```
      docker run --rm --network ainmem_prod_default -v /home/comcom/ainmem:/repo -w /repo/app \
        -e POSTGRES_URL=… -e MINIO_ENDPOINT=minio:9000 -e MINIO_ACCESS_KEY=… \
        -e MINIO_SECRET_KEY=… -e MINIO_BUCKET=ainmem-files -e UPLOADS_DIR=/repo/deploy/uploads \
        --user "$(id -u):$(id -g)" node:22-alpine npx tsx ../scripts/migrate-uploads-to-storage.mjs
      ```
- [x] **6. Disk cleanup (prod, 2026-08-28)** — `/api/upload` (avatars, covers, icons) also promotes
      and returns the key-address path when storage is enabled, so nothing creates `/uploads/` anymore.
      Deleted the 5.1GB `deploy/uploads` + removed the bind mount from the prod compose file.
      The order was kept: confirm 0 references → **detach only the mount first and pass 6 smoke tests**
      (proof that nothing reads the disk) → delete.
      Found right before deleting: the file for the one reference that was "not on disk" was in
      `.trash-20260820/`. It was pulled out, migrated, and the block fixed — deleting as-is would have
      destroyed the only copy.
- [x] **7. Backup · watchdog (2026-08-28)**
      - **4.9GB / 3 min 10 s → 2.2MB / 1.3 s.** Removed `uploads` from the tar (what remains is the OKF
        tree and avatars).
      - `scripts/backup-objects.sh` registered in cron (daily 05:00, 4 sets). It is an API mirror, so
        **no app pause** — 963 objects / 4.35 GiB / 12 s.
      - **Both are needed to restore**: the DB has only the `s3://` strings, the mirror only the bytes.
      - The watchdog checks `State.Paused` first — but if frozen for **more than 10 minutes** it treats it
        as an abandoned pause and runs `docker unpause` (not a restart). The backup's trap cannot catch
        SIGKILL, OOM or reboots, so dying in between leaves a permanent pause, and a watchdog that just
        tolerates that forever would be worse than before. Verified by actually observing the
        `Paused=true, Health=unhealthy` state during a production backup — the very state that caused
        the 04:01 restart every day for 15 days.

## Remaining

- **The `/uploads/*` CSP header in `next.config.ts`** — it is baked into the image, so it goes away with
  the next deploy. The path itself no longer exists, so it is harmless and not worth a deploy on its own.
- ~~tus staging GC~~ **Plugged (2026-08-28).** But the cause was not what we expected.
  Even with `cleanUpExpiredUploads()` wired in, it collected **0 entries** — `FileKvStore.list()` only
  returns an id when **both** `<id>` and `<id>.json` exist, but our finalize had already moved the data
  file, so what remained were only **unpaired sidecars**, forever invisible to the library's collector.
  58 of them had piled up in dev.
  Fixed both: finalize deletes the staging entry directly instead of `store.remove()` (which looks up
  first and so fails), and `/api/cron/cleanup` sweeps orphan sidecars by age as well (hourly).
  Verification: one aged fragment was swept (58→57), and uploading 7 files afterwards did not add any fragments.
- **Object backup is weekly** (`0 5 * * 0`, 4 sets). Objects are immutable, so keys that *existed* are
  safe, but **files uploaded in up to the last 7 days are in no backup, while the daily DB dump references
  them.** It is a 12-second job, so moving it to daily seems right (1.5T of free disk; 4 sets
  ×4.4GiB) — the cron change is a human decision.
- **`files.tar.gz` is effectively empty (131 bytes).** The host's `deploy/okf-content` and
  `deploy/avatars` both contain 0 files. The container's `/data/md-mirror` (volume
  `ainmem_prod_mdmirror`, 2.5MB) is in no backup. This is not a new problem (yesterday's set also had only
  a single directory entry for okf-content), and if it is derived data it is harmless, but be aware that
  the nightly backup's content is **just the DB dump**.
- **The only disk copy to roll back to** is `~/ainmem-backups/keep-last-disk-uploads-20260828_115446/`
  (files.tar.gz 5.18GB, taken right before deletion). It was renamed so it falls outside the rotation glob
  (`[0-9]*_[0-9]*`) — otherwise it would have been auto-deleted on 9/11 with KEEP=14. Delete it by hand
  once the migration is verified.
- **No orphan object cleanup.** Deleting a comment removes its `files` rows via cascade, but the bytes in
  MinIO remain. Thanks to the `files` table, "keys with 0 references" can at least be asked in one query.
- **The dev `public/uploads` originals** are still there (even after the migration completed). They could
  be deleted like prod, but it is not urgent.

## Running MinIO locally

```bash
docker compose -f docker-compose.local.yml up -d minio
```

**If the env is set, the container must be running too.** ainteams had `isStorageConfigured()` true
with minio missing from the stack, so the first upload returned 500 and never reached the fallback. If the
env is left empty, the app runs on disk and this container is not needed.

```
MINIO_ENDPOINT=localhost:9000   # host or host:port; a scheme is also fine
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=ainmem-files       # default if omitted
```
