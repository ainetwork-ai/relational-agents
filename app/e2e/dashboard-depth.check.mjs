// Dashboard depth widget — cumulative step areas for two sides (order book style).
//
// Builds a Price (level) × Size × Side (bid/ask) ladder and checks the two step polygons,
// the cumulative sums, switching size → count, and switching the level axis.
//
//   [BASE_URL=…] node e2e/dashboard-depth.check.mjs

import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
await page.request.post(`${BASE}/api/auth/demo-login`);
const api = async (method, path, body) => {
  const r = await page.request.fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    data: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()} ${await r.text()}`);
  return r.json();
};

const db = await api("POST", "/api/databases", { title: "depth-check", shape: "minimal" });
const dbId = db.database?.id ?? db.id;
const mk = async (name, type, config) =>
  (await api("POST", `/api/databases/${dbId}/properties`, { name, type, ...(config && { config }) })).property?.id;
const priceId = await mk("Price", "number");
const sizeId = await mk("Size", "number");
const sideId = await mk("Side", "select", {
  options: [
    { id: "bid", name: "Bid", color: "green" },
    { id: "ask", name: "Ask", color: "red" },
  ],
});

// bid 3 levels (cumulative 60), ask 2 levels (cumulative 70) — level 98 must sum two rows
const ladder = [
  [98, 10, "bid"], [98, 20, "bid"], [97, 15, "bid"], [96, 15, "bid"],
  [102, 30, "ask"], [104, 40, "ask"],
];
for (const [p, s, side] of ladder)
  await api("POST", `/api/databases/${dbId}/rows`, { values: { [priceId]: p, [sizeId]: s, [sideId]: side } });

await api("POST", `/api/databases/${dbId}/views`, {
  type: "dashboard",
  name: "Dash",
  config: {
    widgets: [
      { id: "w-d", kind: "depth", width: 4, groupByPropertyId: sideId, xPropertyId: priceId, aggregate: "sum", aggregatePropertyId: sizeId },
    ],
  },
});
const { pageId } = await api("POST", `/api/databases/${dbId}/fullpage`);

const fails = [];
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='db-view-tab-']", { timeout: 120_000 });
const dashTab = page.getByTestId(/^db-view-tab-/).filter({ hasText: "Dash" }).first();
if (await dashTab.isVisible().catch(() => false)) await dashTab.click();
await page.waitForSelector("[data-testid='db-dashw-depth-w-d']", { timeout: 60_000 });

// two side polygons + cumulative sum tooltip
if ((await page.locator("[data-depth-side='bid'] path").count()) !== 1) fails.push("no bid step polygon");
if ((await page.locator("[data-depth-side='ask'] path").count()) !== 1) fails.push("no ask step polygon");
const bidTitle = await page.locator("[data-depth-side='bid'] title").textContent();
const askTitle = await page.locator("[data-depth-side='ask'] title").textContent();
if (!bidTitle?.includes("60")) fails.push(`bid cumulative is not 60 (${bidTitle}) — failed to sum two rows at the same level`);
if (!askTitle?.includes("70")) fails.push(`ask cumulative is not 70 (${askTitle})`);

// color: bid green / ask red
const bidStroke = await page.locator("[data-depth-side='bid'] path").getAttribute("stroke");
const askStroke = await page.locator("[data-depth-side='ask'] path").getAttribute("stroke");
if (bidStroke !== "#4ade80") fails.push(`bid color is not green (${bidStroke})`);
if (askStroke !== "#f87171") fails.push(`ask color is not red (${askStroke})`);

// size → count: bid 4 rows / ask 2 rows
await page.getByTestId("db-dash-edit").click();
await page.getByTestId("db-dashw-agg-w-d").selectOption("count");
await page.waitForFunction(
  () => document.querySelector("[data-depth-side='bid'] title")?.textContent?.includes("4"),
  { timeout: 8_000 }
).catch(() => {});
const bidCnt = await page.locator("[data-depth-side='bid'] title").textContent();
if (!bidCnt?.includes("4")) fails.push(`count mode: bid cumulative is not 4 (${bidCnt})`);

// does the level axis select have the number properties + does switching work
const xOpts = await page.getByTestId("db-dashw-x-w-d").locator("option").allTextContents();
if (!xOpts.some((o) => o.includes("Price"))) fails.push("the level axis select has no Price");
if (!xOpts.some((o) => o.includes("Size"))) fails.push("the level axis select has no Size");
await page.getByTestId("db-dashw-x-w-d").selectOption({ index: 1 });
await page.waitForTimeout(500);
if ((await page.locator("[data-depth-side='bid'] path").count()) !== 1) fails.push("the polygon disappeared after switching the level axis");

await page.request.fetch(`${BASE}/api/pages/${pageId}`, { method: "DELETE" });
await page.request.fetch(`${BASE}/api/databases/${dbId}`, { method: "DELETE" });
await browser.close();

if (fails.length) {
  console.error(`\n  ┌─ Depth widget mismatch (${fails.length}) ─────────────`);
  for (const f of fails) console.error(`  │ ${f}`);
  console.error("  └──────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("depth widget OK — bid 60/ask 70 cumulative steps, level summing, count switch, axis switch");

