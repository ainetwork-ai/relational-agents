// Chip colours in BOTH themes — do our select/status chips and the property
// editor's colour swatches paint the numbers read off app.notion.com?
//
// Why this exists: the chip carried light-theme literals only. Dark mode drew
// rgb(73,72,70) text on an 0.11 dark overlay over rgb(25,25,25) — the "chips
// don't stand apart in dark" report of 2026-09-09. Notion flips the overlay
// (bright, higher alpha) and the label (near-white tints); the dot does not
// change. Both themes' numbers: e2e/fixtures/notion-chips.json §colors /
// §colorsDark / §swatchLight. Tokens: src/app/globals.css `--chip-*`.
//
//   node e2e/chip-dark.check.mjs        # 0 = same as the original, 1 = diffs
//
// Read-only: opens the Status cell menu → 속성 편집 → first option → colour
// list, reads computed styles, closes with Escape. Nothing is picked.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj
const SHOT = process.env.SHOT; // directory: also save a screenshot per theme

const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-chips.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const KEYS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
/** what the original paints for <key> in <theme>: chip bg/text, swatch fill, ring */
const expected = (theme, key) => {
  if (theme === "dark") {
    const d = G.colorsDark[key];
    return { bg: d.bg, text: d.text, dot: d.dot, swatch: d.swatch, ring: d.ring };
  }
  const c = G.colors[key === "default" ? "gray" : key];
  const sw = key === "default" ? G.swatchLight.default : { swatch: c.bg, ring: c.bg };
  return { bg: c.bg, text: c.text, swatch: sw.swatch, ring: sw.ring };
};

const diffs = [];
const seen = new Set();
const eq = (label, got, want) => { if (got !== want) diffs.push(`${label}: 우리 ${got} / 노션 ${want}`); };

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 }, colorScheme: theme });
  await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
  await ctx.addInitScript((t) => { try { localStorage.setItem("app-theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
  await page.waitForTimeout(1200);
  eq(`${theme}: <html class=dark>`, await page.evaluate(() => document.documentElement.classList.contains("dark")), theme === "dark");

  // 1. every chip on screen, by its colour key
  const readChips = () => page.evaluate(() =>
    [...document.querySelectorAll("[data-chip][data-color]")].map((el) => {
      const label = el.querySelector("span:last-child");
      const dot = el.querySelector(".rounded-full");
      return {
        key: el.getAttribute("data-color"), kind: el.getAttribute("data-chip"), txt: el.textContent.trim().slice(0, 30),
        bg: getComputedStyle(el).backgroundColor, text: label ? getComputedStyle(label).color : null,
        dot: dot ? getComputedStyle(dot).backgroundColor : null,
      };
    }));
  const checkChips = (chips, where) => {
    const byKey = new Map();
    for (const c of chips) if (!byKey.has(c.key)) byKey.set(c.key, c);
    for (const [key, c] of byKey) {
      seen.add(`${theme}:${key}`);
      const w = expected(theme, key);
      eq(`${theme} ${where} ${key} 칩 배경 (${c.txt})`, c.bg, w.bg);
      eq(`${theme} ${where} ${key} 칩 글자 (${c.txt})`, c.text, w.text);
      if (c.dot && w.dot) eq(`${theme} ${where} ${key} 칩 점 (${c.txt})`, c.dot, w.dot);
    }
    return byKey.size;
  };
  const nCell = checkChips(await readChips(), "셀");
  if (!nCell) diffs.push(`${theme}: 표에 칩이 하나도 없습니다 (PAGE_ID/USER_ID 확인)`);

  // 2. Status cell → 속성 편집 → first option → colour list
  const statusCell = page.locator("[data-testid^='db-cell-']").filter({ has: page.locator("[data-chip='status']") }).first();
  if (!(await statusCell.count())) { diffs.push(`${theme}: status 칩이 있는 셀이 없습니다`); await ctx.close(); continue; }
  await statusCell.click();
  await page.locator("[data-testid^='db-status-edit-property-']").click();
  await page.waitForSelector("[data-testid^='db-prop-edit-panel-']");
  await page.waitForTimeout(300);
  checkChips(await readChips(), "메뉴/패널");
  const firstRow = page.locator("[data-optrow]").first();
  const box = await firstRow.boundingBox();
  await firstRow.click({ position: { x: 40, y: box.height / 2 } });
  await page.waitForSelector("[data-testid^='db-option-menu-color-']");
  await page.waitForTimeout(400); // the menu scales in; read it at rest
  const swatches = await page.evaluate(() =>
    [...document.querySelectorAll("[data-testid^='db-option-menu-color-'] [data-swatch]")].map((el) => {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return { key: el.getAttribute("data-swatch"), w: r.width, h: r.height, radius: s.borderRadius, bg: s.backgroundColor, shadow: s.boxShadow };
    }));
  eq(`${theme}: 색 메뉴 스와치 개수`, swatches.length, 10);
  for (const s of swatches) {
    const w = expected(theme, s.key);
    eq(`${theme} 스와치 ${s.key} 채움`, s.bg, w.swatch);
    eq(`${theme} 스와치 ${s.key} 링`, s.shadow, `${w.ring} 0px 0px 0px 1px inset`);
    eq(`${theme} 스와치 ${s.key} 크기`, `${s.w}×${s.h} r${s.radius}`, "18×18 r4px");
  }
  if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await page.screenshot({ path: `${SHOT}/chip-${theme}.png` }); }
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(150); }
  await ctx.close();
}
await browser.close();

const unseen = KEYS.filter((k) => !seen.has(`dark:${k}`));
if (unseen.length) console.log(`(칩으로는 못 본 색 — 스와치로만 대조: ${unseen.join(", ")})`);
if (diffs.length) {
  console.error("\n  ┌─ 칩 색이 원본과 다릅니다 ──────────────────────────────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  └────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("칩 색 — 라이트·다크 모두 원본과 같습니다 (셀·메뉴 칩, 색 메뉴 스와치 10개).");
