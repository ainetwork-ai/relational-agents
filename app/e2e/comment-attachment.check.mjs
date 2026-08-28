// 댓글 입력줄의 클립 — 원본과 같은 방식으로 열리고, 고른 파일이 댓글에 붙는가.
//
// 원본에서 잰 것(파일 선택창을 CDP 로 가로채 실제로는 아무것도 고르지 않았다):
// 클립을 누르면 메뉴 없이 **네이티브 파일 선택창**이 바로 열리고, mode 는
// selectMultiple, 그 input 은 accept 제한이 없다(어떤 파일이든).
//
//   [BASE_URL=…] [ROW_PAGE_ID=…] [USER_ID=…] node e2e/comment-attachment.check.mjs
//
// dev DB 에 댓글과 /uploads 파일을 만든다 — 끝나고 지운다.

import fs from "node:fs";
import path from "node:path";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import zlib from "node:zlib";
import { Client } from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.ROW_PAGE_ID ?? "27b5c5e5-467c-4620-bde7-8d087e8a9875";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";

const F = JSON.parse(
  fs.readFileSync(new URL("./fixtures/notion-row-comments.json", import.meta.url), "utf8")
);

/** A real w×h PNG — seeing a tall image get boxed at 240 needs actual pixels. */
function tallPng(w, h) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const pg = new Client({ connectionString: pgUrl });
await pg.connect();
const { rows: has } = await pg.query(
  "select 1 from information_schema.tables where table_name='files'"
);
if (!has.length) {
  console.error("\n  files 테이블이 없습니다 — 이 DB 에 스키마를 먼저 밀어주세요.\n");
  await pg.end();
  process.exit(1);
}

 // 올릴 파일 두 개: 이미지 한 장과 텍스트 하나
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "cmt-"));
// 세로로 아주 긴 이미지 — 원본은 이런 걸 240 높이에 가둔다(2048x2731 → 180.5x240)
const png = path.join(tmp, "tall.png");
fs.writeFileSync(png, tallPng(60, 400));
// 원본 댓글에 실제로 붙어 있던 확장자들
// 원본 댓글에 실제로 붙어 있던 확장자와 그 크기대 — 10MB 상한이던 시절엔
// 이 중 큰 것들이 조용히 거부돼서 "이미지만 붙는다"로 보였다.
const OTHERS = [
  ["report.pdf", 12 * 1024 * 1024],
  ["sheet.xlsx", 13 * 1024],
  ["deck.pptx", 2 * 1024 * 1024], // 예전 10MB 상한 아래 — 대조군
  ["doc.hwp", 11 * 1024 * 1024],
  ["bundle.zip", 13 * 1024 * 1024],
];
const others = OTHERS.map(([n, bytes]) => {
  const f = path.join(tmp, n);
  fs.writeFileSync(f, Buffer.alloc(bytes, 7));
  return f;
});
// html 은 붙되 **우리 오리진에서 실행되면 안 된다**: public/uploads 는 같은
// 오리진이라 <script> 가 돌면 그 자체로 저장형 XSS 다. 예전엔 확장자를 .txt 로
// 눕혀 막았고, 지금은 next.config.ts 가 /uploads/* 에
// `Content-Security-Policy: sandbox` + `nosniff` 를 붙여 막는다 — 그래서 확장자를
// 그대로 둘 수 있다. 이 헤더가 allowed-types 의 html/svg 허용의 전제다.
// 실행형은 목록에서 빠져 있다 — 왕복 전에 클라가 먼저 막아야 한다
const blocked = path.join(tmp, "payload.js");
fs.writeFileSync(blocked, "alert(1)");
const html = path.join(tmp, "report.html");
fs.writeFileSync(html, "<h1>hi</h1><script>window.__ran = 1</script>");
others.push(html);
OTHERS.push(["report.html", 0]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
page.on("response", async (r) => {
  if (!/\/comments$|\/api\/upload$/.test(new URL(r.url()).pathname)) return;
  if (r.status() >= 400)
    console.error("  요청 실패:", r.status(), new URL(r.url()).pathname,
      (await r.text().catch(() => "")).slice(0, 120));
});
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid='comment-composer-input']", { timeout: 120_000 });
await page.waitForTimeout(1200);

const d = [];

 // 1) 클립이 여는 것이 파일 선택창인가 — 그리고 multiple / accept 제한 없음인가
