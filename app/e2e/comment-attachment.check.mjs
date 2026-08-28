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
const { rows: has } = await pg.query(
  "select 1 from information_schema.columns where table_name='comments' and column_name='attachments'"
);
if (!has.length) {
  console.error("\n  comments.attachments 컬럼이 없습니다 — 이 DB 에 스키마를 먼저 밀어주세요.\n");
  await pg.end();
  process.exit(1);
}

 // 올릴 파일 두 개: 이미지 한 장과 텍스트 하나
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "cmt-"));
const png = path.join(tmp, "shot.png");
fs.writeFileSync(png, Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
));
const txt = path.join(tmp, "note.txt");
fs.writeFileSync(txt, "hello");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
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
const chooser = page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
await page.click("[aria-label='파일 첨부']");
const fc = await chooser;
if (!fc) d.push("클립을 눌러도 파일 선택창이 열리지 않습니다");
else if (!fc.isMultiple()) d.push("선택창이 단일 선택입니다 — 원본은 selectMultiple 입니다");

 // 2) 고른 파일이 칩으로 서고, 보내면 댓글에 붙는가
if (fc) {
  await fc.setFiles([png, txt]);
  await page.waitForSelector("[data-testid='attachment-chip']", { timeout: 20_000 });
  const chips = await page.locator("[data-testid='attachment-chip']").count();
  if (chips !== 2) d.push(`고른 파일 2개인데 칩이 ${chips}개입니다`);

 // 본문 없이 파일만으로도 보낼 수 있어야 한다
  const sendDisabled = await page.locator("[data-testid='comment-composer-submit']").isDisabled();
  if (sendDisabled) d.push("파일만 붙였을 때 보내기가 잠겨 있습니다 — 파일만으로도 댓글입니다");
  await page.click("[data-testid='comment-composer-submit']");
  await page.waitForTimeout(2500);

  const saved = await pg.query(
    "select body, attachments from comments where page_id=$1 order by created_at desc limit 1",
    [PAGE_ID]
  );
  const att = saved.rows[0]?.attachments ?? [];
  if (att.length !== 2) d.push(`저장된 첨부가 ${att.length}개입니다 — 2개여야 합니다`);
  for (const a of att)
    if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(a.url)) d.push(`첨부 url 이 이상합니다: ${a.url}`);

  const shown = await page.evaluate(() => ({
    images: document.querySelectorAll("[data-testid='comment-attachment-image']").length,
    files: document.querySelectorAll("[data-testid='comment-attachment-file']").length,
    chips: document.querySelectorAll("[data-testid='attachment-chip']").length,
  }));
  if (shown.images !== 1) d.push(`댓글에 그려진 이미지가 ${shown.images}개입니다 — 1개여야 합니다`);
  if (shown.files !== 1) d.push(`댓글에 그려진 파일 줄이 ${shown.files}개입니다 — 1개여야 합니다`);
  if (shown.chips) d.push("보낸 뒤에도 입력줄에 칩이 남아 있습니다");
}

await browser.close();
const { rows: gone } = await pg.query(
  "delete from comments where page_id=$1 and author_id=$2 returning attachments",
  [PAGE_ID, USER_ID]
);
await pg.end();
for (const r of gone)
  for (const a of r.attachments ?? []) {
    const f = path.join(process.cwd(), "public", a.url.replace(/^\//, ""));
    fs.rmSync(f, { force: true });
  }
fs.rmSync(tmp, { recursive: true, force: true });

if (d.length) {
  console.error("\n  ┌─ 댓글 클립이 원본과 다릅니다 ─────────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-row-comments.json (clip)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`클립 원본과 동일 — 선택창 다중 선택·확장자 제한 없음, 파일 2개가 붙어 저장·렌더 (정리한 댓글 ${gone.length}건)`);
