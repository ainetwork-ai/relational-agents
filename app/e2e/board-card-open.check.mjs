// QA-7: on a board view (the Projects "My" tab) clicking a card must open it.
// The card's pointer handler only knew drags, so a click was a drop into the
// same column: nothing opened, and the unchanged value was written back.
//
// Measures, on the dev app's Projects database, "My" board (view 7a0bce0c…):
//   1. a plain click on a card opens the row peek and issues NO write
//   2. a press that moves >5px and is released over the SAME column is a drag
//      that changes nothing: no peek, no write
//
//   [BASE_URL=http://localhost:3110] node e2e/board-card-open.check.mjs
//
// Fixture: dev user amy@comcom.ai (appears in 55 Projects rows, so the is_me
// filters leave cards). Nothing is written — that is what is asserted.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER = "30790fd0-9bdb-4c6c-abb8-3903fff5fd6d";
const COMCOM = "2c88615f-4a30-43f8-9608-6ac977919dc0";
const PAGE = "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects (full-page database)
const MY_VIEW = "7a0bce0c-200e-43cc-829e-14466f2e0dec"; // "My" board

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) fails++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: await sealData({ userId: USER, activeWorkspaceId: COMCOM }, { password: secret, ttl: 0 }), url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const writes = [];
page.on("request", (r) => {
  // data writes only — the presence heartbeat is a POST too but changes no content
  if (r.method() !== "GET" && /\/api\/(databases|saveTransactions|pages)/.test(r.url()) && !/\/presence$/.test(r.url())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
});

await page.goto(`${BASE}/p/${PAGE}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="db-view-bar"]', { timeout: 20000 });
await page.click(`[data-testid="db-view-tab-${MY_VIEW}"]`);
await page.waitForSelector('[data-testid^="db-card-"]', { timeout: 20000 });
await page.waitForTimeout(800);
writes.length = 0;

const cards = page.locator('[data-testid^="db-card-"]');
const n = await cards.count();
check("0. the My board shows cards for this user", n > 0, `${n} cards`);

// 1. click → opens, no write
const card = cards.first();
const cardId = (await card.getAttribute("data-testid")).replace("db-card-", "");
const box = await card.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 12);
await page.mouse.down();
await page.mouse.up();
const peek = page.locator('[data-testid="db-row-peek"]');
await peek.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
check("1a. a click on a card opens the row peek", await peek.isVisible());
await page.waitForTimeout(600);
check("1b. the click wrote nothing", writes.length === 0, writes.join(" | "));
await page.keyboard.press("Escape");
await peek.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
check("1c. Escape closes the peek", !(await peek.isVisible()));

// 2. drag within the same column and release → no open, no write
writes.length = 0;
const box2 = await page.locator(`[data-testid="db-card-${cardId}"]`).boundingBox();
await page.mouse.move(box2.x + box2.width / 2, box2.y + 12);
await page.mouse.down();
await page.mouse.move(box2.x + box2.width / 2 + 3, box2.y + 20, { steps: 3 });
await page.mouse.move(box2.x + box2.width / 2 + 6, box2.y + 40, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(800);
check("2a. a drag released over the same column does not open the peek", !(await peek.isVisible()));
check("2b. …and writes nothing (dropped back where it was)", writes.length === 0, writes.join(" | "));

check("3. no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
