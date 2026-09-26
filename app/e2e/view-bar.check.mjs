// Compares the view tab row and toolbar against the original's numbers (src/i18n/content/e2e-fixtures/notion-view-bar.json).
//
// Ours had underlined tabs in 12px text, and the toolbar was pills with labels and count badges.
// The original is 32px pill tabs + 28×28 icon buttons, and the active state is shown by the
// **icon color**, not a background.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/view-bar.check.mjs
//
// Read-only: clicks nothing.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";

const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-view-bar.json", import.meta.url), "utf8"));
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
const eq = (w, got, want) => { if (String(got) !== String(want)) diffs.push(`${w}: ours ${got} / Notion ${want}`); };
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) diffs.push(`${w}: ours ${got} / Notion ${want}`); };

eq("active tab height", m.active?.h, G.activeTab.h);
eq("active tab radius", m.active?.radius, G.activeTab.radius);
eq("active tab background", m.active?.bg, G.activeTab.bg);
eq("active tab text", m.active?.fs, G.activeTab.labelFs);
eq("active tab weight", m.active?.fw, G.activeTab.labelFw);
near("active tab icon", m.active?.iconSize, G.activeTab.iconSize);
near("active tab icon x", m.active?.iconX, G.activeTab.padLeft);
eq("inactive tab background", m.inactive?.bg, G.inactiveTab.bg);
eq("inactive tab text", m.inactive?.fs, G.inactiveTab.labelFs);

for (const b of m.toolbar) {
  if (b.missing) { diffs.push(`toolbar ${b.label} button is missing`); continue; }
  near(`toolbar ${b.label} width`, b.w, G.toolbar.size);
  near(`toolbar ${b.label} height`, b.h, G.toolbar.size);
  eq(`toolbar ${b.label} radius`, b.radius, G.toolbar.radius);
  near(`toolbar ${b.label} icon`, b.icon, G.toolbar.iconSize);
  if (b.bg !== "rgba(0, 0, 0, 0)") diffs.push(`toolbar ${b.label} has a background (${b.bg}) — in the original only the icon color changes`);
}

eq("primary button text", m.primary?.text, G.primary.label);
near("primary button height", m.primary?.boxH, G.primary.h);
eq("primary button radius", m.primary?.boxRadius, G.primary.radius.split(" ")[0]);
eq("primary button background", m.primary?.boxBg, G.primary.bg);
near("caret width", m.caret?.w, G.primary.caret.w);

if (diffs.length) {
  console.error(`\n  ┌─ View tabs/toolbar differ from the original (${diffs.length}) ─────────────`);
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │\n  │ reference: src/i18n/content/e2e-fixtures/notion-view-bar.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("view tabs and toolbar match the original — pill tabs, 28×28 icon buttons, split primary button");

