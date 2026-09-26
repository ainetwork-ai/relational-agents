// Change Evaluation in one place: does it show at once in another window's page/table? Measured with two contexts.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/row-props-live.check.mjs
//
// Changes dev data once (the first row's Evaluation) and restores it at the end. Reference: in Notion a
// change from another window updates in place without a reload — a behaviour reference, not a measured value.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const fails = [];
const ok = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fails.push(label); };

const browser = await chromium.launch();
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
  return ctx;
};
const A = await (await mk()).newPage(); // table + peek
const B = await (await mk()).newPage(); // the same row as a full page
await A.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await A.waitForSelector("[data-cellnav]", { timeout: 60_000 });
await A.locator("[data-cellnav]").first().hover();
await A.locator(`text=${ko("Open")}`).first().click();
await A.waitForSelector("[data-testid='db-row-peek'] [data-pinned-row]", { timeout: 30_000 });
const evalItem = A.locator("[data-testid='db-row-peek'] [data-testid^='row-props-item-'][data-type='select']").first();
const propId = (await evalItem.getAttribute("data-testid")).replace("row-props-item-", "");
const cellTestid = await evalItem.locator("[data-testid^='db-cell-']").first().getAttribute("data-testid");
const rowId = cellTestid.replace("db-cell-", "").replace(`-${propId}`, "");
const peekPageId = await A.locator("[data-testid='db-row-peek']").getAttribute("data-page-id");
const dbId = await A.evaluate(async (pid) => (await fetch(`/api/pages/${pid}/row`).then((r) => r.json())).ref?.databaseId, peekPageId);
// the original value and the options
const snap = await A.evaluate(async (id) => fetch(`/api/databases/${id}`).then((r) => r.json()), dbId);
const prop = snap.properties.find((p) => p.id === propId);
const row = snap.rows.find((r) => r.id === rowId);
const before = row.values[propId] ?? null;
const target = prop.config.options.find((o) => o.id !== before);
console.log(`row ${rowId.slice(0, 8)} ${prop.name}: ${before ?? "(empty)"} → ${target.name}`);

// B: the same row as a full page
const bodyPageId = row.values.__page;
await B.goto(`${BASE}/p/${bodyPageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await B.waitForSelector("[data-testid='page-row-props'] [data-pinned-row]", { timeout: 30_000 });

const readA = () => A.locator(`[data-testid='db-row-peek'] [data-testid='row-props-item-${propId}'] [data-role='value']`).innerText();
const readB = () => B.locator(`[data-testid='page-row-props'] [data-testid='row-props-item-${propId}'] [data-role='value']`).innerText();
const readTable = () => A.locator(`[data-cellnav] [data-testid='db-cell-${rowId}-${propId}']`).first().innerText().catch(() => "");
const waitFor = async (read, want, label) => {
  const t0 = Date.now();
  for (;;) {
    const v = (await read()).trim();
    if (v === want) { ok(true, `${label}: "${want}" arrived (${Date.now() - t0}ms)`); return; }
    if (Date.now() - t0 > 6000) { ok(false, `${label}: "${want}" did not arrive within 6s (now "${v}")`); return; }
    await new Promise((r) => setTimeout(r, 150));
  }
};

// 1) pick in the page (B, full page) → at once in the peek (A) and the table (A)
await B.evaluate(() => { const sc = document.querySelector("[data-testid='page-row-props'] [data-pinned-row] > div"); sc.scrollLeft = sc.scrollWidth; });
await B.locator(`[data-testid='page-row-props'] [data-testid='row-props-item-${propId}'] [data-role='value']`).click();
await B.waitForSelector("[data-testid='db-select-menu']", { timeout: 5000 });
await B.locator(`[data-testid='db-option-${propId}-${target.id}']`).click();
await waitFor(readB, target.name, "the full page itself");
await waitFor(readA, target.name, "the peek in the other window");
await waitFor(readTable, target.name, "the table cell in the other window");

// 2) restore from the peek (A) → at once in the full page (B). Evaluation sits outside the band
//    (to the right), so scroll the band to the end and click, as in the original
await A.evaluate(() => { const sc = document.querySelector("[data-testid='db-row-peek'] [data-pinned-row] > div"); sc.scrollLeft = sc.scrollWidth; });
await A.waitForTimeout(300);
await A.locator(`[data-testid='db-row-peek'] [data-testid='row-props-item-${propId}'] [data-role='value']`).click();
await A.waitForSelector("[data-testid='db-select-menu']", { timeout: 5000 });
if (before) await A.locator(`[data-testid='db-option-${propId}-${before}']`).click();
else await A.locator(`[data-testid='db-option-${propId}-none']`).click();
const beforeName = before ? prop.config.options.find((o) => o.id === before).name : ko("Empty");
await waitFor(readA, beforeName, "the peek itself");
await waitFor(readB, beforeName, "the full page in the other window");

await browser.close();
if (fails.length) { console.error(`\n${fails.length} failed`); process.exit(1); }
console.log("\nreflected in every window at once — exit 0");
