// Compares the `Open` button that appears on hovering a title cell against the original's numbers.
// Reference: src/i18n/content/e2e-fixtures/notion-title-cell.json (the original is a 51×20 button inside a white 55×24 pad).
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] [TITLE_PROP=…] node e2e/title-open.check.mjs
//
// Read-only: it only hovers.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const TITLE = process.env.TITLE_PROP ?? "3c55e8de-8e4b-4257-8321-3467eeb8ff6a";

const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-title-cell.json", import.meta.url), "utf8")).openButton;
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

const sel = `[data-testid^='db-cell-'][data-testid$='-${TITLE}']`;
await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center", inline: "start" }), sel);
await page.waitForTimeout(500);
const cr = await page.locator(sel).first().evaluate((c) => {
  const e = c.closest("[data-cellnav]") ?? c;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
await page.mouse.move(cr.x + 120, cr.y + 18);
await page.waitForTimeout(400);

const m = await page.evaluate((c) => {
  const btn = document.querySelector("[data-testid^='db-title-open-']");
  if (!btn) return null;
  const pad = btn.parentElement;
  const read = (e) => { const b = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { h: Math.round(b.height), radius: s.borderRadius, bg: s.backgroundColor, padding: s.padding, gap: s.gap, fs: s.fontSize, fw: s.fontWeight, color: s.color, shadow: s.boxShadow, opacity: Number(s.opacity), pe: s.pointerEvents }; };
  const svg = btn.querySelector("svg");
  return { pad: { ...read(pad), rightInset: Math.round(c.x + c.w - pad.getBoundingClientRect().right) },
    inner: read(btn), icon: svg ? { size: Math.round(svg.getBoundingClientRect().width), color: getComputedStyle(svg).color } : null,
    label: btn.textContent.trim(), aria: btn.getAttribute("aria-label") };
}, cr);
await browser.close();

const d = [];
const eq = (w, got, want) => { if (String(got) !== String(want)) d.push(`${w}: ours ${got} / Notion ${want}`); };
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) d.push(`${w}: ours ${got} / Notion ${want}`); };

if (!m) d.push("no Open button even on hover");
else {
  if (m.pad.opacity < 0.9) d.push(`hovered but Open is not visible (opacity ${m.pad.opacity})`);
  near("pad height", m.pad.h, G.pad.h);
  eq("pad radius", m.pad.radius, G.pad.radius);
  eq("pad background", m.pad.bg, G.pad.bg);
  eq("pad padding", m.pad.padding, G.pad.padding);
  eq("pad shadow", m.pad.shadow, G.pad.shadow);
  near("right inset", m.pad.rightInset, G.pad.rightInset);
  near("button height", m.inner.h, G.inner.h);
  eq("button radius", m.inner.radius, G.inner.radius);
  eq("button padding", m.inner.padding, G.inner.padding);
  eq("button gap", m.inner.gap, G.inner.gap);
  eq("label size", m.inner.fs, G.inner.fs);
  eq("label weight", m.inner.fw, G.inner.fw);
  eq("label color", m.inner.color, G.inner.color);
  near("icon size", m.icon?.size, G.icon.size);
  eq("icon color", m.icon?.color, G.icon.color);
  eq("label", m.label, G.label);
  eq("aria-label", m.aria, G.ariaLabel);
}

if (d.length) {
  console.error(`\n  ┌─ The title cell's Open button differs from the original (${d.length}) ─`);
  for (const x of d) console.error(`  │ ${x}`);
  console.error("  │\n  │ reference: src/i18n/content/e2e-fixtures/notion-title-cell.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("title cell Open button matches the original — white pad 24 + button 20, 12px/500, icon 15");

