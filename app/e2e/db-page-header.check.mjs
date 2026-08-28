// 풀페이지 데이터베이스 페이지의 머리 — 커버 높이, 컨트롤 줄, 아이콘+제목 줄, 설명.
//
// 원본(Projects)에서는 아이콘(36×36)이 제목과 **한 줄**에 있고, 패딩 가장자리에서
// 아이콘 +8 / 제목 박스 +44(안쪽 8) / 설명 박스 +0(안쪽 12) 이다. 우리는 아이콘을
// 제목 위에 78px 로 올리고 둘 다 +44, 설명은 +8 에 두고 있었다. 커버도 30vh 였는데
// 원본의 DB 페이지 커버는 20vh 다.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/db-page-header.check.mjs
//
// 읽기 전용: 페이지를 열어 좌표만 읽는다. 페이지에 아이콘·커버·설명이 있어야 잰다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects (dev DB)
const USER_ID = process.env.USER_ID ?? "933e2985-5b0e-4d94-8942-dfc1eb228f08";

const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-db-page-header.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: G.viewport.w, height: G.viewport.h } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid='db-view-bar']", { timeout: 120_000 });
await page.waitForTimeout(800);
// the controls row only shows on hover; hover the title so it is laid out visibly
await page.hover("[data-testid='page-title']");

const got = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const R = (el) => el.getBoundingClientRect();
  const sidebar = q("[data-testid='sidebar']");
  const cover = q("[data-testid='page-cover-image']")?.parentElement;
  const icon = q("[data-testid='page-icon']");
  const title = q("[data-testid='page-title']");
  const desc = q("[data-testid='db-page-description']");
  const toggle = q("[data-testid='db-description-toggle']");
  const viewbar = q("[data-testid='db-view-bar']");
  if (!cover || !icon || !desc) return { missing: { cover: !cover, icon: !icon, desc: !desc } };
  const edge = R(sidebar).right + 96;
  const coverR = R(cover);
  const controls = toggle.parentElement;
  const cs = (el) => getComputedStyle(el);
  const px = (v) => +parseFloat(v).toFixed(2);
  return {
    edge,
    topbarHeight: +coverR.y.toFixed(2),
    coverHeight: +coverR.height.toFixed(2),
    controls: { y: +(R(controls).y - coverR.bottom).toFixed(2), h: +R(controls).height.toFixed(2), pt: px(cs(controls).paddingTop), pb: px(cs(controls).paddingBottom), buttonH: +R(toggle).height.toFixed(2) },
    icon: { x: +(R(icon).x - edge).toFixed(2), w: +R(icon).width.toFixed(2), h: +R(icon).height.toFixed(2), yInRow: +(R(icon).y - R(title).y).toFixed(2), radius: px(cs(icon).borderRadius) },
    title: { x: +(R(title).x - edge).toFixed(2), y: +(R(title).y - coverR.bottom).toFixed(2), h: +R(title).height.toFixed(2), pl: px(cs(title).paddingLeft), fontSize: px(cs(title).fontSize), lineHeight: px(cs(title).lineHeight), fontWeight: +cs(title).fontWeight },
    desc: { x: +(R(desc).x - edge).toFixed(2), y: +(R(desc).y - coverR.bottom).toFixed(2), pl: px(cs(desc).paddingLeft), pt: px(cs(desc).paddingTop), pb: px(cs(desc).paddingBottom), maxW: px(cs(desc).maxWidth), fontSize: px(cs(desc).fontSize), lineHeight: px(cs(desc).lineHeight) },
    tabsGapBelowDesc: +(R(viewbar).y - R(desc).bottom).toFixed(2),
    viewbarX: +(R(viewbar).x - edge).toFixed(2),
  };
});
await browser.close();

if (got.missing) {
  console.error(`이 페이지에는 잴 것이 빠져 있습니다: ${JSON.stringify(got.missing)} (아이콘·커버·설명이 있는 DB 페이지를 PAGE_ID 로 주세요)`);
  process.exit(1);
}

const d = [];
const cmp = (label, ours, theirs, tol = 0.5) => {
  if (Math.abs(ours - theirs) > tol) d.push(`${label}: 우리 ${ours} / 노션 ${theirs}`);
};
cmp("상단바 높이(커버 y)", got.topbarHeight, G.topbarHeight);
cmp("커버 높이", got.coverHeight, G.coverHeight);
for (const k of Object.keys(G.controls)) cmp(`컨트롤 줄 ${k}`, got.controls[k], G.controls[k]);
for (const k of Object.keys(G.icon)) cmp(`아이콘 ${k}`, got.icon[k], G.icon[k]);
cmp("제목 줄 y", got.title.y, G.titleRow.y);
cmp("제목 줄 h", got.title.h, G.titleRow.h);
for (const k of Object.keys(G.title)) cmp(`제목 ${k}`, got.title[k], G.title[k]);
for (const k of Object.keys(G.desc)) cmp(`설명 ${k}`, got.desc[k], G.desc[k]);
cmp("설명→뷰 탭 간격", got.tabsGapBelowDesc, G.tabsGapBelowDesc);

if (d.length) {
  console.error("\n  ┌─ DB 페이지 머리가 원본과 다릅니다 ───────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-db-page-header.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`아이콘 +${got.icon.x}, 제목 +${got.title.x}(pl ${got.title.pl}), 설명 +${got.desc.x}(pl ${got.desc.pl}), 커버 ${got.coverHeight}px — 원본과 일치 (뷰 탭 +${got.viewbarX})`);
