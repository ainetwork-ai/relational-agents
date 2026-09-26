// How a row with comments shows in the table — an icon+count badge inside the title cell.
//
// The original puts this badge 5px **right after** the title, not at the right end of the cell. So
// if the title input fills the whole cell this position cannot come out — ours did that.
// Width is a font matter and cannot be matched as is (ours Geist / the original Notion's own stack). Instead
// it measures the values that do not depend on glyphs (height·padding·radius·icon·color·digit spacing rule).
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/row-comment-badge.check.mjs
//
// Read-only: opens the page and only reads coordinates. With no comments in the dev DB there is
// nothing to measure, so it stops with exit 1 then (no disguising as a green light).

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai

const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-row-comments.json", import.meta.url), "utf8")).badge;
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='db-row-']", { timeout: 120_000 });
await page.waitForTimeout(2500);

const got = await page.evaluate(() => {
  const px = (v) => +Number(v).toFixed(2);
  const e = document.querySelector("[data-testid='comment-count-badge']");
  if (!e) return { none: true, rows: document.querySelectorAll("[data-testid^='db-row-']").length };
  const cs = getComputedStyle(e);
  const svg = e.querySelector("svg");
  const r = e.getBoundingClientRect();
 // Between the right end of the title input and the badge — 5px in the original
  const cell = e.parentElement;
  const input = cell.querySelector("input");
  const ir = input?.getBoundingClientRect();
  return {
    n: e.innerText.trim(),
    h: px(r.height),
    w: px(r.width),
    radius: cs.borderRadius,
    padLeft: cs.paddingLeft,
    padRight: cs.paddingRight,
    fs: cs.fontSize,
    fw: cs.fontWeight,
    lineHeight: cs.lineHeight,
    color: cs.color,
    cursor: cs.cursor,
    numeric: cs.fontVariantNumeric,
    icon: svg ? px(svg.getBoundingClientRect().width) : null,
    iconFill: svg ? getComputedStyle(svg).fill : null,
    gapAfterTitle: ir ? px(r.x - ir.right) : null,
 // Whether the badge got stuck to the right end of the cell (happens when the title fills the cell)
    cellRightToBadge: px(cell.getBoundingClientRect().right - r.right),
    zeroBadges: [...document.querySelectorAll("[data-testid='comment-count-badge']")]
      .filter((b) => b.innerText.trim() === "0").length,
  };
});
await browser.close();

if (got.none) {
  console.error("\n  ┌─ Nothing to measure ─────────────────────────────────────────");
  console.error(`  │ The table has ${got.rows} rows but not a single comment badge.`);
  console.error("  │ Put comments into the dev DB and run again (the original's 8-row reference is in the fixture).");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}

const d = [];
const eq = (what, a, b) => { if (String(a) !== String(b)) d.push(`${what}: ours ${a} / Notion ${b}`); };
const near = (what, a, b, tol) => { if (Math.abs(Number(a) - Number(b)) > tol) d.push(`${what}: ours ${a} / Notion ${b}`); };

eq("height", got.h, G.h);
eq("radius", got.radius, G.radius);
eq("left padding", got.padLeft, "2px");
eq("right padding", got.padRight, "5px");
eq("font size", got.fs, G.fs);
eq("font weight", got.fw, G.fw);
eq("line height", got.lineHeight, G.lineHeight);
eq("color", got.color, "rgb(44, 44, 43)");
eq("cursor", got.cursor, G.cursor);
eq("icon size", got.icon, G.icon.size);
eq("icon color", got.iconFill, G.icon.fill);
near("gap after the title", got.gapAfterTitle, G.gapAfterTitle, 0.5);
if (!/tabular-nums/.test(got.numeric))
  d.push("Digits are not tabular — in the original the badges for 1 and 3 are the same width (33.56)");
if (got.zeroBadges) d.push(`${got.zeroBadges} badges drawn for 0 — the original adds no badge at all for 0`);
 // Width cannot match exactly because of the font, but being stuck to the cell's right end is a layout bug
if (got.cellRightToBadge < 20)
  d.push(`The badge is stuck to the right end of the cell (gap ${got.cellRightToBadge}px) — the original puts it right after the title`);

if (d.length) {
  console.error("\n  ┌─ The row comment badge differs from the original ────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-row-comments.json (badge)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `Comment badge matches the original — ${got.h}px high, icon ${got.icon}px, ${got.gapAfterTitle}px after the title` +
    ` (width ${got.w} vs Notion ${G.w}: the font is Geist, so only glyph widths differ)`
);
