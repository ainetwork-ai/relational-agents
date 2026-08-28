// 댓글이 많아지면 접힌다 — 몇 개까지 펼쳐 두는가.
//
// 원본의 All Projects 뷰에서 댓글 달린 행 18개를 하나씩 열어 세어 나온 규칙:
// 3개까지는 전부, 4개부터는 **첫 개와 마지막 개**만 남고 나머지는
// `답글 N개 더 보기` 한 줄로 접힌다(N = 총 개수 − 2). 1·2·3·4·5·8·9·11 을 다 봤다.
//
//   [BASE_URL=…] [ROW_PAGE_ID=…] [USER_ID=…] node e2e/comment-collapse.check.mjs
//
// 이 스크립트는 dev DB 에 댓글을 넣었다 지운다 — dev 전용.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.ROW_PAGE_ID ?? "27b5c5e5-467c-4620-bde7-8d087e8a9875";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";

const F = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-row-comments.json", import.meta.url), "utf8"));
const G = F.collapse;
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();

const pg = new Client({ connectionString: pgUrl });
await pg.connect();
const { rows: existing } = await pg.query("select count(*)::int n from comments where page_id=$1", [PAGE_ID]);
if (existing[0].n) {
  console.error(`\n  ${PAGE_ID} 에 이미 댓글 ${existing[0].n}건이 있습니다 — 빈 페이지를 주세요 (ROW_PAGE_ID).\n`);
  await pg.end();
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("  페이지 오류:", String(e).slice(0, 200)));

const d = [];
let seeded = 0;
for (const want of G.observed) {
 // 이 단계에 필요한 만큼만 채운다
  for (let i = seeded; i < want.total; i++) {
    await pg.query(
      "insert into comments (page_id, block_id, parent_id, author_id, body) values ($1,null,null,$2,$3)",
      [PAGE_ID, USER_ID, `댓글 ${i + 1}`]
    );
    seeded++;
  }
  process.stdout.write(`  ${want.total}개 … `);
  await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector("[data-testid='page-comment-section']", { timeout: 60_000 });
  await page.waitForTimeout(1400);

  const got = await page.evaluate(() => {
    const sec = document.querySelector("[data-testid='page-comment-section']");
    const rows = [...sec.querySelectorAll("div[data-testid^='comment-row-']")];
    const more = sec.querySelector("[data-testid='comment-show-more']");
    return {
      rendered: rows.length,
      moreText: more ? more.innerText.trim() : null,
      bodies: rows.map((r) => r.querySelector("p")?.innerText.trim() ?? ""),
    };
  });

  console.log(`그려짐 ${got.rendered}, 더보기 ${JSON.stringify(got.moreText)}`);
  const label = `댓글 ${want.total}개`;
  if (got.rendered !== want.rendered)
    d.push(`${label}: 그려진 수 우리 ${got.rendered} / 노션 ${want.rendered}`);
  const wantLabel = want.hidden ? G.label.replace("{n}", String(want.hidden)) : null;
  if (got.moreText !== wantLabel)
    d.push(`${label}: 더보기 줄 우리 ${JSON.stringify(got.moreText)} / 노션 ${JSON.stringify(wantLabel)}`);
 // 접혔을 때는 첫 개와 마지막 개여야 한다 — 가운데 둘이 아니라
  if (want.hidden) {
    const first = `댓글 1`, last = `댓글 ${want.total}`;
    if (got.bodies[0] !== first || got.bodies[got.bodies.length - 1] !== last)
      d.push(`${label}: 남은 것이 ${JSON.stringify(got.bodies)} 입니다 — 첫 개("${first}")와 마지막 개("${last}")여야 합니다`);
  }
}

 // 마지막 상태(가장 많은 개수)에서 펼치기가 동작하는지
const top = G.observed[G.observed.length - 1];
await page.click("[data-testid='comment-show-more']");
await page.waitForTimeout(600);
const afterExpand = await page.evaluate(() => ({
  rendered: document.querySelectorAll("div[data-testid^='comment-row-']").length,
  more: !!document.querySelector("[data-testid='comment-show-more']"),
}));
if (afterExpand.rendered !== top.total)
  d.push(`펼친 뒤 ${afterExpand.rendered}개 — ${top.total}개여야 합니다`);
if (afterExpand.more) d.push("펼친 뒤에도 더보기 줄이 남아 있습니다 — 원본은 사라집니다");

await browser.close();
await pg.query("delete from comments where page_id=$1 and author_id=$2", [PAGE_ID, USER_ID]);
await pg.end();

if (d.length) {
  console.error("\n  ┌─ 댓글 접힘이 원본과 다릅니다 ─────────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-row-comments.json (collapse)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `접힘 규칙 원본과 일치 — ${G.observed.map((o) => `${o.total}→${o.rendered}`).join(" · ")}, 펼치면 ${top.total}개`
);
