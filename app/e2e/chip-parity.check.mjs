// Our chips vs the original's — the numbers in src/i18n/content/e2e-fixtures/notion-chips.json.
//
//   node e2e/chip-parity.check.mjs      # 0 = no difference, 1 = differs
//
// Read-only on our dev server (3110) and dev DB: it opens the imported Projects
// page, reads computed styles off the chips the table paints, and compares them
// with what was measured on app.notion.com. "fixed" means this exits 0.
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { sealData } from "iron-session";
import pg from "pg";

const FIX = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-chips.json", import.meta.url)));
const BASE = process.env.BASE ?? "http://localhost:3110";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const val = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const client = new pg.Client({ connectionString: val("POSTGRES_URL") });
await client.connect();
const { rows: users } = await client.query("select id from users where is_agent is not true limit 1");
const { rows: pages } = await client.query(
  `select p.id from pages p
     join blocks b on b.page_id = p.id and b.type = 'database'
    where p.is_archived = false
    group by p.id
    order by count(b.id) desc limit 1`
);
await client.end();
if (!users.length || !pages.length) {
  console.error("dev DB has no user or no page with a database block — nothing to compare");
  process.exit(1);
}
const cookie = await sealData({ userId: users[0].id }, { password: val("SESSION_SECRET"), ttl: 3600 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pages[0].id}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.locator("[data-dbtable]").first().waitFor({ timeout: 90_000 });
await page.waitForTimeout(2500);

const chips = await page.evaluate(`(() => {
  const out = [];
  for (const el of document.querySelectorAll("[data-chip]")) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const cs = getComputedStyle(el);
    // the label, not the dot: a status chip's first span IS the dot
    const label = Array.from(el.querySelectorAll("span")).find((x) => (x.textContent || "").trim()) ?? el;
    const ls = getComputedStyle(label);
    const dot = el.querySelector("span.rounded-full");
    out.push({
      kind: el.dataset.chip,
      text: (el.innerText || "").trim().slice(0, 28),
      height: Math.round(r.height),
      radius: cs.borderTopLeftRadius,
      padLeft: Math.round(parseFloat(cs.paddingLeft)),
      padRight: Math.round(parseFloat(cs.paddingRight)),
      fontSize: Math.round(parseFloat(ls.fontSize)),
      lineHeight: Math.round(parseFloat(ls.lineHeight)),
      fontWeight: ls.fontWeight,
      bg: cs.backgroundColor,
      text_: ls.color,
      dot: !!dot,
    });
  }
  return out;
})()`);

/** the cell layout: where the first chip sits, and the gap between two chips */
const layout = await page.evaluate(`(() => {
  let inset = null, gap = null, rowH = null;
  for (const cell of document.querySelectorAll("[data-cellnav]")) {
    const chips = Array.from(cell.querySelectorAll("[data-chip]")).filter((c) => c.getBoundingClientRect().width);
    if (!chips.length) continue;
    const cr = cell.getBoundingClientRect(), a = chips[0].getBoundingClientRect();
    if (inset === null) { inset = Math.round(a.left - cr.left); rowH = Math.round(cr.height); }
    if (chips.length >= 2 && gap === null) {
      const b = chips[1].getBoundingClientRect();
      gap = Math.round(b.left - a.right);
    }
    if (inset !== null && gap !== null) break;
  }
  return { firstChipInsetLeft: inset, gapBetweenChips: gap, height: rowH };
})()`);
await browser.close();

if (!chips.length) {
  console.error("no chips painted on that page — cannot compare");
  process.exit(1);
}

const want = (kind) => (kind === "status" ? FIX.status : FIX.select);
const diffs = [];
const seen = new Set();
for (const c of chips) {
  const w = want(c.kind);
  const key = c.kind + c.bg;
  const check = (name, got, exp) => {
    if (String(got) !== String(exp)) diffs.push(`${c.kind} "${c.text}": ${name} ${got} ≠ ${exp}`);
  };
  if (!seen.has(key)) {
    seen.add(key);
    check("height", c.height, w.height);
    check("radius", c.radius, w.radius);
    check("padding-left", c.padLeft, w.paddingLeft);
    check("padding-right", c.padRight, w.paddingRight);
    check("font-size", c.fontSize, w.fontSize);
    check("line-height", c.lineHeight, w.lineHeight);
    check("font-weight", c.fontWeight, String(w.fontWeight));
    check("dot", c.dot, w.dot);
 // the colour must be one the original actually paints
    const known = Object.entries(FIX.colors).filter(([k]) => !k.startsWith("_"));
    const match = known.find(([, v]) => v.bg === c.bg);
    if (!match) diffs.push(`${c.kind} "${c.text}": background ${c.bg} is not one of the original's ${known.length} chip colours`);
    else if (match[1].text !== c.text_) diffs.push(`${c.kind} "${c.text}": ${match[0]} label ${c.text_} ≠ ${match[1].text}`);
  }
}

for (const [k, exp] of [["firstChipInsetLeft", FIX.cell.firstChipInsetLeft], ["gapBetweenChips", FIX.cell.gapBetweenChips], ["height", FIX.cell.height]]) {
  const got = layout[k];
  if (got === null || got === undefined) { console.log(`  (cell ${k}: nothing to measure on this page)`); continue; }
  if (got !== exp) diffs.push(`cell: ${k} ${got} ≠ ${exp}`);
}

console.log(`compared ${chips.length} chips (${seen.size} distinct kind+colour) and the cell layout against the original`);
if (diffs.length) {
  console.error("\n  ┌─ Differs from the original ────────────────────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ reference: src/i18n/content/e2e-fixtures/notion-chips.json (values measured on the original)");
  console.error("  └───────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("0 diffs — chip shapes and colours match the original.");
