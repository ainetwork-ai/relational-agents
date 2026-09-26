// A hover affordance has a SCOPE, and the only way to see the scope is to look
// at what did NOT light up.
//
// The original shows Open for the whole row and Comment/Copy for the one column the
// pointer is in. We shipped both keyed to the row's hover group, so pointing at
// any cell lit the Comment button in every qualifying cell of that row. Nothing was
// missing or misplaced — the button I checked was exactly where it belonged —
// so measuring the hovered cell alone said "correct" every time. The bug lives
// in the siblings.
//
// Hovers cells across one row and asserts, for each: exactly ONE cell shows an
// action bar and it is the hovered one, while Open stays lit throughout.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] \
//     node e2e/db-hover-scope.check.mjs
//
// Read-only: hovering changes nothing, and nothing is clicked.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238"; // Projects
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
await ctx.addCookies([
  { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });

// a row with enough action-bearing cells for "only one" to mean something
const probe = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("div")].filter((d) =>
    d.className.includes?.("group/dbrow"),
  );
  for (const r of rows) {
    const acts = r.querySelectorAll(
      "[data-testid^='db-cell-comment-'],[data-testid^='db-cell-copy-']",
    );
    if (acts.length >= 3) {
      r.dataset.hoverProbe = "1";
      return { actions: acts.length, cells: r.querySelectorAll(":scope > [data-cellnav]").length };
    }
  }
  return null;
});
if (!probe) {
  console.error("no row with 3+ action cells — nothing to check");
  await browser.close();
  process.exit(1);
}

const cells = page.locator("[data-hover-probe='1'] > [data-cellnav]");
const total = await cells.count();
const withActions = await page.evaluate(() =>
  [...document.querySelectorAll("[data-hover-probe='1'] > [data-cellnav]")]
    .map((c, i) =>
      c.querySelector("[data-testid^='db-cell-comment-'],[data-testid^='db-cell-copy-']") ? i : -1,
    )
    .filter((i) => i >= 0),
);

const failures = [];
for (const i of withActions) {
  await cells.nth(i).hover();
  await page.waitForTimeout(200);
  const state = await page.evaluate((openLabel) => {
    const row = document.querySelector("[data-hover-probe='1']");
    const lit = [];
    [...row.querySelectorAll(":scope > [data-cellnav]")].forEach((c, idx) => {
      const bar = c.querySelector(
        "[data-testid^='db-cell-comment-'],[data-testid^='db-cell-copy-']",
      )?.parentElement;
      if (bar && Number(getComputedStyle(bar).opacity) > 0.5) lit.push(idx);
    });
    const open = row.querySelector(`[aria-label='${openLabel}']`);
 // the BUTTON's own painted opacity, not its parent's: reading the parent was
 // reading the cell, which is always 1, and it hid a button that never showed
    const openOpacity = open
      ? [open, ...(function up(e) { const out = []; let n = e; while (n && n !== row) { out.push(n); n = n.parentElement; } return out; })(open)]
          .reduce((acc, n) => acc * Number(getComputedStyle(n).opacity), 1)
      : null;
    return { lit, open: openOpacity };
  }, ko("Open in side peek"));
  const ok = state.lit.length === 1 && state.lit[0] === i;
  if (!ok) failures.push(`hover cell #${i}: lit ${JSON.stringify(state.lit)}, expected [${i}]`);
  if (!(state.open > 0.5)) failures.push(`hover cell #${i}: Open not shown (${state.open})`);
  console.log(`cell #${i} → lit ${JSON.stringify(state.lit)}  Open ${state.open}`);
}

await browser.close();

if (failures.length) {
  console.error("\nThe cell hover scope is wrong:");
  for (const f of failures) console.error(`  ${f}`);
  console.error("\nComment/Copy belong to the one cell under the pointer only; Open belongs to the whole row.");
  console.error("Keying them to group-hover/dbrow lights up every cell of that row together.\n");
  process.exit(1);
}
console.log(`\nHover scope OK — each of ${withActions.length} cells lights only its own (row has ${total} cells)`);
