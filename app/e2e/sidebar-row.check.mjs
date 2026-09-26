// Sidebar page row: what shows up on hover, and can the ⋯ menu actually be clicked.
//
// Catches two things.
//  1) The original's row buttons are only three: `>` · `⋯` · `+` (20×20 each). We had
//     an extra six-dot grip.
//  2) If the actions are shown only via `group-hover`, the moment the pointer moves to
//     the menu the trigger becomes display:none, the CSS anchor disappears and the menu
//     collapses — its items could not be clicked. They must stay visible while the menu is open.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/sidebar-row.check.mjs
//
// Does not actually rename (only checks that the input appeared, then Escape).

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";

const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-sidebar-row.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 870 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='page-tree-item-']", { timeout: 120_000 });
await page.waitForTimeout(1000);

const row = page.locator("[data-testid^='page-tree-item-']").first();
const id = (await row.getAttribute("data-testid")).replace("page-tree-item-", "");
await row.hover();
await page.waitForTimeout(300);

const btns = await page.evaluate((id) => {
  const r = document.querySelector(`[data-testid='page-tree-item-${id}']`);
  return [...r.querySelectorAll("button")]
    .filter((b) => getComputedStyle(b).display !== "none" && getComputedStyle(b.parentElement).display !== "none")
    .map((b) => {
      const q = b.getBoundingClientRect();
      const svg = b.querySelector("svg");
      return { testid: b.dataset.testid ?? "", label: b.getAttribute("aria-label"),
        w: Math.round(q.width), h: Math.round(q.height), icon: svg ? Math.round(svg.getBoundingClientRect().width) : null };
    });
}, id);

const d = [];
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) d.push(`${w}: ours ${got} / Notion ${want}`); };

if (btns.some((b) => /drag/.test(b.testid)))
  d.push("the row has a drag grip (six dots) — the original has none");
if (btns.length !== G.buttons.length)
  d.push(`hover button count: ours ${btns.length}(${btns.map((b) => b.label).join(", ")}) / Notion ${G.buttons.length}`);
btns.forEach((b, i) => {
  const want = G.buttons[i];
  if (!want) return;
  near(`button ${i} size`, b.w, want.size);
  near(`button ${i} height`, b.h, want.size);
  near(`button ${i} icon`, b.icon, want.icon);
});

// After opening ⋯ and moving the pointer off the row, does the menu stay put and stay clickable
await page.locator(`[data-testid='page-item-menu-${id}']`).click();
await page.waitForTimeout(350);
const menu = page.locator(`[data-testid='page-menu-${id}']`);
const before = await menu.boundingBox();
await page.mouse.move(700, 500);
await page.waitForTimeout(400);
const after = await menu.boundingBox();
if (!before) d.push("clicking ⋯ does not open the menu");
else if (!after) d.push("the menu disappears once the pointer leaves the row");
else if (Math.abs(after.x - before.x) > 2 || Math.abs(after.y - before.y) > 2 || Math.abs(after.height - before.height) > 2)
  d.push(`the menu moved once the pointer left the row: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);

if (after) {
  await page.locator(`[data-testid='page-menu-rename-${id}']`).click().catch(() => d.push("the menu item cannot be clicked"));
  await page.waitForTimeout(400);
  const editing = await page.locator(`[data-testid='page-rename-input-${id}']`).isVisible().catch(() => false);
  if (!editing) d.push("clicking Rename does not show the input");
  await page.keyboard.press("Escape");
}

await browser.close();
if (d.length) {
  console.error(`\n  ┌─ Sidebar row differs from the original (${d.length}) ────────────────`);
  for (const x of d) console.error(`  │ ${x}`);
  console.error("  │\n  │ Reference: src/i18n/content/e2e-fixtures/notion-sidebar-row.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("Sidebar row OK — 3 buttons (20×20), the ⋯ menu stays after leaving the row and its items are clickable");
