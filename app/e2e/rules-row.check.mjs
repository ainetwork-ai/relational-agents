// 뷰 탭 아래 규칙 줄(정렬 칩 · 필터 칩 · + 필터) — 툴바 필터 버튼이 접고 펴는지, 칩 치수.
//
// 원본은 이 줄을 기본으로 숨기고, 툴바 필터/정렬을 누르면 나온다(버튼은 눌린 박스).
// 우리는 항상 보였고, 칩은 11px 글자에 테두리 알약이었다.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/rules-row.check.mjs
//
// 읽기 전용에 가깝다: 필터 버튼을 눌렀다 다시 눌러 원래대로 돌려 놓는다(뷰 데이터는
// 건드리지 않는다). 새 브라우저 프로필이라 localStorage 는 비어 있다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects (dev DB)
const USER_ID = process.env.USER_ID ?? "933e2985-5b0e-4d94-8942-dfc1eb228f08";

const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-rules-row.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1728, height: 992 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid='db-filter']", { timeout: 120_000 });
await page.waitForTimeout(800);

const d = [];
const cmp = (label, ours, theirs, tol = 0.5) => {
  if (typeof theirs === "string" ? ours !== theirs : Math.abs(ours - theirs) > tol) d.push(`${label}: 우리 ${ours} / 노션 ${theirs}`);
};
const rowState = () =>
  page.evaluate(() => {
    const row = document.querySelector("[data-testid='db-filter-chips']");
    const btn = document.querySelector("[data-testid='db-filter']");
    return { rowH: row ? row.getBoundingClientRect().height : 0, btnBg: getComputedStyle(btn).backgroundColor };
  });

const s0 = await rowState();
cmp("처음(누르기 전) 줄 높이", s0.rowH, G.toggle.closedRowHeight);
const folded = await page.evaluate(() => {
  const vb = document.querySelector("[data-testid='db-view-bar']");
  const R = (el) => el.getBoundingClientRect();
  const tab = vb.querySelector("[data-testid^='db-view-tab-']");
  const btn = document.querySelector("[data-testid='db-filter']");
  let next = vb.nextElementSibling;
  while (next && R(next).height === 0) next = next.nextElementSibling;
  return { h: +R(vb).height.toFixed(2), activeTabOffset: +(R(tab).y - R(vb).y).toFixed(2), toolbarButtonOffset: +(R(btn).y - R(vb).y).toFixed(2), borderBottom: getComputedStyle(vb).borderBottomWidth === "0px" ? "none" : getComputedStyle(vb).borderBottom, gapToTableWhenFolded: +(R(next).y - R(vb).bottom).toFixed(2) };
});
for (const k of Object.keys(G.tabsRow)) cmp(`탭 줄 ${k}`, folded[k], G.tabsRow[k]);
await page.click("[data-testid='db-filter']");
await page.waitForTimeout(300);
const s1 = await rowState();
cmp("누른 뒤 줄 높이", s1.rowH, G.toggle.openRowHeight);
cmp("누른 뒤 버튼 배경", s1.btnBg, G.toggle.pressedBg);

