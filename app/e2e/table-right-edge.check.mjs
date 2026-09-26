// When scrolled all the way right, is there margin left after the table?
//
// The original ends with a `+` column (56px) and the **page margin** after the last column (at window 1443,
// last column right 1617, scroller content right 1713 → 96px). Our table ended flush against the window
// edge, so it felt like it "doesn't scroll to the end" — there was no end.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/table-right-edge.check.mjs
//
// Read-only: only scrolls horizontally.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const SC = ".no-native-scrollbar.overflow-x-auto";
/** Original is 96px. It differs from the left inset (104) by 8px, which we did not chase. */
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
 // Look at the page margin itself: the width of the `+` affordance differs between the original (a 56px column)
 // and ours (a small button), so measuring from the button's right edge would mix that difference in
  return { atEnd: Math.round(s.scrollLeft) >= Math.round(s.scrollWidth - s.clientWidth) - 1,
    margin: Math.round(parseFloat(getComputedStyle(s).paddingRight)),
    lastCellVisible: lastCell <= sr.right + 1,
    scrollable: s.scrollWidth - s.clientWidth };
}, SC);
await browser.close();

const diffs = [];
if (!m) diffs.push("Could not find the horizontal scroller");
else {
  if (!m.scrollable) diffs.push("The table does not scroll horizontally");
  if (!m.atEnd) diffs.push("Did not scroll to the end");
  if (!m.lastCellVisible) diffs.push("The last column is clipped even when scrolled to the end");
  if (Math.abs(m.margin - WANT) > TOL)
    diffs.push(`page margin after table: ours ${m.margin} / Notion ${WANT} (±${TOL})`);
}
if (diffs.length) {
  console.error("\n  ┌─ table right edge differs from the original ──────────────────────────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │\n  │ useFullBleed puts the same inset on the left and right (table-view.tsx)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`table right edge OK — scrolls to the end, page margin after table ${m.margin}px (Notion ${WANT}px)`);
