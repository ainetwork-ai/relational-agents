// Where the row controls (checkbox · ⠿) sit under horizontal scroll.
//
// When scrolled, ours stayed at a fixed viewport position and covered cell
// content. The original pins the controls to the scroller's left edge once
// scrolled, so only the checkbox stays at the edge (+11) and ⠿ moves outside
// the scroller and is hidden
// (src/i18n/content/e2e-fixtures/notion-row-gutter.json).
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/row-gutter.check.mjs
//
// Read-only: scrolling and hovering only.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const SC = ".no-native-scrollbar.overflow-x-auto";

const G = JSON.parse(
  fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-row-gutter.json", import.meta.url), "utf8"),
);
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 870 } });
await ctx.addCookies([
  { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-cellnav]", { timeout: 120_000 });
await page.waitForTimeout(1200);

// Bring the table on screen vertically only (scrollIntoView also moves horizontally)
await page.evaluate((sc) => {
  const row = [...document.querySelectorAll("div")].find((d) => d.className.includes?.("group/dbrow"));
  const s = document.querySelector(sc);
  const keep = s?.scrollLeft ?? 0;
  row?.scrollIntoView({ block: "center" });
  if (s) { s.scrollLeft = keep; s.dispatchEvent(new Event("scroll", { bubbles: true })); }
}, SC);
await page.waitForTimeout(600);

const measure = async (left) => {
  await page.evaluate(([sc, l]) => {
    const s = document.querySelector(sc);
    s.scrollLeft = l;
    s.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, [SC, left]);
  await page.waitForTimeout(400);
  const y = await page.evaluate(() =>
    [...document.querySelectorAll("div")]
      .filter((d) => d.className.includes?.("group/dbrow"))
      .map((d) => Math.round(d.getBoundingClientRect().top + d.getBoundingClientRect().height / 2))
      .find((v) => v > 200 && v < 800),
  );
  await page.mouse.move(700, y);
  await page.waitForTimeout(350);
  return page.evaluate(([sc, rowY]) => {
    const s = document.querySelector(sc);
    const sr = s.getBoundingClientRect();
    const rowEl = [...document.querySelectorAll("div")]
      .filter((d) => d.className.includes?.("group/dbrow"))
      .find((d) => Math.abs(d.getBoundingClientRect().top + d.getBoundingClientRect().height / 2 - rowY) < 20);
    const cell = rowEl?.querySelector("[data-cellnav]");
    const grab = (prefix) => {
      const e = [...document.querySelectorAll(`[data-testid^='${prefix}']`)].find(
        (n) => Math.abs(n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2 - rowY) < 20,
      );
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), visible: r.right > sr.left + 1 && r.left < sr.right };
    };
    return {
      scroller: Math.round(sr.left),
      row: cell ? Math.round(cell.getBoundingClientRect().left) : null,
      check: grab("db-row-check-"),
      grip: grab("db-row-drag-"),
    };
  }, [SC, y]);
};

const diffs = [];
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) diffs.push(`${w}: ours ${got} / Notion ${want}`); };

const at0 = await measure(0);
near("scroll 0 · checkbox (from row)", at0.check?.x - at0.row, G.notScrolled.checkboxFromRow);
near("scroll 0 · ⠿ (from row)", at0.grip?.x - at0.row, G.notScrolled.gripFromRow);
if (!at0.check?.visible) diffs.push("scroll 0 · checkbox is not visible");
if (!at0.grip?.visible) diffs.push("scroll 0 · ⠿ is not visible");

for (const left of [400, 1250]) {
  const at = await measure(left);
  near(`scroll ${left} · checkbox (from scroller)`, at.check?.x - at.scroller, G.scrolled.checkboxFromScroller);
  if (at.grip?.visible !== G.scrolled.gripVisible)
    diffs.push(`scroll ${left} · ⠿ visible: ours ${at.grip?.visible} / Notion ${G.scrolled.gripVisible}`);
 // What the overlap was: the controls stayed deep inside the scroller and were drawn over the cells
  if (at.check && at.check.x - at.scroller > 24)
    diffs.push(`scroll ${left} · checkbox overlaps the cells (scroller+${at.check.x - at.scroller})`);
}

await browser.close();

if (diffs.length) {
  console.error(`\n  ┌─ Row control positions differ from the original (${diffs.length}) ────────`);
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-row-gutter.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("Row control positions match the original — before scroll row−26/−62, after scroll only the checkbox at scroller+11");
