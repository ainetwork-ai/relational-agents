// tus 완료 → 저장 계약으로의 승격.
//
//   키 = 내용의 SHA-256 (files/<sha256>.<ext>)
//   같은 바이트 = 오브젝트 1개 (dedup)
//   완료 훅 재실행이 안전해야 한다 (클라 재시도가 실제로 그렇게 만든다)
//   MinIO 미설정이면 예전 그대로 디스크
//
// 공유 dev 서버의 env 를 건드리지 않으려고 이 프로세스 안에서만 MINIO_* 를 세운다.
// 실제 MinIO 가 필요하다:
//   docker compose -f docker-compose.local.yml up -d minio
//
//   npx tsx e2e/upload-promotion.check.mjs

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

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
  console.error(`\n  MinIO 에 붙지 못했습니다: ${reachable}`);
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

// 1) 승격 — 키가 내용 해시여야 한다
const a = await finalizeTusUpload({
  id: stage(BYTES),
  size: BYTES.length,
  metadata: { filename: "보고서.pdf", filetype: "application/pdf" },
});
made.push(a.storageUrl);
const wantKey = `files/${HASH}.pdf`;
// 클라이언트 몫(url)은 서빙 경로, 행 몫(storageUrl)은 s3:// 토큰 — 둘을 섞지 않는다
if (a.url !== `/api/files/key/${wantKey}`) d.push(`클라이언트에 줄 url 이 ${a.url} 입니다 — /api/files/key/${wantKey} 여야 합니다`);
const parsed = storage.parseStorageUrl(a.storageUrl ?? "");
if (!parsed) d.push(`승격 결과의 storageUrl 이 s3:// 가 아닙니다: ${a.storageUrl}`);
else if (parsed.key !== wantKey) d.push(`키가 ${parsed.key} 입니다 — ${wantKey} 여야 합니다`);
if (a.name !== "보고서.pdf") d.push(`이름이 ${a.name} 입니다 — 사람이 준 이름이 보존돼야 합니다`);
if (a.size !== BYTES.length) d.push(`크기가 ${a.size} 입니다 — ${BYTES.length} 여야 합니다`);
const stat1 = parsed && (await storage.statFile(parsed.bucket, parsed.key));
if (!stat1) d.push("오브젝트가 실제로 올라가지 않았습니다");
else if (stat1.size !== BYTES.length) d.push(`오브젝트 크기가 ${stat1.size} 입니다`);

// 2) 같은 바이트, 다른 이름 → 같은 오브젝트 하나. 이름은 DB 행 몫이지 키가 아니다.
const b = await finalizeTusUpload({
  id: stage(BYTES),
  size: BYTES.length,
  metadata: { filename: "완전히 다른 이름.pdf", filetype: "application/pdf" },
});
if (b.storageUrl !== a.storageUrl) d.push(`같은 바이트인데 키가 다릅니다:\n      ${a.storageUrl}\n      ${b.storageUrl}`);
if (b.name !== "완전히 다른 이름.pdf") d.push("두 번째 업로드가 이름을 잃었습니다");

// 3) 완료 훅 재실행 — 던지지 않고 같은 답을 줘야 한다 (클라 재시도)
const again = await finalizeTusUpload({
  id: stage(BYTES),
  size: BYTES.length,
  metadata: { filename: "보고서.pdf", filetype: "application/pdf" },
}).catch((e) => ({ __err: String(e).slice(0, 120) }));
if (again.__err) d.push(`완료 훅 재실행이 던졌습니다: ${again.__err}`);
else if (again.storageUrl !== a.storageUrl) d.push("재실행이 다른 키를 만들었습니다 — 멱등이 아닙니다");

// 4) 다른 바이트 → 다른 키
const other = Buffer.from("different");
const c = await finalizeTusUpload({
  id: stage(other),
  size: other.length,
  metadata: { filename: "보고서.pdf", filetype: "application/pdf" },
});
made.push(c.storageUrl);
if (c.storageUrl === a.storageUrl) d.push("다른 바이트가 같은 키를 받았습니다");

// 5) MinIO 미설정 → 예전처럼 디스크
for (const k of ["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY"]) delete process.env[k];
const fb = await finalizeTusUpload({
  id: stage(Buffer.from("fallback")),
  size: 8,
  metadata: { filename: "note.txt", filetype: "text/plain" },
});
if (!/^\/uploads\//.test(fb.url)) d.push(`MinIO 미설정인데 ${fb.url} 를 돌려줬습니다 — 디스크여야 합니다`);
if (fb.storageUrl) d.push("디스크 모드인데 storageUrl 이 있습니다");
else fs.rmSync(path.join("public", fb.url.replace(/^\//, "")), { force: true });

// 정리 — 검사가 만든 오브젝트를 남기지 않는다
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
  console.error("\n  ┌─ 업로드 승격이 계약과 다릅니다 ───────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`승격 OK — 키가 내용 해시(files/${HASH.slice(0, 12)}….pdf), 같은 바이트는 오브젝트 1개, 완료 훅 재실행 안전, MinIO 미설정 시 디스크`);
