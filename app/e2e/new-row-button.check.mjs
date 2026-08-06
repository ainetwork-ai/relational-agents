// The blue 새로 만들기 button: does it add a row, and does its caret open the
// template menu the original opens?
//
//   node e2e/new-row-button.check.mjs      # 0 = same, 1 = differs
//
// Measured on app.notion.com (e2e/fixtures/notion-new-row-button.json). This one
// DOES write: it presses the button and then deletes the row it created, because
// "it adds a row" is the whole claim being checked. It runs on the dev DB only.
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { sealData } from "iron-session";
import pg from "pg";

const FIX = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-new-row-button.json", import.meta.url)));
const BASE = process.env.BASE ?? "http://localhost:3110";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const val = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const conn = { connectionString: val("POSTGRES_URL") };
const client = new pg.Client(conn);
await client.connect();
const { rows: users } = await client.query("select id from users where is_agent is not true limit 1");
const { rows: dbs } = await client.query(
  "select database_id from db_properties where name = 'Evaluation' and type = 'select' limit 1"
);
const { rows: host } = dbs.length
  ? await client.query("select page_id from blocks where type='database' and content->>'databaseId'=$1 limit 1", [dbs[0].database_id])
  : { rows: [] };
if (!users.length || !host.length) {
  console.error("this dev DB has no user or no page with the Projects database");
  await client.end();
  process.exit(1);
}
const dbId = dbs[0].database_id;
const { rows: before } = await client.query("select count(*)::int n from db_rows where database_id=$1", [dbId]);
await client.end();
const cookie = await sealData({ userId: users[0].id }, { password: val("SESSION_SECRET"), ttl: 3600 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
await page.goto(`${BASE}/p/${host[0].page_id}`, { waitUntil: "domcontentloaded" });
await page.locator("[data-dbtable]").first().waitFor();
await page.waitForTimeout(2500);

const diffs = [];

// 1. the split button's geometry
const btn = await page.evaluate(`(() => {
  const main = document.querySelector('[data-testid="db-new-row"]');
  const caret = document.querySelector('[data-testid="db-new-row-more"]');
  if (!main || !caret) return null;
  const m = main.getBoundingClientRect(), c = caret.getBoundingClientRect();
  const cs = getComputedStyle(main), wrap = getComputedStyle(main.parentElement);
  return {
    main: { w: Math.round(m.width), h: Math.round(m.height) },
    caret: { w: Math.round(c.width), h: Math.round(c.height) },
    bg: wrap.backgroundColor, radius: wrap.borderTopLeftRadius,
    font: Math.round(parseFloat(cs.fontSize)) + " w" + cs.fontWeight,
    label: (main.innerText || "").trim(),
    caretRightOfMain: Math.round(c.left - m.right),
  };
})()`);
if (!btn) diffs.push("the blue button is not on the page");
else {
  const W = FIX.button;
  if (btn.label !== W.main.label) diffs.push(`label "${btn.label}" ≠ "${W.main.label}"`);
  if (btn.main.h !== W.main.h) diffs.push(`main height ${btn.main.h} ≠ ${W.main.h}`);
  if (Math.abs(btn.main.w - W.main.w) > 8) diffs.push(`main width ${btn.main.w} ≠ ${W.main.w} (±8)`);
  if (btn.caret.w !== W.caret.w) diffs.push(`caret width ${btn.caret.w} ≠ ${W.caret.w}`);
  if (btn.bg !== W.main.bg) diffs.push(`background ${btn.bg} ≠ ${W.main.bg}`);
  if (btn.caretRightOfMain > 2) diffs.push(`caret is ${btn.caretRightOfMain}px from the main half; the original splits them with a hairline`);
}

// 2. the caret opens the template menu, right-aligned to the button
await page.locator('[data-testid="db-new-row-more"]').first().click();
await page.waitForTimeout(600);
const menu = await page.evaluate(`(() => {
  const p = document.querySelector('[data-testid="db-new-row-menu"]');
  const b = document.querySelector('[data-testid="db-new-row-more"]');
  if (!p) return null;
  const r = p.getBoundingClientRect(), br = b.getBoundingClientRect();
  return { offRight: Math.round(r.right - br.right),
    items: (p.innerText || "").trim().split("\\n").map((t) => t.trim()).filter(Boolean) };
})()`);
if (!menu) diffs.push("the caret does not open a menu");
else {
  for (const want of ["템플릿", "기본", "비어 있음", "새 템플릿"])
    if (!menu.items.includes(want)) diffs.push(`the caret menu has no "${want}" (has: ${menu.items.join(" / ")})`);
  if (Math.abs(menu.offRight) > 24) diffs.push(`the menu's right edge is ${menu.offRight}px off the button's`);
}
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// 3. the main half adds exactly one row — then put the row back
await page.locator('[data-testid="db-new-row"]').first().click();
await page.waitForTimeout(1800);
await browser.close();

const after = new pg.Client(conn);
await after.connect();
const { rows: now } = await after.query("select count(*)::int n from db_rows where database_id=$1", [dbId]);
const added = now[0].n - before[0].n;
if (added !== 1) diffs.push(`pressing it added ${added} row(s), not 1`);
await after.query("delete from db_rows where database_id=$1 and created_at > now() - interval '2 minutes'", [dbId]);
const { rows: cleaned } = await after.query("select count(*)::int n from db_rows where database_id=$1", [dbId]);
await after.end();

console.log(`button ${JSON.stringify(btn)}`);
console.log(`caret menu ${JSON.stringify(menu)}`);
console.log(`rows ${before[0].n} → ${now[0].n} on press, cleaned back to ${cleaned[0].n}`);
if (diffs.length) {
  console.error("\n  ┌─ 새로 만들기 버튼이 원본과 다릅니다 ─────────────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  └────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("차이 0 — 규격·캐럿 메뉴·행 추가 모두 원본과 같습니다.");
