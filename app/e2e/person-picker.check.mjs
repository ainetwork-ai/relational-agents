// Compares the person picker against the original's numbers.
//
// The reference is `src/i18n/content/e2e-fixtures/notion-person-picker.json` — values measured in
// Notion by opening three pickers: TL (250px cell) · Sherpa (117px empty cell) · Assignee (469px cell).
// That is also where the width rule came from: not "cell width" but **max(240, cell width)** (240 on the 117 cell).
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/person-picker.check.mjs
//
// Read-only: open the cell, measure, Escape. Nobody gets picked.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
// TL (has a person) · Sherpa (empty cell, narrow) — the same columns measured in Notion
const COLUMNS = [
  { name: "TL", id: "a5e56bb9-f142-4d50-846e-1cd135407a83" },
  { name: "Sherpa", id: "b5f04d82-95f6-49c0-8e39-e481569e3afe" },
];

const G = JSON.parse(
  fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-person-picker.json", import.meta.url), "utf8"),
);
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 870 } });
await ctx.addCookies([
  { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
]);
const page = await ctx.newPage();
// the dev server is shared with other sessions, so the first compile can take minutes
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
await page.waitForTimeout(1200);

const READ = (labelText) => {
  const box = document.querySelector("[data-testid^='db-person-popover-']");
  if (!box) return null;
  const rb = box.getBoundingClientRect();
  const rel = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x - rb.x), y: Math.round(r.y - rb.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const bar = box.firstElementChild;
  const input = box.querySelector("input");
  const label = [...box.querySelectorAll("div,span")].find((d) => d.textContent.trim() === labelText && !d.children.length);
  const rows = [...box.querySelectorAll("[data-testid^='db-person-'][data-testid*='-']")].filter(
    (n) => n.tagName === "BUTTON" && !n.dataset.testid.includes("remove"),
  );
  const chips = [...bar.querySelectorAll("span")].filter((s) => s.querySelector("img,span") && s.className.includes("items-center"));
  const remove = bar.querySelector("[data-testid*='-remove-']");
  const firstRow = rows[0];
  const avatar = firstRow?.querySelector("img,span");
  const nameEl = firstRow?.querySelector("span:last-child");
  return {
    box: { w: Math.round(rb.width), h: Math.round(rb.height), x: Math.round(rb.x), y: Math.round(rb.y), radius: getComputedStyle(box).borderRadius, bg: getComputedStyle(box).backgroundColor },
    bar: { ...rel(bar), bg: getComputedStyle(bar).backgroundColor, radius: getComputedStyle(bar).borderRadius, maxH: getComputedStyle(bar).maxHeight },
    input: input ? { ...rel(input), fs: getComputedStyle(input).fontSize } : null,
    label: label ? { ...rel(label), fs: getComputedStyle(label).fontSize, fw: getComputedStyle(label).fontWeight } : null,
    rows: rows.slice(0, 3).map(rel),
    rowAvatar: avatar ? rel(avatar) : null,
    rowName: nameEl ? { ...rel(nameEl), fs: getComputedStyle(nameEl).fontSize } : null,
    remove: remove ? { ...rel(remove), label: remove.getAttribute("aria-label") } : null,
    firstChip: chips[0] ? rel(chips[0]) : null,
  };
};

const diffs = [];
const eq = (w, got, want) => { if (String(got) !== String(want)) diffs.push(`${w}: ours ${got} / Notion ${want}`); };
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) diffs.push(`${w}: ours ${got} / Notion ${want}`); };

for (const col of COLUMNS) {
  const sel = `[data-testid^='db-cell-'][data-testid$='-${col.id}']`;
  await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center", inline: "start" }), sel);
  await page.waitForTimeout(500);
  const cell = page.locator(sel).first();
  const cr = await cell.evaluate((c) => {
    const e = c.closest("[data-cellnav]") ?? c;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), t: e.innerText.trim() };
  });
  await cell.click();
  await page.waitForTimeout(400);
  const o = await page.evaluate(READ, ko("Select as many as you like"));
  if (!o) { diffs.push(`${col.name}: the picker did not open`); continue; }

  const wantW = Math.max(240, cr.w);
  eq(`${col.name} box.width (cell ${cr.w})`, o.box.w, wantW);
  eq(`${col.name} box.height`, o.box.h, G.box.h);
  eq(`${col.name} box.radius`, o.box.radius, G.box.radius);
  near(`${col.name} box.x − cell.x`, o.box.x - cr.x, G.box.dxFromCell);
  near(`${col.name} box.y − cell.y`, o.box.y - cr.y, G.box.dyFromCell);

  eq(`${col.name} bar.bg`, o.bar.bg, G.bar.bg);
  eq(`${col.name} bar.radius`, o.bar.radius, G.bar.radius);
  eq(`${col.name} bar.maxHeight`, o.bar.maxH, G.bar.maxH);
  if (!cr.t) near(`${col.name} empty bar height`, o.bar.h, G.bar.emptyH);

  near(`${col.name} input height`, o.input?.h, G.bar.inputH);
  eq(`${col.name} input size`, o.input?.fs, G.bar.inputFs);
  if (!cr.t) near(`${col.name} input y`, o.input?.y, G.bar.itemY);

  if (cr.t) {
    near(`${col.name} selected item y`, o.firstChip?.y, G.bar.itemY);
    near(`${col.name} selected item x`, o.firstChip?.x, G.bar.avatarX);
    near(`${col.name} remove item size`, o.remove?.w, G.bar.removeSize);
    eq(`${col.name} remove item label`, o.remove?.label, G.bar.removeLabel);
  }

  near(`${col.name} label x`, o.label?.x, G.label.x);
  near(`${col.name} label y`, o.label?.y, o.bar.h + G.label.gapAfterBar);
  eq(`${col.name} label size`, o.label?.fs, G.label.fs);
  eq(`${col.name} label weight`, o.label?.fw, G.label.fw);

  near(`${col.name} option row x`, o.rows[0]?.x, G.row.x);
  near(`${col.name} option row height`, o.rows[0]?.h, G.row.h);
  near(`${col.name} option row y`, o.rows[0]?.y, (o.label?.y ?? 0) + G.label.h + G.row.gapAfterLabel);
  if (o.rows[1]) near(`${col.name} option row pitch`, o.rows[1].y - o.rows[0].y, G.row.pitch);
  near(`${col.name} avatar x`, o.rowAvatar?.x, G.row.avatarX);
  near(`${col.name} avatar size`, o.rowAvatar?.w, G.row.avatarSize);
  near(`${col.name} name x`, o.rowName?.x, G.row.nameX);
  eq(`${col.name} name size`, o.rowName?.fs, G.row.nameFs);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

await browser.close();

if (diffs.length) {
  console.error(`\n  ┌─ Person picker differs from the original (${diffs.length}) ──────────────`);
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ reference: src/i18n/content/e2e-fixtures/notion-person-picker.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`person picker matches the original — ${COLUMNS.map((c) => c.name).join(" · ")} (box/bar/selected items/label/rows)`);
