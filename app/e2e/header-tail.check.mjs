// Is the header row's tail (+ and ⋯) its own segment, as in the original?
//
//   node e2e/header-tail.check.mjs      # 0 = same, 1 = differs
//
// The report: "+ and ⋯ are a separate column in Notion, but ours looks like part
// of the last property". Measured on app.notion.com (src/i18n/content/e2e-fixtures/notion-header-
// tail.json): the column grid closes with the table's own right edge and the two
// 28x28 controls sit beyond it, with no cell borders of their own.
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { sealData } from "iron-session";
import pg from "pg";

const FIX = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-header-tail.json", import.meta.url)));
const ICONS = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-header-icons.json", import.meta.url)));
const BASE = process.env.BASE ?? "http://localhost:3110";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const val = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const client = new pg.Client({ connectionString: val("POSTGRES_URL") });
await client.connect();
const { rows: users } = await client.query("select id from users where is_agent is not true limit 1");
const { rows: dbs } = await client.query(
  "select database_id from db_properties where name = 'Evaluation' and type = 'select' limit 1"
);
const { rows: host } = dbs.length
  ? await client.query("select page_id from blocks where type = 'database' and content->>'databaseId' = $1 limit 1", [dbs[0].database_id])
  : { rows: [] };
await client.end();
if (!users.length || !host.length) {
  console.error("this dev DB has no user or no page with the Projects database");
  process.exit(1);
}
const cookie = await sealData({ userId: users[0].id }, { password: val("SESSION_SECRET"), ttl: 3600 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
await page.goto(`${BASE}/p/${host[0].page_id}`, { waitUntil: "domcontentloaded" });
await page.locator("[data-dbtable]").first().waitFor();
await page.waitForTimeout(2000);
// the tail lives at the right end of the header row
await page.evaluate(`(() => {
  const sc = Array.from(document.querySelectorAll("*")).find(
    (e) => e.scrollWidth > e.clientWidth + 50 && /auto|scroll/.test(getComputedStyle(e).overflowX)
  );
  if (sc) sc.scrollLeft = sc.scrollWidth;
})()`);
await page.waitForTimeout(600);

const got = await page.evaluate(`(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const svg = el.querySelector("svg");
    return {
      x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
      radius: cs.borderTopLeftRadius,
      icon: svg ? Math.round(svg.getBoundingClientRect().width) : null,
      insideAHeaderCell: !!el.closest('[data-testid^="db-col-"], [data-testid^="db-prop-header-"]'),
    };
  };
  const headerRow = document.querySelector('[data-testid^="db-add-prop"]')?.closest(".flex");
  const rowBox = (() => {
    const btn = document.querySelector('[data-testid="db-add-prop"]');
    const row = btn && btn.closest("div.flex.h-9");
    if (!row) return null;
    const r = row.getBoundingClientRect();
    const label = row.querySelector('[data-testid^="db-prop-header-"] span:last-child, [data-testid^="db-prop-header-"] span');
    const lr = label && label.getBoundingClientRect();
    return {
      height: Math.round(r.height),
      labelInsetTop: lr ? Math.round(lr.top - r.top) : null,
      controlInsetTop: Math.round(document.querySelector('[data-testid="db-add-prop"]').getBoundingClientRect().top - r.top),
    };
  })();
  const bodyEdge = (() => {
 // is there a line at the end of the last column in a DATA row?
    const btn = document.querySelector('[data-testid="db-add-prop"]');
    if (!btn) return null;
    const x = btn.getBoundingClientRect().x;
    for (const el of document.querySelectorAll("[data-dbrow] div")) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 || r.height < 20) continue;
      if (Math.abs(r.right - x) > 3) continue;
      const bg = getComputedStyle(el).backgroundColor;
      if (bg === "rgba(0, 0, 0, 0)") continue;
      return { x: Math.round(r.x), h: Math.round(r.height), bg };
    }
    return null;
  })();
  const typeIcon = (() => {
    const btn = document.querySelector('[data-testid^="db-prop-header-"]');
    if (!btn) return null;
    const svg = btn.querySelector("svg");
    if (!svg) return "no icon";
    const r = svg.getBoundingClientRect(), br = btn.getBoundingClientRect();
    const label = btn.querySelector("span");
    const lr = label && label.getBoundingClientRect();
    return {
      size: Math.round(r.width) + "x" + Math.round(r.height),
      color: getComputedStyle(svg).color,
      insetLeftInCell: Math.round(r.left - br.left),
      gapToLabel: lr ? Math.round(lr.left - r.right) : null,
    };
  })();
  const heads = Array.from(document.querySelectorAll('[data-testid^="db-prop-header-"]'))
    .map((e) => e.closest("[style]")?.getBoundingClientRect() ?? e.getBoundingClientRect())
    .filter((r) => r.width > 0)
    .sort((a, b) => a.x - b.x);
  return {
    typeIcon,
    row: rowBox,
    bodyEdge,
    plus: box('[data-testid="db-add-prop"]'),
    dots: box('[data-testid="db-header-props"]'),
    lastColumnRight: heads.length ? Math.round(heads[heads.length - 1].right) : null,
  };
})()`);
await browser.close();

const diffs = [];
const want = { w: FIX.controls[0].w, h: FIX.controls[0].h, icon: FIX.controls[0].iconSize };
for (const [name, c] of [["+", got.plus], ["⋯", got.dots]]) {
  if (!c) {
    diffs.push(`${name}: not in the header row`);
    continue;
  }
  if (c.w !== want.w || c.h !== want.h) diffs.push(`${name}: ${c.w}x${c.h} ≠ ${want.w}x${want.h}`);
  if (c.icon !== want.icon) diffs.push(`${name}: icon ${c.icon}px ≠ ${want.icon}px`);
  if (c.insideAHeaderCell) diffs.push(`${name}: sits inside a property's header cell — the original keeps it outside the grid`);
}
if (got.plus && got.dots) {
  const gap = got.dots.x - (got.plus.x + got.plus.w);
  if (Math.abs(gap) > 2) diffs.push(`the two controls are ${gap}px apart; the original puts them side by side (0)`);
  if (got.lastColumnRight !== null && got.plus.x < got.lastColumnRight)
    diffs.push(`+ starts at ${got.plus.x}, left of the last column's right edge ${got.lastColumnRight} — it is inside the grid`);
}

if (got.row) {
  if (got.row.height !== FIX.headerRow.height) diffs.push(`header row ${got.row.height}px ≠ ${FIX.headerRow.height}px`);
  const wantControl = Math.round((FIX.headerRow.height - FIX.controls[0].h) / 2);
  if (Math.abs(got.row.controlInsetTop - wantControl) > 1)
    diffs.push(`the + sits ${got.row.controlInsetTop}px below the row top; centred would be ${wantControl}`);
  if (got.row.labelInsetTop !== null && Math.abs(got.row.labelInsetTop - 9) > 2)
    diffs.push(`a property label sits ${got.row.labelInsetTop}px down; the original's is 9 (centred)`);
}
if (!got.bodyEdge) diffs.push("no line between the last column and the tail in the data rows");

const I = ICONS.metrics;
if (!got.typeIcon || typeof got.typeIcon === "string") diffs.push(`property type icon: ${got.typeIcon ?? "no header"}`);
else {
  if (got.typeIcon.size !== `${I.size}x${I.size}`) diffs.push(`type icon ${got.typeIcon.size} ≠ ${I.size}x${I.size}`);
  if (got.typeIcon.color !== I.fill) diffs.push(`type icon colour ${got.typeIcon.color} ≠ ${I.fill}`);
  if (Math.abs(got.typeIcon.insetLeftInCell - I.insetLeftInCell) > 1)
    diffs.push(`type icon sits ${got.typeIcon.insetLeftInCell}px in; the original's is ${I.insetLeftInCell}`);
  if (got.typeIcon.gapToLabel !== null && Math.abs(got.typeIcon.gapToLabel - I.gapToLabel) > 1)
    diffs.push(`icon→label gap ${got.typeIcon.gapToLabel} ≠ ${I.gapToLabel}`);
}

console.log(`type icon ${JSON.stringify(got.typeIcon)}`);
console.log(`row ${JSON.stringify(got.row)}\nbody edge ${JSON.stringify(got.bodyEdge)}`);
console.log(`+ ${JSON.stringify(got.plus)}\n⋯ ${JSON.stringify(got.dots)}\nlast column ends at ${got.lastColumnRight}`);
if (diffs.length) {
  console.error("\n  ┌─ The + / ⋯ at the header's end differ from the original ─");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-header-tail.json");
  console.error("  └───────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("0 differences — + and ⋯ sit in their own area outside the columns.");
