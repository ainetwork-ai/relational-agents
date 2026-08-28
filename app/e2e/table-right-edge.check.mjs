// 맨 오른쪽까지 스크롤했을 때 표 뒤에 여백이 남는가.
//
// 원본은 마지막 열 뒤에 `+` 열(56px)과 **페이지 여백**을 두고 끝난다 (창 1443일 때
// 마지막 열 오른쪽 1617, 스크롤러 콘텐츠 오른쪽 1713 → 96px). 우리 표는 창 끝에
// 딱 붙어 끝나서 "끝까지 스크롤되지 않는" 느낌이었다 — 끝이 없었다.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/table-right-edge.check.mjs
//
// 읽기 전용: 가로 스크롤만 한다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const SC = ".no-native-scrollbar.overflow-x-auto";
/** 원본 96px. 좌측 인셋(104)과 8px 차이가 나는데 그건 쫓지 않았다. */
const WANT = 96, TOL = 16;

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 870 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-cellnav]", { timeout: 120_000 });
await page.waitForTimeout(1200);

const m = await page.evaluate((sc) => {
  const s = document.querySelector(sc);
  if (!s) return null;
  s.scrollLeft = s.scrollWidth;
  s.dispatchEvent(new Event("scroll", { bubbles: true }));
  const sr = s.getBoundingClientRect();
  const cells = [...document.querySelectorAll("[data-cellnav]")].map((c) => c.getBoundingClientRect().right);
  const lastCell = Math.max(...cells);
 // 페이지 여백 그 자체를 본다: `+` 어포던스의 폭은 원본(56px 열)과 우리(작은 버튼)가
 // 달라서, 버튼 오른쪽부터 재면 그 차이까지 섞인다
  return { atEnd: Math.round(s.scrollLeft) >= Math.round(s.scrollWidth - s.clientWidth) - 1,
    margin: Math.round(parseFloat(getComputedStyle(s).paddingRight)),
    lastCellVisible: lastCell <= sr.right + 1,
    scrollable: s.scrollWidth - s.clientWidth };
}, SC);
await browser.close();

const diffs = [];
if (!m) diffs.push("가로 스크롤러를 찾지 못했습니다");
else {
  if (!m.scrollable) diffs.push("표가 가로로 스크롤되지 않습니다");
  if (!m.atEnd) diffs.push("끝까지 스크롤되지 않았습니다");
  if (!m.lastCellVisible) diffs.push("끝까지 스크롤해도 마지막 열이 잘립니다");
  if (Math.abs(m.margin - WANT) > TOL)
    diffs.push(`표 뒤 페이지 여백: 우리 ${m.margin} / 노션 ${WANT} (±${TOL})`);
}
if (diffs.length) {
  console.error("\n  ┌─ 표 오른쪽 끝이 원본과 다릅니다 ──────────────────────────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │\n  │ useFullBleed 가 좌우 같은 인셋을 넣습니다 (table-view.tsx)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`표 오른쪽 끝 정상 — 끝까지 스크롤되고, 표 뒤 페이지 여백 ${m.margin}px (노션 ${WANT}px)`);
