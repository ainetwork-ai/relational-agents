// tus completion → promotion to the storage contract.
//
//   key = SHA-256 of the content (files/<sha256>.<ext>)
//   same bytes = one object (dedup)
//   re-running the completion hook must be safe (client retries really do cause it)
//   with MinIO unconfigured, the disk as before
//
// MINIO_* is set only inside this process so the shared dev server's env is left alone.
// Needs a real MinIO:
//   docker compose -f docker-compose.local.yml up -d minio
//
//   npx tsx e2e/upload-promotion.check.mjs

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { content } from "./i18n.mjs";

const C = content.UPLOAD_PROMOTION;

process.env.MINIO_ENDPOINT ||= "127.0.0.1:9000";
process.env.MINIO_ACCESS_KEY ||= "ainmem";
process.env.MINIO_SECRET_KEY ||= "ainmem-local-secret";
process.env.MINIO_BUCKET ||= "ainmem-files-check";

const storage = await import("../src/lib/files/storage.ts");
const { finalizeTusUpload } = await import("../src/lib/files/finalize-upload.ts");
const { TUS_LOCAL_DIRECTORY } = await import("../src/lib/files/tus-server-config.ts");

const reachable = await storage
  .statFile(storage.storageBucket(), "probe")
  .then(() => true)
  .catch((e) => String(e));
if (reachable !== true) {
  console.error(`\n  Could not reach MinIO: ${reachable}`);
  console.error("  docker compose -f docker-compose.local.yml up -d minio\n");
  process.exit(1);
}

fs.mkdirSync(TUS_LOCAL_DIRECTORY, { recursive: true });
const d = [];
const stage = (bytes) => {
  const id = `tus-check-${randomUUID()}`;
  fs.writeFileSync(path.join(TUS_LOCAL_DIRECTORY, id), bytes);
  return id;
};
const BYTES = Buffer.from("the same bytes, twice over".repeat(500));
const HASH = createHash("sha256").update(BYTES).digest("hex");
const made = [];

// 1) promotion — the key must be the content hash
const a = await finalizeTusUpload({
  id: stage(BYTES),
  size: BYTES.length,
  metadata: { filename: C.report, filetype: "application/pdf" },
});
made.push(a.storageUrl);
const wantKey = `files/${HASH}.pdf`;
// the client's part (url) is the serving path, the row's part (storageUrl) is an s3:// token — never mix them
if (a.url !== `/api/files/key/${wantKey}`) d.push(`the url for the client is ${a.url} — it should be /api/files/key/${wantKey}`);
const parsed = storage.parseStorageUrl(a.storageUrl ?? "");
if (!parsed) d.push(`the promoted storageUrl is not s3://: ${a.storageUrl}`);
else if (parsed.key !== wantKey) d.push(`the key is ${parsed.key} — it should be ${wantKey}`);
if (a.name !== C.report) d.push(`the name is ${a.name} — the name the person gave must be kept`);
if (a.size !== BYTES.length) d.push(`the size is ${a.size} — it should be ${BYTES.length}`);
const stat1 = parsed && (await storage.statFile(parsed.bucket, parsed.key));
if (!stat1) d.push("the object was not actually uploaded");
else if (stat1.size !== BYTES.length) d.push(`the object size is ${stat1.size}`);

// 2) same bytes, different name → the same single object. The name belongs to the DB row, not the key.
const b = await finalizeTusUpload({
  id: stage(BYTES),
  size: BYTES.length,
  metadata: { filename: C.otherName, filetype: "application/pdf" },
});
if (b.storageUrl !== a.storageUrl) d.push(`same bytes but a different key:\n      ${a.storageUrl}\n      ${b.storageUrl}`);
if (b.name !== C.otherName) d.push("the second upload lost its name");

// 3) re-running the completion hook — must not throw and must give the same answer (client retry)
const again = await finalizeTusUpload({
  id: stage(BYTES),
  size: BYTES.length,
  metadata: { filename: C.report, filetype: "application/pdf" },
}).catch((e) => ({ __err: String(e).slice(0, 120) }));
if (again.__err) d.push(`re-running the completion hook threw: ${again.__err}`);
else if (again.storageUrl !== a.storageUrl) d.push("the re-run made a different key — not idempotent");

// 4) different bytes → different key
const other = Buffer.from("different");
const c = await finalizeTusUpload({
  id: stage(other),
  size: other.length,
  metadata: { filename: C.report, filetype: "application/pdf" },
});
made.push(c.storageUrl);
if (c.storageUrl === a.storageUrl) d.push("different bytes got the same key");

// 5) MinIO unconfigured → the disk, as before
for (const k of ["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY"]) delete process.env[k];
const fb = await finalizeTusUpload({
  id: stage(Buffer.from("fallback")),
  size: 8,
  metadata: { filename: "note.txt", filetype: "text/plain" },
});
if (!/^\/uploads\//.test(fb.url)) d.push(`MinIO is unconfigured but it returned ${fb.url} — it should be the disk`);
if (fb.storageUrl) d.push("disk mode but there is a storageUrl");
else fs.rmSync(path.join("public", fb.url.replace(/^\//, "")), { force: true });

// cleanup — leave none of the objects the check made
process.env.MINIO_ENDPOINT = "127.0.0.1:9000";
process.env.MINIO_ACCESS_KEY = "ainmem";
process.env.MINIO_SECRET_KEY = "ainmem-local-secret";
for (const u of made) {
  const p = storage.parseStorageUrl(u);
  if (p) await storage.removeFile(p.bucket, p.key).catch(() => {});
}
for (const f of fs.readdirSync(TUS_LOCAL_DIRECTORY))
  if (f.startsWith("tus-check-")) fs.rmSync(path.join(TUS_LOCAL_DIRECTORY, f), { force: true });

if (d.length) {
  console.error("\n  ┌─ Upload promotion differs from the contract ─────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`promotion OK — key is the content hash (files/${HASH.slice(0, 12)}….pdf), same bytes are one object, re-running the completion hook is safe, disk when MinIO is unconfigured`);