const input = page.locator("[data-testid='comment-file-input']");
if (!(await input.count())) d.push("클립이 쓸 file input 이 없습니다");
else {
  const attrs = await input.evaluate((el) => ({ multiple: el.multiple, accept: el.getAttribute("accept") }));
  if (!attrs.multiple) d.push("여러 개를 못 고릅니다 — 원본은 selectMultiple 입니다");
  if (attrs.accept) d.push(`accept="${attrs.accept}" 가 걸려 있습니다 — 원본은 제한이 없습니다`);
}
// 업로드가 tus 로 나가는지 — 버퍼링 한 방(POST /api/upload)으로 되돌아가면 잡는다
const tusHits = { create: 0, patch: 0, buffered: 0 };
page.on("request", (r) => {
  const p2 = new URL(r.url()).pathname;
  if (p2 === "/api/upload" && r.method() === "POST") tusHits.buffered++;
  else if (p2 === "/api/upload/tus" && r.method() === "POST") tusHits.create++;
  else if (p2.startsWith("/api/upload/tus/") && r.method() === "PATCH") tusHits.patch++;
});
const chooser = page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
await page.click("[aria-label='파일 첨부']");
const fc = await chooser;
if (!fc) d.push("클립을 눌러도 파일 선택창이 열리지 않습니다");
else if (!fc.isMultiple()) d.push("선택창이 단일 선택입니다 — 원본은 selectMultiple 입니다");

 // 2) 고른 파일이 칩으로 서고, 보내면 댓글에 붙는가
