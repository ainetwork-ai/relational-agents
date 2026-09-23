// 한글 조합 중의 Enter 는 "글자 확정"이지 "보내기"가 아니다.
//
// 댓글 하나를 쓰고 Enter 를 한 번 눌렀는데 두 건이 달렸다 — 전체 글과, 1~4ms 뒤에
// 마지막 글자 하나가 따로:
//
//   06:28:44.091  댓끌
//   06:28:44.095  끌
//
// 한 번의 키 입력이 keydown 두 번으로 오기 때문이다. 첫 번째는 keyCode 229 ·
// isComposing=true (IME 가 글자를 확정하겠다는 것)인데 우리는 그걸 보내기로 받아
// 입력칸을 비웠고, IME 가 조합 중이던 글자를 빈 칸에 다시 써 넣은 뒤 두 번째
// (평범한) Enter 가 그 찌꺼기를 또 보냈다. 라틴 문자는 조합을 안 하므로 한국어에서만
// 보였다.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/ime-enter.check.mjs
//
// 이 스크립트는 댓글을 실제로 만든다 — dev DB 전용. 만든 것은 끝나고 지운다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "27b5c5e5-467c-4620-bde7-8d087e8a9875";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const TEXT = "댓글";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
const posts = [];
page.on("request", (r) => {
  if (r.method() === "POST" && /\/comments$/.test(r.url())) posts.push(JSON.parse(r.postData() ?? "{}").body);
});
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid='comment-composer-input']", { timeout: 120_000 });
await page.waitForTimeout(1200);
await page.click("[data-testid='comment-composer-input']");

const cdp = await ctx.newCDPSession(page);
 // 마지막 글자를 조합 중인 상태를 만든다
await cdp.send("Input.imeSetComposition", { text: TEXT, selectionStart: TEXT.length, selectionEnd: TEXT.length });
await page.waitForTimeout(150);

 // 1) 조합 중 Enter (keyCode 229) — 아무것도 보내면 안 된다
await cdp.send("Input.dispatchKeyEvent", {
  type: "rawKeyDown", key: "Enter", code: "Enter",
  windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229,
});
await page.waitForTimeout(700);
const afterComposing = posts.length;

 // 2) 조합을 확정시킨 뒤의 평범한 Enter — 여기서 한 번만, 글자 전체를 보내야 한다
await cdp.send("Input.insertText", { text: TEXT });
await page.waitForTimeout(200);
const beforeEnter = await page.inputValue("[data-testid='comment-composer-input']");
await page.keyboard.press("Enter");
await page.waitForTimeout(2000);

const value = await page.inputValue("[data-testid='comment-composer-input']");
await browser.close();

 // 만든 댓글은 치운다 — 검사가 dev DB 에 쓰레기를 남기지 않게
const { Client } = await import("pg");
const url = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const pg = new Client({ connectionString: url });
await pg.connect();
const { rows } = await pg.query(
  "delete from comments where page_id=$1 and author_id=$2 and body like $3 returning body",
  [PAGE_ID, USER_ID, `%${TEXT}%`]
);
await pg.end();

const d = [];
if (afterComposing !== 0)
  d.push(`조합 중(keyCode 229) Enter 에 ${afterComposing}건을 보냈습니다 — 0건이어야 합니다`);
if (posts.length !== 1)
  d.push(`Enter 한 번에 ${posts.length}건을 보냈습니다 (${posts.map((b) => JSON.stringify(b)).join(", ")}) — 1건이어야 합니다`);
if (posts.length && posts[0] !== TEXT)
  d.push(`보낸 내용이 "${posts[0]}" 입니다 — "${TEXT}" 여야 합니다 (마지막 글자만 남는 그 증상)`);
if (value !== "") d.push(`보낸 뒤 입력칸에 "${value}" 가 남아 있습니다`);
if (beforeEnter !== TEXT)
  d.push(`Enter 직전 입력칸이 "${beforeEnter}" 입니다 — 조합 확정이 재현되지 않았습니다(검사 자체가 고장)`);

if (d.length) {
  console.error("\n  ┌─ 한글 조합 중 Enter 가 잘못 동작합니다 ───────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 가드: src/hooks/use-ime-guard.ts");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`조합 중 Enter 는 안 보내고, 확정 뒤 Enter 에 "${posts[0]}" 1건 — 정리한 댓글 ${rows.length}건`);
