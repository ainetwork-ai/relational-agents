// 오브젝트 스토리지 계층 1단계 — 아직 아무 동작도 바꾸지 않는다는 것과,
// 키 규칙이 의도대로라는 것을 고정한다.
//
// 특히 **폴백**을 본다. ainteams 는 로컬 스택이 minio 를 안 띄우는 바람에
// `isStorageConfigured()` 는 true 인데 접속이 안 돼 첫 업로드가 500 이 났고 디스크
// 폴백에 도달조차 못 했다. 우리는 (1) env 없으면 false, (2) false 면 기존 디스크
// 경로가 그대로 동작 — 이 둘을 검사로 잡는다.
//
//   [BASE_URL=…] [USER_ID=…] node e2e/storage-layer.check.mjs

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sealData } from "iron-session";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";

const d = [];

// 1) 순수 함수들 — 키 규칙. server-only 를 우회하려고 소스를 직접 평가하지 않고,
//    tsx 로 모듈을 불러 실제 구현을 쓴다.
const mod = await import(
  pathToFileURL(path.resolve("src/lib/files/storage.ts")).href
).catch((e) => ({ __err: String(e).slice(0, 160) }));
if (mod.__err) {
  console.error(`\n  storage.ts 를 불러오지 못했습니다: ${mod.__err}`);
  console.error("  (tsx 로 실행하세요: npx tsx e2e/storage-layer.check.mjs)\n");
  process.exit(1);
}

const HASH = "a".repeat(64);
if (mod.contentKey(HASH, "pdf") !== `files/${HASH}.pdf`)
  d.push(`contentKey 가 ${mod.contentKey(HASH, "pdf")} 입니다 — files/<sha256>.<ext> 여야 합니다`);
if (mod.contentKey(HASH, "pdf") !== mod.contentKey(HASH, "pdf"))
  d.push("contentKey 가 같은 입력에 다른 값을 줍니다");
 // 파일 이름이 키에 섞이면 같은 바이트가 두 오브젝트가 된다 — dedup 이 깨진다
if (/[^a-z0-9/.]/.test(mod.contentKey(HASH, "pdf")))
  d.push("contentKey 에 이름 성분이 섞였습니다 — 키는 해시와 확장자뿐이어야 합니다");

const url = mod.buildStorageUrl("b", `files/${HASH}.pdf`);
if (url !== `s3://b/files/${HASH}.pdf`) d.push(`buildStorageUrl: ${url}`);
const parsed = mod.parseStorageUrl(url);
if (!parsed || parsed.bucket !== "b" || parsed.key !== `files/${HASH}.pdf`)
  d.push(`parseStorageUrl 왕복 실패: ${JSON.stringify(parsed)}`);
if (mod.parseStorageUrl("/uploads/x.png") !== null)
  d.push("parseStorageUrl 이 /uploads 경로를 s3 로 읽었습니다");
if (mod.isStorageUrl("/uploads/x.png")) d.push("isStorageUrl 이 디스크 경로를 참으로 봤습니다");

if (mod.thumbnailKey(`files/${HASH}.png`, 240) !== `thumbs/${HASH}_240.webp`)
  d.push(`thumbnailKey: ${mod.thumbnailKey(`files/${HASH}.png`, 240)}`);
 // 파생 키는 정본 키에서만 나온다 — 아무 문자열이나 받으면 네임스페이스가 섞인다
if (mod.thumbnailKey("tus-abc", 240) !== null) d.push("thumbnailKey 가 정본이 아닌 키를 받았습니다");
if (mod.thumbnailKey(`files/${HASH}.png`, 0) !== null) d.push("thumbnailKey 가 폭 0 을 받았습니다");

// 2) 설정 안 됐을 때 — false 여야 하고, 클라이언트를 만들려 하면 명확히 실패해야 한다
for (const k of ["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY"]) delete process.env[k];
if (mod.isStorageConfigured()) d.push("MINIO_* 가 없는데 isStorageConfigured() 가 참입니다");

// 3) 그리고 그 상태에서 앱의 업로드가 **여전히 디스크로 동작**해야 한다
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const form = new FormData();
form.append("file", new File([new Uint8Array(64)], "fallback.txt", { type: "text/plain" }));
form.append("kind", "file");
const res = await fetch(`${BASE}/api/upload`, {
  method: "POST",
  headers: { cookie: `rm-session=${cookie}` },
  body: form,
});
const body = await res.json().catch(() => ({}));
if (!res.ok) d.push(`MinIO 미설정 상태에서 업로드가 ${res.status} 입니다 — 디스크 폴백이 동작해야 합니다: ${JSON.stringify(body).slice(0, 120)}`);
else if (!/^\/uploads\//.test(body.url ?? "")) d.push(`폴백 업로드가 ${body.url} 를 돌려줬습니다 — /uploads/ 여야 합니다`);
else fs.rmSync(path.join("public", body.url.replace(/^\//, "")), { force: true });

if (d.length) {
  console.error("\n  ┌─ 스토리지 계층이 계약과 다릅니다 ─────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("스토리지 계층 OK — 키는 files/<sha256>.<ext>, s3:// 왕복, 파생 네임스페이스 분리, MinIO 미설정 시 디스크 폴백 유지");