const got = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const R = (el) => el.getBoundingClientRect();
  const cs = (el) => getComputedStyle(el);
  const px = (v) => +parseFloat(v).toFixed(2);
  const tabs = q("[data-testid^='db-view-tab-']");
  const row = q("[data-testid='db-filter-chips']");
  const strip = row.firstElementChild.firstElementChild;
  const sort = q("[data-testid='db-sort-chip-0']");
  const filter = q("[data-testid='db-filter-chip-0']");
  const add = q("[data-testid='db-filter-chip-add']");
  const sep = q("[data-testid='db-rules-separator']");
  const chip = (el) => ({ h: +R(el).height.toFixed(2), px: px(cs(el).paddingLeft), gap: px(cs(el).gap), radius: px(cs(el).borderRadius), fontSize: px(cs(el).fontSize), lineHeight: px(cs(el).lineHeight), color: cs(el).color, bg: cs(el).backgroundColor, iconH: el.querySelector("svg") ? +R(el.querySelector("svg")).height.toFixed(2) : 0, labelMaxW: px(cs(el.querySelector("span")).maxWidth) });
  return {
    gapAboveFromTabs: +(R(row).y - R(tabs.closest("[data-testid='db-view-bar']")).bottom).toFixed(2),
    gapBelowToTable: +(R(row.nextElementSibling).y - R(row).bottom).toFixed(2),
    conjunctionControl: !!q("[data-testid='db-fchip-conjunction']"),
    strip: { h: +R(strip).height.toFixed(2), p: px(cs(strip).paddingLeft), gap: px(cs(strip).gap) },
    wraps: cs(strip).flexWrap === "wrap",
    sort: sort && chip(sort),
    filter: filter && { ...chip(filter), typeIcon: +R(filter.querySelector("svg")).height.toFixed(2), nameWeight: +cs(filter.querySelector("span > span")).fontWeight, text: filter.innerText },
    sep: sep && { w: +R(sep).width.toFixed(2), h: +R(sep).height.toFixed(2), mx: px(cs(sep).marginLeft), color: cs(sep).backgroundColor },
    add: { h: +R(add).height.toFixed(2), pl: px(cs(add).paddingLeft), pr: px(cs(add).paddingRight), mr: px(cs(add).marginRight), radius: px(cs(add).borderRadius), fontSize: px(cs(add).fontSize), color: cs(add).color, plusIconH: +R(add.querySelector("svg")).height.toFixed(2) },
    order: [...strip.children].map((c) => (c.dataset.testid === "db-rules-separator" ? "separator" : (c.dataset.testid ?? c.querySelector("[data-testid]")?.dataset.testid ?? c.tagName).replace(/-\d+$/, ""))),
  };
});
cmp("탭 줄→규칙 줄 간격", got.gapAboveFromTabs, G.row.gapAboveFromTabs);
cmp("규칙 줄→표 간격", got.gapBelowToTable, G.row.gapBelowToTable);
if (got.conjunctionControl !== G.row.conjunctionControl) d.push("줄 안에 모두 일치/하나라도 일치 선택이 있습니다 — 원본 줄에는 없습니다");
for (const k of Object.keys(G.row.strip)) cmp(`스트립 ${k}`, got.strip[k], G.row.strip[k]);
if (got.wraps !== G.row.wraps) d.push(`줄바꿈: 우리 ${got.wraps} / 노션 ${G.row.wraps}`);
if (!got.sort) d.push("정렬 칩이 없습니다 (이 뷰에 정렬이 있어야 잽니다)");
else for (const k of Object.keys(G.chip)) cmp(`정렬 칩 ${k}`, got.sort[k], G.chip[k]);
if (!got.filter) d.push("필터 칩이 없습니다 (이 뷰에 필터가 있어야 잽니다)");
else {
  for (const k of Object.keys(G.chip)) if (k !== "iconH") cmp(`필터 칩 ${k}`, got.filter[k], G.chip[k]);
  cmp("필터 칩 타입 아이콘", got.filter.typeIcon, G.filterChip.typeIcon);
  cmp("필터 칩 이름 굵기", got.filter.nameWeight, G.filterChip.nameWeight);
  if (!/^\S+: /.test(got.filter.text)) d.push(`필터 칩 글: 우리 "${got.filter.text}" / 노션 "${G.filterChip.text}" 꼴`);
}
if (got.sort && got.filter) {
  if (!got.sep) d.push("정렬과 필터 사이 구분선이 없습니다");
  else for (const k of Object.keys(G.separator)) cmp(`구분선 ${k}`, got.sep[k], G.separator[k]);
}
for (const k of Object.keys(G.addFilter)) cmp(`+ 필터 ${k}`, got.add[k], G.addFilter[k]);
const wantOrder = ["db-sort-chip", "separator", "db-filter-chip", "db-filter-chip-add"];
const seen = got.order.filter((o) => wantOrder.includes(o)).filter((o, i, a) => a.indexOf(o) === i);
if (seen.join(",") !== wantOrder.join(",")) d.push(`순서: 우리 ${seen.join(" · ")} / 노션 ${G.order.join(" · ")}`);

await page.click("[data-testid='db-filter']");
await page.waitForTimeout(300);
const s2 = await rowState();
cmp("다시 누른 뒤 줄 높이", s2.rowH, G.toggle.closedRowHeight);
await browser.close();

if (d.length) {
  console.error("\n  ┌─ 규칙 줄이 원본과 다릅니다 ───────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-rules-row.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`필터 버튼이 규칙 줄을 접고 편다(0 → ${s1.rowH} → ${s2.rowH}); 칩 ${got.sort.h}px · 구분선 · + 필터 — 원본과 일치`);
