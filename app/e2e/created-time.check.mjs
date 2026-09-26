// Does our Created time column read like the original's?
//
//   node e2e/created-time.check.mjs      # 0 = same, 1 = differs
//
// Compares the rendered text's shape and metrics against what was measured on
// app.notion.com (src/i18n/content/e2e-fixtures/notion-created-time.json). It also reports the
// data gap — our seed gave every row the same creation minute — but does not
// fail on it, because closing that needs a fresh read-only fetch of the
// original's per-row created_time, which is not in the saved source data.
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { sealData } from "iron-session";
import pg from "pg";
import { content } from "./i18n.mjs";

const FIX = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-created-time.json", import.meta.url)));
const BASE = process.env.BASE ?? "http://localhost:3110";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const val = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const client = new pg.Client({ connectionString: val("POSTGRES_URL") });
await client.connect();
const { rows: users } = await client.query("select id from users where is_agent is not true limit 1");
const { rows: dbs } = await client.query(
  "select database_id from db_properties where name = 'Created time' and type = 'created_time' limit 1"
);
if (!users.length || !dbs.length) {
  console.error("no user, or no Created time property in this dev DB");
  await client.end();
  process.exit(1);
}
const { rows: host } = await client.query(
  `select page_id from blocks where type = 'database' and content->>'databaseId' = $1 limit 1`,
  [dbs[0].database_id]
);
const { rows: spread } = await client.query(
  `select count(*)::int rows, count(distinct date_trunc('minute', created_at))::int minutes,
          to_char(min(created_at), 'YYYY-MM-DD') oldest, to_char(max(created_at), 'YYYY-MM-DD') newest
     from db_rows where database_id = $1`,
  [dbs[0].database_id]
);
await client.end();
if (!host.length) {
  console.error("that database is not embedded on any page — nothing to open");
  process.exit(1);
}
const cookie = await sealData({ userId: users[0].id }, { password: val("SESSION_SECRET"), ttl: 3600 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${host[0].page_id}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.locator("[data-dbtable]").first().waitFor({ timeout: 90_000 });
await page.waitForTimeout(2500);

const cells = await page.evaluate(`(() => {
  const out = [];
  for (const el of document.querySelectorAll('[data-testid^="db-cell-"]')) {
    const t = (el.innerText || "").trim();
    if (!/^\\d{4}${content.CREATED_TIME.yearSuffix}|^\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(t)) continue;
    const cs = getComputedStyle(el);
    const cell = el.closest("[data-cellnav]");
    const r = el.getBoundingClientRect(), cr = cell?.getBoundingClientRect();
    out.push({
      text: t,
      fontSize: Math.round(parseFloat(cs.fontSize)),
      lineHeight: Math.round(parseFloat(cs.lineHeight)),
      fontWeight: cs.fontWeight,
      color: cs.color,
      // our element carries the padding; Notion's leaf had none, so add ours in
      insetLeft: cr ? Math.round(r.left - cr.left + parseFloat(cs.paddingLeft)) : null,
      insetTop: cr ? Math.round(r.top - cr.top + parseFloat(cs.paddingTop)) : null,
      cellHeight: cr ? Math.round(cr.height) : null,
    });
    if (out.length >= 3) break;
  }
  return out;
})()`);
await browser.close();

if (!cells.length) {
  console.error("no Created time cell was painted — widen the window or check the view's columns");
  process.exit(1);
}

const diffs = [];
const c = cells[0];
const re = new RegExp(FIX.format.pattern);
if (!re.test(c.text)) diffs.push(`format "${c.text}" does not match ${FIX.format.pattern} (original: ${FIX.format.examples[0]})`);
const T = FIX.text;
const check = (name, got, exp) => { if (String(got) !== String(exp)) diffs.push(`${name} ${got} ≠ ${exp}`); };
check("font-size", c.fontSize, T.fontSize);
check("line-height", c.lineHeight, T.lineHeight);
check("font-weight", c.fontWeight, String(T.fontWeight));
check("color", c.color, T.color);
check("text inset left", c.insetLeft, T.insetLeft);
check("text inset top", c.insetTop, T.insetTop);
check("row height", c.cellHeight, FIX.cell.height);

console.log(`checked ${cells.length} Created time cells — e.g. "${c.text}"`);
console.log(
  `data: ${spread[0].rows} rows created across ${spread[0].minutes} distinct minute(s), ${spread[0].oldest}…${spread[0].newest}` +
    (spread[0].minutes <= 5 ? "  ← the seed's own clock, not the original's history (see _dataGap)" : "")
);
if (diffs.length) {
  console.error("\n  ┌─ Created time differs from the original ─────────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-created-time.json");
  console.error("  └────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("0 differences — format, font, color and indent match the original.");
