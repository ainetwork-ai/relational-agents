// Compares the row peek (side page) insets against measurements of the original.
//
// The reference is src/i18n/content/e2e-fixtures/notion-peek-inset.json — values measured in Notion
// Projects by freshly opening the peek at window widths 1000–1800 (content inset fixed at 76px,
// peek width = 50% of the window, minimum 564). How it was measured and the pitfall (the 16px
// emulated scrollbar) are in the fixture's note.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/peek-inset.check.mjs
//
// Read-only: opens a row, measures, closes. Clears the saved peek width (localStorage) before measuring.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const G = JSON.parse(
  fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-peek-inset.json", import.meta.url), "utf8")
);

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const fails = [];
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fails.push(label);
};
const near = (a, b) => Math.abs(a - b) <= G.tolerance;

for (const win of [1200, 1000]) {
  const ctx = await browser.newContext({ viewport: { width: win, height: 858 } });
  await ctx.addCookies([
    { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
  ]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
  await page.evaluate(() => localStorage.removeItem("row-peek-width"));
  await page.locator("[data-cellnav]").first().hover();
  await page.locator(`text=${ko("Open")}`).first().click({ timeout: 5000 });
  await page.waitForSelector("[data-testid='db-peek-open-full']", { timeout: 10_000 });
  // Body blocks are drawn late by a separate fetch — wait until the editor appears
  await page.waitForSelector("[data-block-type] [contenteditable]", { timeout: 30_000 });
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    let peek = document.querySelector("[data-testid='db-peek-close']");
    while (peek && peek.getBoundingClientRect().height < innerHeight * 0.8)
      peek = peek.parentElement;
    const pr = peek.getBoundingClientRect();
    const block = peek.querySelector("[data-block-type] [contenteditable]");
    const br = block?.getBoundingClientRect();
    return {
      peekW: Math.round(pr.width),
      insetL: br ? Math.round(br.left - pr.left) : null,
      insetR: br ? Math.round(pr.right - br.right) : null,
    };
  });

  const wantW = Math.max(G.minWidth, Math.round(win * G.widthFraction));
  ok(near(m.peekW, wantW), `window ${win}: peek width ${m.peekW} ≈ ${wantW}`);
  ok(near(m.insetL, G.insetL), `window ${win}: left inset ${m.insetL} ≈ ${G.insetL}`);
  ok(near(m.insetR, G.insetR), `window ${win}: right inset ${m.insetR} ≈ ${G.insetR}`);
  await ctx.close();
}

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nNo difference from the original — exit 0");
