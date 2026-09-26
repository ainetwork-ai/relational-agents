#!/usr/bin/env node
// Moves the files in public/uploads to object storage and rewrites the DB references (step 5).
//
//   node scripts/migrate-uploads-to-storage.mjs            # only shows what it would do (default)
//   node scripts/migrate-uploads-to-storage.mjs --apply    # actually moves them
//
// Properties:
//   · **It never deletes the originals.** Files on disk stay — to roll back, only the DB references
//     need reverting. Clean up separately after checking (--prune was left out on purpose).
//   · **Idempotent.** References already moved are skipped, and statFile filters identical bytes so they are
//     never uploaded twice. If it dies midway, just run it again.
//   · It looks at three kinds of reference — files.file_url · pages.cover_url · urls inside blocks.content.
//
// Why two reference shapes:
//   Comment attachments have a `files` row, and the client calls them by **id** (fileUrl never leaves
//   the server). Block images and covers have no row and render straight from the `content.url` string, so
//   the **key-addressed proxy path** (/api/files/key/…) goes in that spot. That way nothing in the renderers
//   has to change for the move.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const APPLY = process.argv.includes("--apply");
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "app");
process.chdir(APP);
// This script lives in the repo root's scripts/, which has no node_modules — dependencies
// are resolved from the app.
const { Client } = createRequire(path.join(APP, "package.json"))("pg");

// Environment variables win; otherwise they are read from app/.env.local — dev just runs it,
// and prod passes POSTGRES_URL·MINIO_*·UPLOADS_DIR to use the same script.
const envFile = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim();
for (const k of ["POSTGRES_URL", "MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET"]) {
  if (!process.env[k]) { const v = fromFile(k); if (v) process.env[k] = v; }
}
const pgUrl = process.env.POSTGRES_URL;
if (!pgUrl) { console.error("POSTGRES_URL is not set."); process.exit(1); }

const storage = await import(pathToFileURL(path.join(APP, "src/lib/files/storage.ts")).href);
if (!storage.isStorageConfigured()) {
  console.error("MINIO_* is not configured — nowhere to move to.");
  process.exit(1);
}
const BUCKET = storage.storageBucket();

// dev reads the app's public/uploads, prod the deploy/uploads bound into the container —
// the caller decides which tree to read.
const UPLOADS = process.env.UPLOADS_DIR || path.join(APP, "public", "uploads");
if (!fs.existsSync(UPLOADS)) { console.error(`no uploads tree: ${UPLOADS}`); process.exit(1); }
console.log(`reading from: ${UPLOADS}`);
const seen = new Map(); // /uploads/... → { key, url, servePath, bytes, deduped }
let missing = 0;
let bytesMoved = 0;
let bytesSaved = 0;

/** One disk file into storage. Not uploaded if it is already there (= dedup). */
async function promote(ref) {
  if (seen.has(ref)) return seen.get(ref);
  const rel = ref.replace(/^\/uploads\//, "");
  const abs = path.join(UPLOADS, rel);
  if (!fs.existsSync(abs)) {
    missing++;
    seen.set(ref, null);
    return null;
  }
  const bytes = fs.statSync(abs).size;
 // streaming hash — the upload limit is 1GB, so a whole file can't be held in memory
 // (same reason as finalize-upload.ts)
  const hash = await new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(abs).on("data", (c) => h.update(c)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
  const ext = (path.extname(abs).slice(1) || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const key = storage.contentKey(hash, ext);
  const already = await storage.statFile(BUCKET, key);
  if (already) bytesSaved += bytes;
  else if (APPLY) {
    await storage.putStream(key, fs.createReadStream(abs), bytes);
    bytesMoved += bytes;
  } else bytesMoved += bytes;
  const out = {
    key,
    url: storage.buildStorageUrl(BUCKET, key),
    servePath: `/api/files/key/${key}`,
    bytes,
    deduped: Boolean(already),
  };
  seen.set(ref, out);
  return out;
}

const pg = new Client({ connectionString: pgUrl });
await pg.connect();
const counts = { files: 0, covers: 0, blocks: 0 };

// 1) comment attachments — called by id, so put the s3:// token
for (const r of (await pg.query("select id, file_url from files where file_url like '/uploads/%'")).rows) {
  const p = await promote(r.file_url);
  if (!p) continue;
  if (APPLY) await pg.query("update files set file_url=$1 where id=$2", [p.url, r.id]);
  counts.files++;
}

// 2) page covers — used directly as <img src>, so put the serving path
for (const r of (await pg.query("select id, cover_url from pages where cover_url like '/uploads/%'")).rows) {
  const p = await promote(r.cover_url);
  if (!p) continue;
  if (APPLY) await pg.query("update pages set cover_url=$1 where id=$2", [p.servePath, r.id]);
  counts.covers++;
}

// 3) urls inside blocks — the serving path, for the same reason
for (const r of (await pg.query("select id, content from blocks where content::text like '%/uploads/%'")).rows) {
  const c = r.content;
  let touched = false;
  for (const field of ["url"]) {
    const v = c?.[field];
    if (typeof v !== "string" || !v.startsWith("/uploads/")) continue;
    const p = await promote(v);
    if (!p) continue;
    c[field] = p.servePath;
    touched = true;
  }
  if (!touched) continue;
  if (APPLY) await pg.query("update blocks set content=$1 where id=$2", [c, r.id]);
  counts.blocks++;
}
await pg.end();

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(APPLY ? "moved:" : "to move (dry-run — run with --apply):");
console.log(`  refs     files ${counts.files} · covers ${counts.covers} · blocks ${counts.blocks}`);
console.log(`  files    ${[...seen.values()].filter(Boolean).length} unique`);
console.log(`  sent     ${mb(bytesMoved)}`);
console.log(`  deduped  ${mb(bytesSaved)} (same bytes, not uploaded)`);
if (missing) console.log(`  ⚠ ${missing} references not on disk — left as they were`);
console.log("  the original disk files were not deleted.");