if (fc) {
  await fc.setFiles([png, ...others]);
  await page.waitForSelector("[data-testid='attachment-chip']", { timeout: 60_000 });
 // 큰 파일은 올라가는 데 시간이 걸린다 — 개수가 찰 때까지 기다린다
  await page
    .waitForFunction(
      (n) => document.querySelectorAll("[data-testid='attachment-chip']").length >= n,
      1 + others.length,
      { timeout: 120_000 }
    )
    .catch(() => {});
  const chips = await page.locator("[data-testid='attachment-chip']").count();
  if (chips !== 1 + others.length) d.push(`고른 파일 ${1 + others.length}개인데 칩이 ${chips}개입니다`);

 // 본문 없이 파일만으로도 보낼 수 있어야 한다
  const sendDisabled = await page.locator("[data-testid='comment-composer-submit']").isDisabled();
  if (sendDisabled) d.push("파일만 붙였을 때 보내기가 잠겨 있습니다 — 파일만으로도 댓글입니다");
  await page.click("[data-testid='comment-composer-submit']");
  await page.waitForTimeout(2500);

  const saved = await pg.query(
    `select f.file_name as name, f.file_url as url, f.file_size as size, f.mime_type
       from files f join comments c on c.id = f.comment_id
      where c.page_id = $1`,
    [PAGE_ID]
  );
  const att = saved.rows.map((r) => ({ ...r, size: r.size ?? undefined }));
  if (att.length !== 1 + others.length)
    d.push(`저장된 첨부가 ${att.length}개입니다 — ${1 + others.length}개여야 합니다`);
  for (const a of att)
    if (typeof a.size !== "number") d.push(`"${a.name}" 에 크기가 없습니다 — 원본은 12.7 KiB 처럼 적습니다`);
 // 이미지는 stream, 그 외는 download — 클라이언트는 스토리지 키를 쥐지 않는다
  const srcs = await page.evaluate(() => ({
    imgs: [...document.querySelectorAll("[data-testid='comment-attachment-image']")].map((e) => e.getAttribute("src")),
    links: [...document.querySelectorAll("[data-testid='comment-attachment-file']")].map((e) => e.getAttribute("href")),
  }));
  for (const u of srcs.imgs)
    if (!/^\/api\/files\/[0-9a-f-]{36}\/stream$/.test(u ?? ""))
      d.push(`이미지 src 가 ${u} 입니다 — /api/files/<id>/stream 이어야 합니다`);
  for (const u of srcs.links)
    if (!/^\/api\/files\/[0-9a-f-]{36}\/download$/.test(u ?? ""))
      d.push(`파일 링크가 ${u} 입니다 — /api/files/<id>/download 여야 합니다`);
  for (const a of att)
    if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(a.url)) d.push(`첨부 url 이 이상합니다: ${a.url}`);

  const R = F.clip.attachmentRendering;
 // html 이 실행 가능한 문서로 서빙되지는 않는가
  const htmlAtt = att.find((a) => a.name === "report.html");
  if (!htmlAtt) d.push("report.html 이 첨부되지 않았습니다 — html 도 붙어야 합니다");
  else {
 // 이관 전(디스크) 경로일 때만 이 방어선이 적용된다. s3:// 로 옮겨간 뒤에는
 // 프록시 라우트가 그 역할을 하고, 그쪽 계약은 file-routes.check.mjs 가 본다.
  if (!/^\/uploads\//.test(htmlAtt.url)) {
    console.log(`· report.html 이 ${htmlAtt.url.slice(0, 12)}… 에 있어 /uploads CSP 대신 프록시 라우트가 막습니다`);
  } else {
    const r = await page.request.get(`${BASE}${htmlAtt.url}`);
    const h = r.headers();
    if ((h["content-security-policy"] ?? "") !== "sandbox")
      d.push(`/uploads 응답의 CSP 가 "${h["content-security-policy"] ?? "(없음)"}" 입니다 — sandbox 여야 합니다. 이게 없으면 첨부된 html/svg 가 우리 오리진에서 실행됩니다`);
    if ((h["x-content-type-options"] ?? "") !== "nosniff")
      d.push(`/uploads 응답에 nosniff 가 없습니다 — MIME 혼동으로 우회됩니다`);
    }
  }

 // 허용 목록에 없는 확장자는 붙지 않아야 한다 (업로드 요청 자체가 나가면 안 된다)
  let uploadedBlocked = false;
  const onUpload = (r) => {
    if (r.method() === "POST" && /\/api\/upload$/.test(new URL(r.url()).pathname)) uploadedBlocked = true;
  };
  const before = await page.locator("[data-testid='attachment-chip']").count();
  page.on("request", onUpload);
  uploadedBlocked = false;
  const fc2 = page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
 // (아래 클릭이 그 선택창을 연다)
  await page.click("[aria-label='파일 첨부']");
  const c2 = await fc2;
  if (!c2) d.push("두 번째 클립 클릭에서 선택창이 안 열렸습니다 — 이 검사가 헛돌았습니다");
  else await c2.setFiles([blocked]);
  await page.waitForTimeout(2500);
  page.off("request", onUpload);
  const after = await page.locator("[data-testid='attachment-chip']").count();
  if (after !== before) d.push("payload.js 가 첨부됐습니다 — 실행형은 허용 목록에 없습니다");
  if (uploadedBlocked) d.push("payload.js 로 업로드 요청이 나갔습니다 — 클라가 왕복 전에 막아야 합니다");

  const shown = await page.evaluate(() => {
    const px = (v) => +Number(v).toFixed(1);
    const img = document.querySelector("[data-testid='comment-attachment-image']");
    const name = document.querySelector("[data-testid='comment-attachment-name']");
    const size = document.querySelector("[data-testid='comment-attachment-size']");
    const st = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el), r = el.getBoundingClientRect();
      return { w: px(r.width), h: px(r.height), fs: c.fontSize, fw: c.fontWeight,
               lh: c.lineHeight, color: c.color, maxW: c.maxWidth, maxH: c.maxHeight,
               fit: c.objectFit, radius: c.borderRadius, text: (el.innerText || "").trim() };
    };
    return {
      images: document.querySelectorAll("[data-testid='comment-attachment-image']").length,
      files: document.querySelectorAll("[data-testid='comment-attachment-file']").length,
      chips: document.querySelectorAll("[data-testid='attachment-chip']").length,
      img: st(img), name: st(name), size: st(size),
      icons: document.querySelectorAll("[data-testid='comment-attachment-file'] svg").length,
    };
  });
  if (shown.images !== 1) d.push(`댓글에 그려진 이미지가 ${shown.images}개입니다 — 1개여야 합니다`);
  if (shown.files !== others.length)
    d.push(`댓글에 그려진 파일 줄이 ${shown.files}개입니다 — ${others.length}개여야 합니다 (${OTHERS.map((o) => o[0]).join(", ")})`);
  if (shown.chips) d.push("보낸 뒤에도 입력줄에 칩이 남아 있습니다");

 // 이미지: 240 상자에 갇혀야 한다 — 세로로 긴 것이 실제 크기로 늘어지면 안 된다
  if (shown.img) {
    if (shown.img.maxW !== R.image.maxWidth) d.push(`이미지 max-width: 우리 ${shown.img.maxW} / 노션 ${R.image.maxWidth}`);
    if (shown.img.maxH !== R.image.maxHeight) d.push(`이미지 max-height: 우리 ${shown.img.maxH} / 노션 ${R.image.maxHeight}`);
    if (shown.img.fit !== R.image.objectFit) d.push(`이미지 object-fit: 우리 ${shown.img.fit} / 노션 ${R.image.objectFit}`);
    if (shown.img.radius !== R.image.borderRadius) d.push(`이미지 라운드: 우리 ${shown.img.radius} / 노션 ${R.image.borderRadius}`);
    if (shown.img.h > 240.5) d.push(`세로로 긴 이미지가 ${shown.img.h}px 로 그려졌습니다 — 240 을 넘으면 안 됩니다`);
    if (shown.img.w > 240.5) d.push(`이미지가 ${shown.img.w}px 로 그려졌습니다 — 240 을 넘으면 안 됩니다`);
  }
 // 파일: 이름 줄 + 크기 줄, 아이콘 없음
  if (shown.name) {
    if (shown.name.fs !== R.file.name.fs || shown.name.fw !== R.file.name.fw || shown.name.lh !== R.file.name.lh)
      d.push(`파일 이름 서체: 우리 ${shown.name.fs}/${shown.name.fw}/${shown.name.lh} / 노션 ${R.file.name.fs}/${R.file.name.fw}/${R.file.name.lh}`);
    if (shown.name.color !== R.file.name.color) d.push(`파일 이름 색: 우리 ${shown.name.color} / 노션 ${R.file.name.color}`);
  } else d.push("파일 이름 줄이 없습니다");
  if (shown.size) {
    if (shown.size.fs !== R.file.size.fs || shown.size.lh !== R.file.size.lh)
      d.push(`크기 서체: 우리 ${shown.size.fs}/${shown.size.lh} / 노션 ${R.file.size.fs}/${R.file.size.lh}`);
    if (shown.size.color !== R.file.size.color) d.push(`크기 색: 우리 ${shown.size.color} / 노션 ${R.file.size.color}`);
    if (!/^\d+(\.\d+)? (B|KiB|MiB|GiB)$/.test(shown.size.text))
      d.push(`크기 표기가 "${shown.size.text}" 입니다 — 원본은 12.7 KiB 같은 이진 단위입니다`);
  } else d.push("크기 줄이 없습니다 — 원본은 이름 아래 크기를 적습니다");
  if (shown.icons) d.push(`파일 줄에 아이콘이 ${shown.icons}개 있습니다 — 원본에는 없습니다`);

 // 재개 가능 경로를 실제로 탔는가. 13MB 짜리는 8MB 청크라 PATCH 가 둘 이상이어야 한다.
  if (tusHits.buffered) d.push(`버퍼링 경로(POST /api/upload)로 ${tusHits.buffered}건 올라갔습니다 — 첨부는 tus 여야 합니다`);
  if (tusHits.create !== 1 + others.length)
    d.push(`tus creation 이 ${tusHits.create}건입니다 — 파일 수(${1 + others.length})와 같아야 합니다`);
  if (tusHits.patch <= tusHits.create)
    d.push(`tus PATCH 가 ${tusHits.patch}건뿐입니다 — 8MB 청크라면 13MB 파일 하나만으로도 더 나와야 합니다(청크가 안 쪼개졌습니다)`);
}

await browser.close();
const { rows: gone } = await pg.query(
  `with removed as (
     select f.file_url from files f join comments c on c.id = f.comment_id
      where c.page_id = $1 and c.author_id = $2)
   select file_url from removed`,
  [PAGE_ID, USER_ID]
);
await pg.query("delete from comments where page_id=$1 and author_id=$2", [PAGE_ID, USER_ID]);
await pg.end();
for (const r of gone)
  if (/^\/uploads\//.test(r.file_url))
    fs.rmSync(path.join(process.cwd(), "public", r.file_url.replace(/^\//, "")), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });

if (d.length) {
  console.error("\n  ┌─ 댓글 클립이 원본과 다릅니다 ─────────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-row-comments.json (clip)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `클립 원본과 동일 — 다중 선택·제한 없음; ${OTHERS.map((o) => o[0]).join(" · ")} 와 세로로 긴 png 가 붙어` +
    ` 이미지는 240 상자, 파일은 이름+크기 두 줄 (정리한 파일 ${gone.length}건)`
);
