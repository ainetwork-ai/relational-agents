// Does a popover open where its trigger is?
//
//   node e2e/popover-anchor.check.mjs      # 0 = anchored, 1 = adrift
//
// This exists because it has gone wrong twice. Portalling the popovers fixed
// their clipping, then tying them to their trigger in CSS mispositioned every
// right-aligned one: `right: calc(anchor(right) * -1 + 100%)` measured from the
// wrong side, so "Add property" — a trigger at the far right of a table scrolled
// to its end — opened 1084px away, on top of the sidebar.
//
// So the assertion is not "it is on screen" (it was) but "its edge is on the
// trigger's edge", checked with the table scrolled fully right, which is when a
// horizontal mistake shows.
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { sealData } from "iron-session";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:3110";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const val = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const client = new pg.Client({ connectionString: val("POSTGRES_URL") });
await client.connect();
const { rows: users } = await client.query("select id from users where is_agent is not true limit 1");
const { rows: dbs } = await client.query(
  "select database_id from db_properties where name = 'Evaluation' and type = 'select' limit 1"
);
if (!users.length || !dbs.length) {
  console.error("this dev DB has no user or no Projects database");
  await client.end();
  process.exit(1);
}
const { rows: host } = await client.query(
  "select page_id from blocks where type = 'database' and content->>'databaseId' = $1 limit 1",
  [dbs[0].database_id]
);
await client.end();
const cookie = await sealData({ userId: users[0].id }, { password: val("SESSION_SECRET"), ttl: 3600 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
await page.goto(`${BASE}/p/${host[0].page_id}`, { waitUntil: "domcontentloaded" });
await page.locator("[data-dbtable]").first().waitFor();
await page.waitForTimeout(2000);

/** the case that broke: the table scrolled to its right end */
await page.evaluate(`(() => {
  const sc = Array.from(document.querySelectorAll("*")).find(
    (e) => e.scrollWidth > e.clientWidth + 50 && /auto|scroll/.test(getComputedStyle(e).overflowX)
  );
  if (sc) sc.scrollLeft = sc.scrollWidth;
})()`);
await page.waitForTimeout(600);

const diffs = [];
async function anchored(label, triggerSel, panelSel, edge, before) {
  if (before) await before();
  const trigger = page.locator(triggerSel).first();
  if (!(await trigger.count())) {
    console.log(`  (skipped ${label}: no trigger on this page)`);
    return;
  }
  // a hover-only affordance (the row's ⠿) disappears if we scroll after hovering
  if (!before) await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await trigger.click({ force: true });
  await page.waitForTimeout(500);
  const m = await page.evaluate(
    `(() => {
      const t = document.querySelector(${JSON.stringify(triggerSel)});
      const p = document.querySelector(${JSON.stringify(panelSel)});
      if (!t || !p) return null;
      const tr = t.getBoundingClientRect(), pr = p.getBoundingClientRect();
      return {
        offEdge: Math.round(${edge === "end" ? "pr.right - tr.right" : "pr.left - tr.left"}),
        pastWindow: Math.round(Math.max(0, pr.right - innerWidth) + Math.max(0, -pr.left) + Math.max(0, pr.bottom - innerHeight) + Math.max(0, -pr.top)),
        panel: Math.round(pr.left) + ".." + Math.round(pr.right),
        trigger: Math.round(tr.left) + ".." + Math.round(tr.right),
      };
    })()`
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  if (!m) {
    diffs.push(`${label}: did not open`);
    return;
  }
  console.log(`  ${label}: trigger ${m.trigger} → panel ${m.panel} (${edge} edge off by ${m.offEdge})`);
 // a clamp at the window edge is allowed; a panel that ignores its trigger is not
  if (Math.abs(m.offEdge) > 24) diffs.push(`${label}: ${edge} edge off by ${m.offEdge}px — not anchored to its trigger`);
  if (m.pastWindow > 0) diffs.push(`${label}: ${m.pastWindow}px outside the window`);
}

console.log("table scrolled to its right end:");
await anchored("Add property", '[data-testid="db-add-prop"]', '[data-testid="db-add-prop"] ~ div, .popover-anim', "end");
await anchored("Filter", '[data-testid="db-filter"]', ".popover-anim", "end");
await anchored("Sort", '[data-testid="db-sort"]', ".popover-anim", "end");
await anchored("View options", '[data-testid="db-view-options"]', ".popover-anim", "end");
await anchored("Row ⠿ menu", '[data-testid^="db-row-drag-"]', '[data-testid^="db-row-menu-"]', "end", async () => {
  await page.locator('[data-testid^="db-row-"][data-dbrow]').first().hover();
  await page.waitForTimeout(250);
});
await anchored("Add view", '[data-testid="db-add-view"]', ".popover-anim", "start");

await browser.close();

if (diffs.length) {
  console.error("\n  ┌─ Popovers are not attached to their triggers ───");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  └────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("All open attached to their triggers (none leave the window).");
