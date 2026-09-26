// The head of a full-page database page — cover height, controls row, icon+title row, description.
//
// In the original (Projects) the icon (36×36) is on **one line** with the title, and from the
// padding edge it is icon +8 / title box +44 (inner 8) / description box +0 (inner 12). We put
// the icon 78px above the title with both at +44, and the description at +8. The cover was
// also 30vh, while the original's DB page cover is 20vh.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/db-page-header.check.mjs
//
// Read-only: opens the page and only reads coordinates. The page needs an icon, cover and description to measure.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects (dev DB)
const USER_ID = process.env.USER_ID ?? "933e2985-5b0e-4d94-8942-dfc1eb228f08";

const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-db-page-header.json", import.meta.url), "utf8"));
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
  console.error(`this page is missing things to measure: ${JSON.stringify(got.missing)} (pass a DB page with an icon, cover and description as PAGE_ID)`);
  process.exit(1);
}

const d = [];
const cmp = (label, ours, theirs, tol = 0.5) => {
  if (Math.abs(ours - theirs) > tol) d.push(`${label}: ours ${ours} / Notion ${theirs}`);
};
cmp("top bar height (cover y)", got.topbarHeight, G.topbarHeight);
cmp("cover height", got.coverHeight, G.coverHeight);
for (const k of Object.keys(G.controls)) cmp(`controls row ${k}`, got.controls[k], G.controls[k]);
for (const k of Object.keys(G.icon)) cmp(`icon ${k}`, got.icon[k], G.icon[k]);
cmp("title row y", got.title.y, G.titleRow.y);
cmp("title row h", got.title.h, G.titleRow.h);
for (const k of Object.keys(G.title)) cmp(`title ${k}`, got.title[k], G.title[k]);
for (const k of Object.keys(G.desc)) cmp(`description ${k}`, got.desc[k], G.desc[k]);
cmp("description→view tabs gap", got.tabsGapBelowDesc, G.tabsGapBelowDesc);

if (d.length) {
  console.error("\n  ┌─ DB page head differs from the original ─────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-db-page-header.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`icon +${got.icon.x}, title +${got.title.x}(pl ${got.title.pl}), description +${got.desc.x}(pl ${got.desc.pl}), cover ${got.coverHeight}px — matches the original (view tabs +${got.viewbarX})`);
