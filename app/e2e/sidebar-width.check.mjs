// The sidebar's width when first opened — the original is 270.
//
// Our default was 240. A 30px difference is barely noticeable inside the sidebar,
// but the body's starting x shifts as a whole, so every measurement of things that
// run to the right edge, like tables and toolbars, is off — it is why a table looks
// different even when its column widths match.
//
// Using the saved width when there is one matches the original (Notion keeps it in
// localStorage too). So this only looks at the first render of a **fresh profile with no saved value**.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/sidebar-width.check.mjs
//
// Read-only: opens the page and only reads coordinates.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai

const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-sidebar-width.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: G.viewport.w, height: G.viewport.h } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid='sidebar']", { timeout: 120_000 });
// The effect that reads the saved width is deferred to a microtask — measure after it has run
await page.waitForTimeout(1000);

const got = await page.evaluate(() => {
  const el = document.querySelector("[data-testid='sidebar']");
  const r = el.getBoundingClientRect();
  return {
    width: +r.width.toFixed(2),
    x: +r.x.toFixed(2),
    right: +r.right.toFixed(2),
    saved: localStorage.getItem("sidebar-width"),
  };
});
await browser.close();

const d = [];
if (got.saved !== null) d.push(`fresh profile but a saved width exists: ${got.saved} (the test is contaminated)`);
if (Math.abs(got.width - G.width) > 0.5) d.push(`width: ours ${got.width} / Notion ${G.width}`);
if (Math.abs(got.x - G.x) > 0.5) d.push(`left edge x: ours ${got.x} / Notion ${G.x}`);
if (Math.abs(got.right - G.frameStartsAt) > 0.5)
  d.push(`body start x: ours ${got.right} / Notion ${G.frameStartsAt}`);

if (d.length) {
  console.error("\n  ┌─ Sidebar width differs from the original ─────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-sidebar-width.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`Sidebar width ${got.width}px, body starts at ${got.right}px — matches the original`);
