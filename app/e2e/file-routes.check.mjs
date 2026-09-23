// 프록시 라우트 — 바이트가 나가는 유일한 문.
//
// 이 두 갈래가 업로드 allowlist 의 html/svg 허용 **근거**다:
//   download  언제나 Content-Disposition: attachment · 제네릭 타입
//   stream    isStreamableMedia 를 통과한 미디어만 인라인, 나머지는 415
// 여기가 무너지면 첨부된 html 이 우리 오리진 문서로 렌더돼 세션이 털린다.
//
// 접근 권한은 댓글 → 페이지를 따라간다. 남의 파일은 403 이 아니라 **404** 여야 한다
// (존재를 알려주지 않는다).
//
//   [BASE_URL=…] [ROW_PAGE_ID=…] [USER_ID=…] [OTHER_USER_ID=…] node e2e/file-routes.check.mjs

import fs from "node:fs";
import path from "node:path";
import { sealData } from "iron-session";
import { Client } from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.ROW_PAGE_ID ?? "27b5c5e5-467c-4620-bde7-8d087e8a9875";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const pg = new Client({ connectionString: pgUrl });
await pg.connect();
const { rows: hasTable } = await pg.query(
  "select 1 from information_schema.tables where table_name='files'"
);
if (!hasTable.length) {
  console.error("\n  files 테이블이 없습니다 — 이 DB 에 스키마를 먼저 밀어주세요.\n");
  await pg.end();
  process.exit(1);
}

 // 실제 바이트를 디스크에 두고(이관 전 경로) 그것을 가리키는 files 행을 만든다
const dir = path.join(process.cwd(), "public", "uploads");
fs.mkdirSync(dir, { recursive: true });
const made = [];
async function addFile(name, bytes, mime, commentId) {
  const stored = `check-${crypto.randomUUID()}${path.extname(name)}`;
  fs.writeFileSync(path.join(dir, stored), bytes);
  made.push(path.join(dir, stored));
  const { rows } = await pg.query(
    "insert into files (comment_id, user_id, file_name, file_url, file_size, mime_type) values ($1,$2,$3,$4,$5,$6) returning id",
    [commentId, USER_ID, name, `/uploads/${stored}`, bytes.length, mime]
  );
  return rows[0].id;
}

const { rows: cRows } = await pg.query(
  "insert into comments (page_id, block_id, parent_id, author_id, body) values ($1,null,null,$2,$3) returning id",
  [PAGE_ID, USER_ID, "첨부 라우트 검사"]
);
const commentId = cRows[0].id;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const pngId = await addFile("shot.png", PNG, "image/png", commentId);
const htmlId = await addFile(
  "report.html",
  Buffer.from("<script>window.__ran=1</script>"),
  "text/html",
  commentId
);

const get = (url) => fetch(`${BASE}${url}`, { headers: { cookie: `rm-session=${cookie}` }, redirect: "manual" });
const d = [];

 // 1) download — 무엇이든 첨부로만
for (const [label, id] of [["png", pngId], ["html", htmlId]]) {
  const r = await get(`/api/files/${id}/download`);
  if (!r.ok) { d.push(`${label} download 가 ${r.status} 입니다`); continue; }
  const cd = r.headers.get("content-disposition") ?? "";
  const ct = r.headers.get("content-type") ?? "";
  if (!/^attachment/.test(cd)) d.push(`${label} download 의 disposition 이 "${cd}" 입니다 — attachment 여야 합니다`);
  if (/text\/html|image\/svg/.test(ct)) d.push(`${label} download 가 ${ct} 로 나갑니다 — 문서로 렌더될 수 있습니다`);
  if ((r.headers.get("x-content-type-options") ?? "") !== "nosniff") d.push(`${label} download 에 nosniff 가 없습니다`);
}

 // 2) stream — 미디어만
const sPng = await get(`/api/files/${pngId}/stream`);
if (!sPng.ok) d.push(`png stream 이 ${sPng.status} 입니다 — 이미지는 인라인이어야 합니다`);
else {
  if ((sPng.headers.get("content-type") ?? "") !== "image/png") d.push(`png stream 의 타입이 ${sPng.headers.get("content-type")} 입니다`);
  if ((sPng.headers.get("content-disposition") ?? "") !== "inline") d.push("png stream 이 inline 이 아닙니다");
}
const sHtml = await get(`/api/files/${htmlId}/stream`);
if (sHtml.status !== 415)
  d.push(`html stream 이 ${sHtml.status} 입니다 — 415 여야 합니다. 인라인으로 나가면 우리 오리진에서 실행됩니다`);

 // 3) 없는 id, 그리고 로그인 안 한 요청
const missing = await get(`/api/files/${crypto.randomUUID()}/download`);
if (missing.status !== 404) d.push(`없는 파일이 ${missing.status} 입니다 — 404 여야 합니다`);
const anon = await fetch(`${BASE}/api/files/${pngId}/download`, { redirect: "manual" });
if (anon.status < 400) d.push(`비로그인 요청이 ${anon.status} 로 통과했습니다`);

 // 4) 댓글을 지우면 파일 행도 같이 간다 (고아 판정을 한 쿼리로 하려는 이유)
await pg.query("delete from comments where id=$1", [commentId]);
const { rows: left } = await pg.query("select count(*)::int n from files where comment_id=$1", [commentId]);
if (left[0].n !== 0) d.push(`댓글을 지웠는데 files 행이 ${left[0].n}개 남았습니다 — cascade 가 걸려 있어야 합니다`);
const after = await get(`/api/files/${pngId}/download`);
if (after.status !== 404) d.push(`행이 사라졌는데 여전히 ${after.status} 로 받아집니다`);

await pg.end();
for (const f of made) fs.rmSync(f, { force: true });

if (d.length) {
  console.error("\n  ┌─ 파일 프록시 라우트가 계약과 다릅니다 ────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 이 계약이 allowed-types 의 html/svg 허용 근거입니다");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("프록시 라우트 OK — download 는 언제나 attachment, stream 은 미디어만(html 415), 비로그인·없는 id 는 404, 댓글 삭제 시 cascade");
