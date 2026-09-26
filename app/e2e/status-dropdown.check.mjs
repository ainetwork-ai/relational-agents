// Our Status menu, measured against the original's numbers.
//
// This is the check I did not have while I was rebuilding the Projects page by
// inference: it does not ask "does our menu look reasonable", it asks "is it
// the same as `src/i18n/content/e2e-fixtures/notion-status-dropdown.json`", which was read off
// app.notion.com with the cell open. Anything that drifts shows up as a line
// with both numbers on it.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] [PROP_ID=…] \
//     node e2e/status-dropdown.check.mjs
//
// Read-only: it opens the menu, measures, types into the search box, and never
// clicks an option, so no row's value changes.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238"; // Projects
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const PROP_ID = process.env.PROP_ID ?? "18a19305-1988-4ea4-815f-266855ac997f"; // Status

const G = JSON.parse(
  fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-status-dropdown.json", import.meta.url), "utf8"),
);
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
// wide enough that the menu is placed against the cell rather than pushed off
// the right edge — placement clamping is correct behaviour, not a diff
const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 } });
await ctx.addCookies([
  { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
await page.waitForTimeout(1200);

const cellSel = `[data-testid^='db-cell-'][data-testid$='-${PROP_ID}']`;
// "start" on purpose: the menu is 240 wide and must have room to its right,
// or placement clamps it to the window edge and the offset check reads a diff
// that is correct behaviour, not a mismatch
await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center", inline: "start" }), cellSel);
await page.waitForTimeout(500);
const cell = page.locator(cellSel).first();
const cellRect = await cell.evaluate((c) => {
  const e = c.closest("[data-cellnav]") ?? c;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
await cell.click();
await page.waitForTimeout(400);

/** the same walk the original was measured with */
const READ = () => {
  const box = document.querySelector("[data-testid^='db-status-popover-']");
  if (!box) return null;
  const rb = box.getBoundingClientRect();
  const rel = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x - rb.x), y: Math.round(r.y - rb.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const nodes = [...box.querySelectorAll("*")];
  const sb = getComputedStyle(box);
  const bar = box.firstElementChild;
  const rows = nodes.filter((n) => n.dataset?.testid?.startsWith("db-option-"));
  const labels = nodes.filter((n) => !n.children.length && /^12px$/.test(getComputedStyle(n).fontSize) && getComputedStyle(n).fontWeight === "500" && n.textContent.trim());
  const rules = nodes.filter((n) => Math.round(n.getBoundingClientRect().height) === 1 && Math.round(n.getBoundingClientRect().width) > 100);
  const footer = box.querySelector("[data-testid^='db-status-edit-property-']");
  const chip = rows[0]?.firstElementChild;
  const barChip = bar?.querySelector("span");
  return {
    box: { w: Math.round(rb.width), h: Math.round(rb.height), radius: sb.borderRadius, bg: sb.backgroundColor, x: Math.round(rb.x), y: Math.round(rb.y) },
    bar: bar ? { ...rel(bar), bg: getComputedStyle(bar).backgroundColor, radius: getComputedStyle(bar).borderRadius } : null,
    barChip: barChip ? rel(barChip) : null,
    chip: chip
      ? {
          ...rel(chip),
          radius: getComputedStyle(chip).borderRadius,
          dot: chip.firstElementChild ? rel(chip.firstElementChild) : null,
          label: chip.lastElementChild ? { ...rel(chip.lastElementChild), fs: getComputedStyle(chip.lastElementChild).fontSize } : null,
        }
      : null,
    rows: rows.map((n) => ({ ...rel(n), bg: getComputedStyle(n).backgroundColor })),
    labels: labels.map((n) => ({ ...rel(n), fs: getComputedStyle(n).fontSize, fw: getComputedStyle(n).fontWeight, color: getComputedStyle(n).color, t: n.textContent.trim() })),
    rules: rules.map((n) => ({ ...rel(n), color: getComputedStyle(n).backgroundColor })),
    footer: footer
      ? {
          row: rel(footer.parentElement),
          icon: footer.querySelector("svg") ? rel(footer.querySelector("svg")) : null,
          text: footer.querySelector("span") ? { ...rel(footer.querySelector("span")), fs: getComputedStyle(footer.querySelector("span")).fontSize, t: footer.querySelector("span").textContent.trim() } : null,
        }
      : null,
    text: box.innerText.split("\n").map((s) => s.trim()).filter(Boolean),
  };
};

const ours = await page.evaluate(READ);
if (!ours) {
  console.error("the Status menu did not open (no db-status-popover-*)");
  await browser.close();
  process.exit(1);
}

const diffs = [];
const eq = (what, got, want) => {
  if (String(got) !== String(want)) diffs.push(`${what}: ours ${got} / Notion ${want}`);
};
const near = (what, got, want, tol = 1) => {
  if (Math.abs(Number(got) - Number(want)) > tol) diffs.push(`${what}: ours ${got} / Notion ${want}`);
};
/** rgb()/rgba()/color(srgb …) → [r,g,b,a] in 0..255 / 0..1, so the same colour
 *  written two ways (and alpha rounded to 2 places by the serializer) matches */
const parseColor = (v) => {
  const n = String(v).match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
  if (String(v).startsWith("color(")) return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1];
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
};
const sameColor = (what, got, want) => {
  const a = parseColor(got), b = parseColor(want);
  const off = a.slice(0, 3).some((v, i) => Math.abs(v - b[i]) > 1) || Math.abs(a[3] - b[3]) > 0.01;
  if (off) diffs.push(`${what}: ours ${got} / Notion ${want}`);
};

eq("box.width", ours.box.w, G.box.w);
eq("box.height", ours.box.h, G.box.h);
eq("box.radius", ours.box.radius, G.box.radius);
sameColor("box.bg", ours.box.bg, G.box.bg);
near("box.x − cell.x", ours.box.x - cellRect.x, G.box.dxFromCell);
near("box.y − cell.y", ours.box.y - cellRect.y, G.box.dyFromCell);

eq("bar.height", ours.bar?.h, G.bar.h);
sameColor("bar.bg", ours.bar?.bg, G.bar.bg);
eq("bar.radius", ours.bar?.radius, G.bar.radius);
near("bar chip x", ours.barChip?.x, G.bar.chipX);
near("bar chip y", ours.barChip?.y, G.bar.chipY);
near("bar chip height", ours.barChip?.h, G.bar.chipH);

eq("chip.radius", ours.chip?.radius, G.chip.radius);
near("chip.height", ours.chip?.h, G.chip.h);
near("chip dot x", ours.chip?.dot?.x, G.chip.dotX);
near("chip dot size", ours.chip?.dot?.w, G.chip.dotSize);
near("chip label x", ours.chip?.label?.x, G.chip.labelX);
eq("chip label font-size", ours.chip?.label?.fs, G.chip.labelFs);

eq("option row count", ours.rows.length, G.optionRow.ys.length);
ours.rows.forEach((r, i) => {
  near(`option row #${i} x`, r.x, G.optionRow.x);
  near(`option row #${i} width`, r.w, G.optionRow.w);
  near(`option row #${i} height`, r.h, G.optionRow.h);
  if (G.optionRow.ys[i] != null) near(`option row #${i} y`, r.y, G.optionRow.ys[i]);
 // nothing is typed, so nothing is highlighted — the hovered/keyboard row is
 // the one thing that may differ here, and it must differ in no row at all
  sameColor(`option row #${i} background (before search)`, r.bg, G.optionRow.bgUnfiltered);
});

eq("group label count", ours.labels.length, G.groupLabel.ys.length);
ours.labels.forEach((l, i) => {
  near(`group label #${i} x`, l.x, G.groupLabel.x);
  if (G.groupLabel.ys[i] != null) near(`group label #${i} y`, l.y, G.groupLabel.ys[i]);
  sameColor(`group label #${i} color`, l.color, G.groupLabel.color);
  eq(`group label #${i} font-size`, l.fs, G.groupLabel.fs);
});

eq("divider count", ours.rules.length, G.divider.ys.length);
ours.rules.forEach((d, i) => {
  near(`divider #${i} x`, d.x, G.divider.x);
  near(`divider #${i} width`, d.w, G.divider.w);
  if (G.divider.ys[i] != null) near(`divider #${i} y`, d.y, G.divider.ys[i]);
  sameColor(`divider #${i} color`, d.color, G.divider.color);
});

near("footer row y", ours.footer?.row?.y, G.footer.rowY);
near("footer row height", ours.footer?.row?.h, G.footer.rowH);
near("footer icon x", ours.footer?.icon?.x, G.footer.iconX);
near("footer icon size", ours.footer?.icon?.w, G.footer.iconSize, 2);
near("footer text x", ours.footer?.text?.x, G.footer.textX);
eq("footer text", ours.footer?.text?.t, G.footer.text);

// index 0 is the row's own value in the search bar, which differs per row
eq("reading order", JSON.stringify(ours.text.slice(1)), JSON.stringify(G.order.slice(1)));

// --- the search states -----------------------------------------------------
const search = page.locator("[data-testid^='db-status-search-']").first();
await search.fill(G.filtered._query);
await page.waitForTimeout(300);
const filtered = await page.evaluate(READ);
near(`search("${G.filtered._query}") box.height`, filtered?.box.h, G.filtered.boxH);
near(`search("${G.filtered._query}") option row y`, filtered?.rows?.[0]?.y, G.filtered.optionRowY);
near(`search("${G.filtered._query}") divider y`, filtered?.rules?.[0]?.y, G.filtered.dividerY);
sameColor(`search("${G.filtered._query}") first row background`, filtered?.rows?.[0]?.bg, G.filtered.firstRowBg);
eq(`search("${G.filtered._query}") group label count`, filtered?.labels.length, G.filtered.groupLabels);
eq(`search("${G.filtered._query}") contents`, JSON.stringify(filtered?.text.slice(1)), JSON.stringify(G.filtered.text.slice(1)));

await search.fill(G.noMatch._query);
await page.waitForTimeout(300);
const none = await page.evaluate(READ);
near(`search("${G.noMatch._query}") box.height`, none?.box.h, G.noMatch.boxH);
eq(`search("${G.noMatch._query}") contents`, JSON.stringify(none?.text.slice(1)), JSON.stringify(G.noMatch.text.slice(1)));

await browser.close();

if (diffs.length) {
  console.error(`\n  ┌─ Status dropdown differs from the original (${diffs.length}) ─────────`);
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ reference: src/i18n/content/e2e-fixtures/notion-status-dropdown.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `Status dropdown matches the original — box/bar/chips/options ${ours.rows.length} rows/${ours.labels.length} groups/${ours.rules.length} dividers/footer, 2 search states`,
);
