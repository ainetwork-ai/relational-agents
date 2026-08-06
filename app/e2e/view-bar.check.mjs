// 뷰 탭 줄과 툴바를 원본 수치와 대조한다 (fixtures/notion-view-bar.json).
//
// 우리 것은 12px 글씨의 밑줄 탭에, 툴바는 라벨과 개수 배지가 달린 알약이었다.
// 원본은 32px 알약 탭 + 28×28 아이콘 버튼이고, 활성 표시는 배경이 아니라
// **아이콘 색**이다.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/view-bar.check.mjs
//
// 읽기 전용: 아무것도 누르지 않는다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";

const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-view-bar.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 870 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='db-view-tab-']", { timeout: 120_000 });
await page.evaluate(() => document.querySelector("[data-testid^='db-view-tab-']")?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(600);

const m = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll("[data-testid^='db-view-tab-']")];
  const read = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), radius: s.borderRadius, bg: s.backgroundColor, fs: s.fontSize, fw: s.fontWeight, color: s.color };
  };
  const active = tabs.find((t) => getComputedStyle(t).backgroundColor !== "rgba(0, 0, 0, 0)") ?? tabs[0];
  const icon = active?.querySelector("svg");
  const toolbar = ["Filter", "Sort", "Properties"].map((l) => {
    const b = document.querySelector(`[aria-label='${l}']`);
    return b ? { label: l, ...read(b), icon: b.querySelector("svg") ? Math.round(b.querySelector("svg").getBoundingClientRect().width) : null } : { label: l, missing: true };
  });
  const primary = document.querySelector("[data-testid='db-new-row']");
  const caret = document.querySelector("[data-testid='db-new-row-more']");
  return {
    active: active ? { ...read(active), iconSize: icon ? Math.round(icon.getBoundingClientRect().width) : null, iconX: icon ? Math.round(icon.getBoundingClientRect().x - active.getBoundingClientRect().x) : null } : null,
    inactive: tabs.filter((t) => t !== active).map(read)[0] ?? null,
    toolbar,
    primary: primary ? { ...read(primary), text: primary.innerText.trim(), boxRadius: getComputedStyle(primary.parentElement).borderRadius, boxBg: getComputedStyle(primary.parentElement).backgroundColor, boxH: Math.round(primary.parentElement.getBoundingClientRect().height) } : null,
    caret: caret ? read(caret) : null,
  };
});
await browser.close();

const diffs = [];
const eq = (w, got, want) => { if (String(got) !== String(want)) diffs.push(`${w}: 우리 ${got} / 노션 ${want}`); };
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) diffs.push(`${w}: 우리 ${got} / 노션 ${want}`); };

eq("활성 탭 높이", m.active?.h, G.activeTab.h);
eq("활성 탭 radius", m.active?.radius, G.activeTab.radius);
eq("활성 탭 배경", m.active?.bg, G.activeTab.bg);
eq("활성 탭 글씨", m.active?.fs, G.activeTab.labelFs);
eq("활성 탭 굵기", m.active?.fw, G.activeTab.labelFw);
near("활성 탭 아이콘", m.active?.iconSize, G.activeTab.iconSize);
near("활성 탭 아이콘 x", m.active?.iconX, G.activeTab.padLeft);
eq("비활성 탭 배경", m.inactive?.bg, G.inactiveTab.bg);
eq("비활성 탭 글씨", m.inactive?.fs, G.inactiveTab.labelFs);

for (const b of m.toolbar) {
  if (b.missing) { diffs.push(`툴바 ${b.label} 버튼이 없습니다`); continue; }
  near(`툴바 ${b.label} 폭`, b.w, G.toolbar.size);
  near(`툴바 ${b.label} 높이`, b.h, G.toolbar.size);
  eq(`툴바 ${b.label} radius`, b.radius, G.toolbar.radius);
  near(`툴바 ${b.label} 아이콘`, b.icon, G.toolbar.iconSize);
  if (b.bg !== "rgba(0, 0, 0, 0)") diffs.push(`툴바 ${b.label} 에 배경이 있습니다 (${b.bg}) — 원본은 아이콘 색만 바뀝니다`);
}

eq("주 버튼 문구", m.primary?.text, G.primary.label);
near("주 버튼 높이", m.primary?.boxH, G.primary.h);
eq("주 버튼 radius", m.primary?.boxRadius, G.primary.radius.split(" ")[0]);
eq("주 버튼 배경", m.primary?.boxBg, G.primary.bg);
near("캐럿 폭", m.caret?.w, G.primary.caret.w);

if (diffs.length) {
  console.error(`\n  ┌─ 뷰 탭/툴바가 원본과 다릅니다 (${diffs.length}건) ─────────────`);
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │\n  │ 기준: e2e/fixtures/notion-view-bar.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("뷰 탭·툴바 원본과 일치 — 알약 탭, 28×28 아이콘 버튼, 분할 주 버튼");
