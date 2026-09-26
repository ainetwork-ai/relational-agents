// The rules row under the view tabs (sort chip · filter chip · + Filter) — whether the toolbar Filter button folds and unfolds it, and chip dimensions.
//
// The original hides this row by default and shows it when the toolbar Filter/Sort is pressed (the button becomes a pressed box).
// Ours was always visible, and the chips were bordered pills with 11px text.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/rules-row.check.mjs
//
// Close to read-only: presses the Filter button and presses it again to put it back (view data is
// not touched). A fresh browser profile, so localStorage is empty.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects (dev DB)
const USER_ID = process.env.USER_ID ?? "933e2985-5b0e-4d94-8942-dfc1eb228f08";

const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-rules-row.json", import.meta.url), "utf8"));
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
  if (typeof theirs === "string" ? ours !== theirs : Math.abs(ours - theirs) > tol) d.push(`${label}: ours ${ours} / Notion ${theirs}`);
};
const rowState = () =>
  page.evaluate(() => {
    const row = document.querySelector("[data-testid='db-filter-chips']");
    const btn = document.querySelector("[data-testid='db-filter']");
    return { rowH: row ? row.getBoundingClientRect().height : 0, btnBg: getComputedStyle(btn).backgroundColor };
  });

const s0 = await rowState();
cmp("row height at first (before pressing)", s0.rowH, G.toggle.closedRowHeight);
const folded = await page.evaluate(() => {
  const vb = document.querySelector("[data-testid='db-view-bar']");
  const R = (el) => el.getBoundingClientRect();
  const tab = vb.querySelector("[data-testid^='db-view-tab-']");
  const btn = document.querySelector("[data-testid='db-filter']");
  let next = vb.nextElementSibling;
  while (next && R(next).height === 0) next = next.nextElementSibling;
  return { h: +R(vb).height.toFixed(2), activeTabOffset: +(R(tab).y - R(vb).y).toFixed(2), toolbarButtonOffset: +(R(btn).y - R(vb).y).toFixed(2), borderBottom: getComputedStyle(vb).borderBottomWidth === "0px" ? "none" : getComputedStyle(vb).borderBottom, gapToTableWhenFolded: +(R(next).y - R(vb).bottom).toFixed(2) };
});
for (const k of Object.keys(G.tabsRow)) cmp(`tabs row ${k}`, folded[k], G.tabsRow[k]);
await page.click("[data-testid='db-filter']");
await page.waitForTimeout(300);
const s1 = await rowState();
cmp("row height after pressing", s1.rowH, G.toggle.openRowHeight);
cmp("button background after pressing", s1.btnBg, G.toggle.pressedBg);

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
cmp("tabs row → rules row gap", got.gapAboveFromTabs, G.row.gapAboveFromTabs);
cmp("rules row → table gap", got.gapBelowToTable, G.row.gapBelowToTable);
if (got.conjunctionControl !== G.row.conjunctionControl) d.push("the row has an all-match/any-match choice — the original row does not");
for (const k of Object.keys(G.row.strip)) cmp(`strip ${k}`, got.strip[k], G.row.strip[k]);
if (got.wraps !== G.row.wraps) d.push(`wrapping: ours ${got.wraps} / Notion ${G.row.wraps}`);
if (!got.sort) d.push("no sort chip (this view needs a sort to measure)");
else for (const k of Object.keys(G.chip)) cmp(`sort chip ${k}`, got.sort[k], G.chip[k]);
if (!got.filter) d.push("no filter chip (this view needs a filter to measure)");
else {
  for (const k of Object.keys(G.chip)) if (k !== "iconH") cmp(`filter chip ${k}`, got.filter[k], G.chip[k]);
  cmp("filter chip type icon", got.filter.typeIcon, G.filterChip.typeIcon);
  cmp("filter chip name weight", got.filter.nameWeight, G.filterChip.nameWeight);
  if (!/^\S+: /.test(got.filter.text)) d.push(`filter chip text: ours "${got.filter.text}" / Notion shaped like "${G.filterChip.text}"`);
}
if (got.sort && got.filter) {
  if (!got.sep) d.push("no separator between sort and filter");
  else for (const k of Object.keys(G.separator)) cmp(`separator ${k}`, got.sep[k], G.separator[k]);
}
for (const k of Object.keys(G.addFilter)) cmp(`+ Filter ${k}`, got.add[k], G.addFilter[k]);
const wantOrder = ["db-sort-chip", "separator", "db-filter-chip", "db-filter-chip-add"];
const seen = got.order.filter((o) => wantOrder.includes(o)).filter((o, i, a) => a.indexOf(o) === i);
if (seen.join(",") !== wantOrder.join(",")) d.push(`order: ours ${seen.join(" · ")} / Notion ${G.order.join(" · ")}`);

await page.click("[data-testid='db-filter']");
await page.waitForTimeout(300);
const s2 = await rowState();
cmp("row height after pressing again", s2.rowH, G.toggle.closedRowHeight);
await browser.close();

if (d.length) {
  console.error("\n  ┌─ The rules row differs from the original ─────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ reference: src/i18n/content/e2e-fixtures/notion-rules-row.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`the Filter button folds and unfolds the rules row (0 → ${s1.rowH} → ${s2.rowH}); chip ${got.sort.h}px · separator · + Filter — matches the original`);

