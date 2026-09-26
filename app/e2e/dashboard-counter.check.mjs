// Dashboard counter widget number formatting — decimal places / prefix and suffix / ± sign color.
//
// Creates a temporary database through the API, actually operates the 4 new controls in edit
// mode, and checks that the displayed value changes. Deletes what it made at the end.
//
//   [BASE_URL=…] node e2e/dashboard-counter.check.mjs

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

// ---- fixture: DB with a number property, two rows, one counter widget -------
const db = await api("POST", "/api/databases", { title: "fmt-check", shape: "minimal" });
const dbId = db.database?.id ?? db.id;
const amount = await api("POST", `/api/databases/${dbId}/properties`, { name: "Amount", type: "number" });
const amountId = amount.property?.id ?? amount.id;
await api("POST", `/api/databases/${dbId}/rows`, { values: { [amountId]: 1234.5 } });
await api("POST", `/api/databases/${dbId}/rows`, { values: { [amountId]: -34.25 } });
const view = await api("POST", `/api/databases/${dbId}/views`, {
  type: "dashboard",
  name: "Dash",
  config: { widgets: [{ id: "w-c", kind: "counter", width: 1, aggregate: "sum", aggregatePropertyId: amountId }] },
});
const viewId = view.view?.id ?? view.id;
const { pageId } = await api("POST", `/api/databases/${dbId}/fullpage`);

const fails = [];
const valueIs = async (want, label) => {
  try {
    await page.waitForFunction(
      (w) => document.querySelector("[data-testid='db-dashw-value-w-c']")?.textContent === w,
      want,
      { timeout: 8_000 }
    );
  } catch {
    const got = await page.locator("[data-testid='db-dashw-value-w-c']").textContent();
    fails.push(`${label}: shown "${got}" / expected "${want}"`);
  }
};

await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='db-view-tab-']", { timeout: 120_000 });
const dashTab = page.getByTestId(/^db-view-tab-/).filter({ hasText: "Dash" }).first();
if (await dashTab.isVisible().catch(() => false)) await dashTab.click();
await page.waitForSelector("[data-testid='db-dashboard-view']", { timeout: 60_000 });

// default: automatic decimals (at most 2 places, thousands separators)
await valueIs("1,200.25", "default (automatic decimals)");

await page.getByTestId("db-dash-edit").click();

// 0 decimal places
await page.getByTestId("db-dashw-decimals-w-c").selectOption("0");
await valueIs("1,200", "0 decimal places");

// prefix $
await page.getByTestId("db-dashw-prefix-w-c").fill("$");
await page.getByTestId("db-dashw-prefix-w-c").blur();
await valueIs("$1,200", "prefix $");

// suffix
await page.getByTestId("db-dashw-suffix-w-c").fill(" USD");
await page.getByTestId("db-dashw-suffix-w-c").blur();
await valueIs("$1,200 USD", "suffix USD");

// ± sign color: positive gets + and green
await page.getByTestId("db-dashw-sign-w-c").click();
await valueIs("+$1,200 USD", "sign color on (+)");
// Tailwind v4 computes colors as lab() — a negative a axis is green, positive is red
const labA = (c) => { const m = c.match(/lab\([\d.]+ (-?[\d.]+)/); return m ? Number(m[1]) : NaN; };
const color = await page.locator("[data-testid='db-dashw-value-w-c']").evaluate((e) => getComputedStyle(e).color);
if (!(labA(color) < -20)) fails.push(`sign color: the positive color is not green (${color})`);

// flipped negative gives - and red (one row made strongly negative)
await api("POST", `/api/databases/${dbId}/rows`, { values: { [amountId]: -2000 } });
await valueIs("-$800 USD", "sign color negative (-)");
const negColor = await page.locator("[data-testid='db-dashw-value-w-c']").evaluate((e) => getComputedStyle(e).color);
if (!(labA(negColor) > 20)) fails.push(`sign color: the negative color is not red (${negColor})`);

// cleanup
await page.request.fetch(`${BASE}/api/pages/${pageId}`, { method: "DELETE" });
await page.request.fetch(`${BASE}/api/databases/${dbId}`, { method: "DELETE" });
await browser.close();

if (fails.length) {
  console.error(`\n  ┌─ Counter formatting mismatch (${fails.length}) ─────────────`);
  for (const f of fails) console.error(`  │ ${f}`);
  console.error("  └──────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("counter formatting OK — automatic/0-place decimals, $ prefix, USD suffix, ± sign color (green/red)");

