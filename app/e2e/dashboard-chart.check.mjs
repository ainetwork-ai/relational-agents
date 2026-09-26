// Dashboard chart widget — line/candles, date × number axes, select markers.
//
// Creates a temporary database (date + price + side, 5 rows over 3 days), and in edit mode
// actually operates the chart type, bucket, and marker controls to see the SVG change correctly.
//
//   [BASE_URL=…] node e2e/dashboard-chart.check.mjs

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

// ---- fixture --------------------------------------------------------------
const db = await api("POST", "/api/databases", { title: "chart-check", shape: "minimal" });
const dbId = db.database?.id ?? db.id;
const mk = async (name, type, config) =>
  (await api("POST", `/api/databases/${dbId}/properties`, { name, type, ...(config && { config }) })).property?.id;
const whenId = await mk("When", "date");
const priceId = await mk("Price", "number");
const sideId = await mk("Side", "select", {
  options: [
    { id: "buy", name: "Buy", color: "green" },
    { id: "sell", name: "Sell", color: "red" },
  ],
});

// 3 days · 5 rows: day 1 rising with an upper wick (100→110), day 2 falling (120→105), day 3 single (95)
const rows = [
  ["2026-09-01T10:00:00Z", 100, "buy"],
  ["2026-09-01T14:00:00Z", 110, "sell"],
  ["2026-09-02T10:00:00Z", 120, "buy"],
  ["2026-09-02T14:00:00Z", 105, "sell"],
  ["2026-09-03T10:00:00Z", 95, "buy"],
];
for (const [d, v, s] of rows)
  await api("POST", `/api/databases/${dbId}/rows`, { values: { [whenId]: d, [priceId]: v, [sideId]: s } });

await api("POST", `/api/databases/${dbId}/views`, {
  type: "dashboard",
  name: "Dash",
  config: {
    widgets: [
      { id: "w-ch", kind: "chart", width: 4, chartType: "line", xPropertyId: whenId, yPropertyId: priceId, markerPropertyId: sideId },
    ],
  },
});
const { pageId } = await api("POST", `/api/databases/${dbId}/fullpage`);

const fails = [];
const count = (sel) => page.locator(sel).count();

await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='db-view-tab-']", { timeout: 120_000 });
const dashTab = page.getByTestId(/^db-view-tab-/).filter({ hasText: "Dash" }).first();
if (await dashTab.isVisible().catch(() => false)) await dashTab.click();
await page.waitForSelector("[data-testid='db-dashw-chart-w-ch']", { timeout: 60_000 });

// line + 5 markers
if ((await count("[data-chart-line]")) !== 1) fails.push("line chart: path[data-chart-line] is not exactly 1");
if ((await count("[data-chart-marker]")) !== 5) fails.push(`markers: ${await count("[data-chart-marker]")} / expected 5`);

// edit → candles (daily): 3, day 1 rising (green) · day 2 falling (red)
await page.getByTestId("db-dash-edit").click();
await page.getByTestId("db-dashw-charttype-w-ch").selectOption("candles");
await page.getByTestId("db-dashw-bucket-w-ch").selectOption("day");
await page.waitForFunction(() => document.querySelectorAll("[data-chart-candle]").length === 3, { timeout: 8_000 }).catch(() => {});
const nCandles = await count("[data-chart-candle]");
if (nCandles !== 3) fails.push(`candles (daily): ${nCandles} / expected 3`);
const candleFills = await page.$$eval("[data-chart-candle] rect", (rs) => rs.map((r) => r.getAttribute("fill")));
if (candleFills[0] !== "#4ade80") fails.push(`day 1 candle is not rising (green) (${candleFills[0]})`);
if (candleFills[1] !== "#f87171") fails.push(`day 2 candle is not falling (red) (${candleFills[1]})`);

// marker colors: buy = 3 green, sell = 2 red
const markerFills = await page.$$eval("[data-chart-marker]", (ms) => ms.map((m) => m.getAttribute("fill")));
if (markerFills.filter((f) => f === "#4ade80").length !== 3) fails.push("Buy markers (green) are not 3");
if (markerFills.filter((f) => f === "#f87171").length !== 2) fails.push("Sell markers (red) are not 2");

// no marker → 0
await page.getByTestId("db-dashw-marker-w-ch").selectOption("");
await page.waitForFunction(() => document.querySelectorAll("[data-chart-marker]").length === 0, { timeout: 8_000 }).catch(() => {});
if ((await count("[data-chart-marker]")) !== 0) fails.push("markers remain after switching to no marker");

// hourly bucket → 5 (each row at a different hour)
await page.getByTestId("db-dashw-bucket-w-ch").selectOption("hour");
await page.waitForFunction(() => document.querySelectorAll("[data-chart-candle]").length === 5, { timeout: 8_000 }).catch(() => {});
if ((await count("[data-chart-candle]")) !== 5) fails.push(`candles (hourly): ${await count("[data-chart-candle]")} / expected 5`);

// do the x/y axis selects carry the property list
const xOpts = await page.getByTestId("db-dashw-x-w-ch").locator("option").allTextContents();
const yOpts = await page.getByTestId("db-dashw-y-w-ch").locator("option").allTextContents();
if (!xOpts.includes("When")) fails.push("the x-axis select has no date property");
if (!yOpts.includes("Price")) fails.push("the y-axis select has no number property");

// cleanup
await page.request.fetch(`${BASE}/api/pages/${pageId}`, { method: "DELETE" });
await page.request.fetch(`${BASE}/api/databases/${dbId}`, { method: "DELETE" });
await browser.close();

if (fails.length) {
  console.error(`\n  ┌─ Chart widget mismatch (${fails.length}) ─────────────`);
  for (const f of fails) console.error(`  │ ${f}`);
  console.error("  └──────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("chart widget OK — line + 5 markers, 3 daily candles (rising green / falling red), 5 hourly, marker toggle");

