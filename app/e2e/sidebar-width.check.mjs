// 사이드바가 처음 열렸을 때의 폭 — 원본은 270이다.
//
// 우리 기본값은 240이었다. 30px 차이는 사이드바 안에서는 티가 잘 안 나지만,
// 본문 시작 x 가 통째로 밀리기 때문에 표·툴바처럼 오른쪽 끝까지 가는 것들의
// 잰 값이 전부 어긋난다 — 열 폭이 맞는데도 표가 다르게 보이는 원인이 된다.
//
// 저장된 폭이 있으면 그걸 쓰는 건 원본과 같다(노션도 localStorage 에 들고 있다).
// 그래서 여기서는 **저장된 값이 없는 새 프로필**의 첫 렌더만 본다.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/sidebar-width.check.mjs
//
// 읽기 전용: 페이지를 열어 좌표만 읽는다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai

const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-sidebar-width.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: G.viewport.w, height: G.viewport.h } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid='sidebar']", { timeout: 120_000 });
// 저장된 폭을 읽는 effect 는 마이크로태스크로 미뤄져 있다 — 그것까지 지나간 뒤에 잰다
await page.waitForTimeout(1000);

const got = await page.evaluate(() => {
  const el = document.querySelector("[data-testid='sidebar']");
  const r = el.getBoundingClientRect();
  return {
    width: +r.width.toFixed(2),
    x: +r.x.toFixed(2),
    right: +r.right.toFixed(2),
    saved: localStorage.getItem("sidebar-width"),
  };
});
await browser.close();

const d = [];
if (got.saved !== null) d.push(`새 프로필인데 저장된 폭이 있습니다: ${got.saved} (테스트가 오염됐습니다)`);
if (Math.abs(got.width - G.width) > 0.5) d.push(`폭: 우리 ${got.width} / 노션 ${G.width}`);
if (Math.abs(got.x - G.x) > 0.5) d.push(`왼쪽 끝 x: 우리 ${got.x} / 노션 ${G.x}`);
if (Math.abs(got.right - G.frameStartsAt) > 0.5)
  d.push(`본문 시작 x: 우리 ${got.right} / 노션 ${G.frameStartsAt}`);

if (d.length) {
  console.error("\n  ┌─ 사이드바 폭이 원본과 다릅니다 ───────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-sidebar-width.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`사이드바 폭 ${got.width}px, 본문 시작 ${got.right}px — 원본과 일치`);
