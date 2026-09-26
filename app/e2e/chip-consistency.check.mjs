// The same value must look the same wherever it is drawn.
//
// It did not: the cells drew a 12px square-ish chip and the Status menu drew
// the original's 20px pill with a dot, so one status read as two different
// things on one screen. There is one `OptionChip` now — this check is what
// keeps it that way, by measuring the SAME option in the cell and in the menu
// and comparing them to each other (and the menu's chip to the numbers read
// off app.notion.com, in src/i18n/content/e2e-fixtures/notion-status-dropdown.json).
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] [PROP_ID=…] \
//     node e2e/chip-consistency.check.mjs
//
// Read-only: opens the menu, measures, closes with Escape. Nothing is picked.

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
const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 } });
await ctx.addCookies([
  { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
await page.waitForTimeout(1200);

/** every measurable thing about a chip, so a divergence anywhere shows up */
const CHIP = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  const dot = el.querySelector("span.rounded-full");
  const label = el.querySelector("span:not(.rounded-full)");
  const ls = label && getComputedStyle(label);
  return {
    h: Math.round(r.height),
    radius: s.borderRadius,
    bg: s.backgroundColor,
    padding: s.padding,
    dot: dot
      ? {
          size: Math.round(dot.getBoundingClientRect().width),
          bg: getComputedStyle(dot).backgroundColor,
          gap: Math.round(label.getBoundingClientRect().left - dot.getBoundingClientRect().right),
          inset: Math.round(dot.getBoundingClientRect().left - r.left),
        }
      : null,
    label: ls ? { fs: ls.fontSize, lh: ls.lineHeight, color: ls.color } : null,
  };
};

const cellSel = `[data-testid^='db-cell-'][data-testid$='-${PROP_ID}']`;
await page.evaluate(
  (sel) => document.querySelector(sel)?.scrollIntoView({ block: "center", inline: "start" }),
  cellSel,
);
await page.waitForTimeout(500);

const cell = page.locator(cellSel).first();
const value = (await cell.innerText()).trim();
const inCell = await cell.evaluate(
  (c, fn) => new Function("el", `return (${fn})(el)`)(c.querySelector("[data-chip]")),
  CHIP.toString(),
);
await cell.click();
await page.waitForTimeout(400);

const inMenu = await page.evaluate(
  ([v, fn]) => {
    const box = document.querySelector("[data-testid^='db-status-popover-']");
    if (!box) return null;
    // the option row carrying the same value as the cell — not the search bar's
    const chips = [...box.querySelectorAll("[data-testid^='db-option-'] [data-chip]")];
    const same = chips.find((c) => c.textContent.trim() === v) ?? chips[0];
    return new Function("el", `return (${fn})(el)`)(same);
  },
  [value, CHIP.toString()],
);

await page.keyboard.press("Escape");
await browser.close();

const diffs = [];
if (!inCell) diffs.push(`no chip in the cell (value "${value}")`);
if (!inMenu) diffs.push("no chip in the menu");

if (inCell && inMenu) {
  const walk = (a, b, path = "") => {
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      const av = a?.[k], bv = b?.[k];
      if (av && typeof av === "object") walk(av, bv, `${path}${k}.`);
      else if (String(av) !== String(bv)) diffs.push(`${path}${k}: cell ${av} / menu ${bv}`);
    }
  };
  walk(inCell, inMenu);

  // and the shared shape is still the original's, not just self-consistent
  if (inCell.h !== G.chip.h) diffs.push(`chip height: ours ${inCell.h} / Notion ${G.chip.h}`);
  if (inCell.radius !== G.chip.radius)
    diffs.push(`chip radius: ours ${inCell.radius} / Notion ${G.chip.radius}`);
  if (inCell.label?.fs !== G.chip.labelFs)
    diffs.push(`chip label size: ours ${inCell.label?.fs} / Notion ${G.chip.labelFs}`);
  if (inCell.dot?.size !== G.chip.dotSize)
    diffs.push(`chip dot size: ours ${inCell.dot?.size} / Notion ${G.chip.dotSize}`);
}

if (diffs.length) {
  console.error("\n  ┌─ The chip differs from place to place ────────────────────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ There must be only one chip: components/database/option-chip.tsx.");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `chips match — "${value}" has the same shape in the cell and the menu (h${inCell.h} radius${inCell.radius} dot${inCell.dot?.size ?? "none"} ${inCell.label?.fs})`,
);
