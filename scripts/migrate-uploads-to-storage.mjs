#!/usr/bin/env node
// public/uploads 의 파일을 오브젝트 스토리지로 옮기고 DB 참조를 바꾼다 (5단계).
//
//   node scripts/migrate-uploads-to-storage.mjs            # 무엇을 할지만 본다 (기본)
//   node scripts/migrate-uploads-to-storage.mjs --apply    # 실제로 옮긴다
//
// 성질:
//   · **원본을 지우지 않는다.** 디스크 파일은 그대로 남는다 — 되돌리려면 DB 참조만
//     되돌리면 된다. 정리는 확인 후 별도로(--prune 은 일부러 안 만들었다).
//   · **멱등하다.** 이미 옮긴 참조는 건너뛰고, 같은 바이트는 statFile 이 걸러 두 번
//     올리지 않는다. 중간에 죽어도 다시 돌리면 된다.
//   · 참조 세 군데를 본다 — files.file_url · pages.cover_url · blocks.content 안의 url.
//
// 왜 참조 모양이 둘인가:
//   댓글 첨부는 `files` 행이 있어 클라이언트가 **id** 로 부른다(fileUrl 은 서버 밖으로
//   안 나간다). 블록 이미지·커버는 행이 없고 `content.url` 문자열로 바로 렌더되므로
//   **키 주소 프록시 경로**(/api/files/key/…)를 그 자리에 넣는다. 그래야 렌더러를
//   하나도 안 고치고 옮길 수 있다.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const APPLY = process.argv.includes("--apply");
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "app");
process.chdir(APP);
// 이 스크립트는 레포 루트의 scripts/ 에 있고 거기엔 node_modules 가 없다 — 의존은
// 앱 쪽에서 해석한다.
const { Client } = createRequire(path.join(APP, "package.json"))("pg");

// 환경변수가 이기고, 없으면 app/.env.local 에서 읽는다 — dev 는 그냥 돌리면 되고,
// prod 는 POSTGRES_URL·MINIO_*·UPLOADS_DIR 을 넘겨서 같은 스크립트를 쓴다.
const envFile = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim();
for (const k of ["POSTGRES_URL", "MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET"]) {
  if (!process.env[k]) { const v = fromFile(k); if (v) process.env[k] = v; }
}
const pgUrl = process.env.POSTGRES_URL;
if (!pgUrl) { console.error("POSTGRES_URL 이 없다."); process.exit(1); }

const storage = await import(pathToFileURL(path.join(APP, "src/lib/files/storage.ts")).href);
if (!storage.isStorageConfigured()) {
  console.error("MINIO_* 가 설정돼 있지 않다 — 옮길 곳이 없다.");
  process.exit(1);
}
const BUCKET = storage.storageBucket();

// dev 는 앱의 public/uploads, prod 는 컨테이너에 바인드되는 deploy/uploads —
// 어느 트리를 읽을지는 호출자가 정한다.
const UPLOADS = process.env.UPLOADS_DIR || path.join(APP, "public", "uploads");
if (!fs.existsSync(UPLOADS)) { console.error(`업로드 트리가 없다: ${UPLOADS}`); process.exit(1); }
console.log(`읽는 곳: ${UPLOADS}`);
const seen = new Map(); // /uploads/... → { key, url, servePath, bytes, deduped }
let missing = 0;
let bytesMoved = 0;
let bytesSaved = 0;

/** 디스크 파일 하나를 스토리지로. 이미 있으면 올리지 않는다(= dedup). */
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
 // 스트리밍 해시 — 업로드 상한이 1GB 라 파일 하나를 통째로 메모리에 올릴 수 없다
 // (finalize-upload.ts 와 같은 이유)
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

// 1) 댓글 첨부 — id 로 불리므로 s3:// 토큰을 넣는다
for (const r of (await pg.query("select id, file_url from files where file_url like '/uploads/%'")).rows) {
  const p = await promote(r.file_url);
  if (!p) continue;
  if (APPLY) await pg.query("update files set file_url=$1 where id=$2", [p.url, r.id]);
  counts.files++;
}

// 2) 페이지 커버 — <img src> 로 바로 쓰이므로 서빙 경로를 넣는다
for (const r of (await pg.query("select id, cover_url from pages where cover_url like '/uploads/%'")).rows) {
  const p = await promote(r.cover_url);
  if (!p) continue;
  if (APPLY) await pg.query("update pages set cover_url=$1 where id=$2", [p.servePath, r.id]);
  counts.covers++;
}

// 3) 블록 안의 url — 같은 이유로 서빙 경로
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
console.log(APPLY ? "옮겼다:" : "옮길 것 (dry-run — --apply 로 실행):");
console.log(`  참조   files ${counts.files} · covers ${counts.covers} · blocks ${counts.blocks}`);
console.log(`  파일   ${[...seen.values()].filter(Boolean).length}개 고유`);
console.log(`  전송   ${mb(bytesMoved)}`);
console.log(`  중복   ${mb(bytesSaved)} (같은 바이트라 올리지 않음)`);
if (missing) console.log(`  ⚠ 디스크에 없는 참조 ${missing}건 — 그대로 뒀다`);
console.log("  원본 디스크 파일은 지우지 않았다.");
