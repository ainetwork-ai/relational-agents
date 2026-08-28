// 행 피크(사이드 페이지)의 여백을 원본 실측과 대조한다.
//
// 기준은 fixtures/notion-peek-inset.json — 노션 Projects에서 창 1000~1800으로
// 피크를 새로 열어가며 잰 값이다(콘텐츠 인셋 76px 고정, 피크 폭 = 창의 50%,
// 하한 564). 재는 법과 함정(에뮬레이션 스크롤바 16px)은 픽스처의 note 에.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/peek-inset.check.mjs
//
// 읽기 전용: 행을 열어 재고 닫는다. 저장된 피크 폭(localStorage)은 지우고 잰다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const G = JSON.parse(
  fs.readFileSync(new URL("./fixtures/notion-peek-inset.json", import.meta.url), "utf8")
);

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const fails = [];
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fails.push(label);
};
const near = (a, b) => Math.abs(a - b) <= G.tolerance;

for (const win of [1200, 1000]) {
  const ctx = await browser.newContext({ viewport: { width: win, height: 858 } });
  await ctx.addCookies([
    { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
  ]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
  await page.evaluate(() => localStorage.removeItem("row-peek-width"));
  await page.locator("[data-cellnav]").first().hover();
  await page.locator("text=열기").first().click({ timeout: 5000 });
  await page.waitForSelector("[data-testid='db-peek-open-full']", { timeout: 10_000 });
  // 본문 블록은 별도 fetch 로 뒤늦게 그려진다 — 에디터가 뜰 때까지 기다린다
  await page.waitForSelector("[data-block-type] [contenteditable]", { timeout: 30_000 });
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    let peek = document.querySelector("[data-testid='db-peek-close']");
    while (peek && peek.getBoundingClientRect().height < innerHeight * 0.8)
      peek = peek.parentElement;
    const pr = peek.getBoundingClientRect();
    const block = peek.querySelector("[data-block-type] [contenteditable]");
    const br = block?.getBoundingClientRect();
    return {
      peekW: Math.round(pr.width),
      insetL: br ? Math.round(br.left - pr.left) : null,
      insetR: br ? Math.round(pr.right - br.right) : null,
    };
  });

  const wantW = Math.max(G.minWidth, Math.round(win * G.widthFraction));
  ok(near(m.peekW, wantW), `창 ${win}: 피크 폭 ${m.peekW} ≈ ${wantW}`);
  ok(near(m.insetL, G.insetL), `창 ${win}: 왼쪽 인셋 ${m.insetL} ≈ ${G.insetL}`);
  ok(near(m.insetR, G.insetR), `창 ${win}: 오른쪽 인셋 ${m.insetR} ≈ ${G.insetR}`);
  await ctx.close();
}

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length}개 실패`);
  process.exit(1);
}
console.log("\n원본과 차이 없음 — exit 0");
