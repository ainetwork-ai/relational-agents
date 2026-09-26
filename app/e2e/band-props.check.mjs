// Is the pinned property band the same as the original — what shows (set, order, same for every row), several people,
// the item width rule, the arrows, and the peek/full-page difference. Measured original: src/i18n/content/e2e-fixtures/notion-row-props-band.json.
// Geometry (label 24 · value 30 · gap 8 · arrow 32) is row-props.check.mjs's job — here only what does not overlap.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/band-props.check.mjs
//
// What stands in the band is the database's choice (config.pinned/pinnedOrder), so if the dev DB was
// reseeded, first pin TL · Assignee · End date · Evaluation in this order from the peek's
// `Customize layout` — otherwise the very first comparison is off.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-row-props-band.json", import.meta.url), "utf8"));

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const fails = [];
const ok = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fails.push(label); };
const near = (a, b, tol = G.tolerance) => a != null && b != null && Math.abs(a - b) <= tol;

// walk the band and read, per item, name · width · label width · the value's real content width · person chips/+N
const MEASURE = `(root) => {
  const band = root.querySelector("[data-pinned-row]");
  if (!band) return null;
  const sc = band.querySelector("[data-role='band-track']").parentElement;
  const br = band.getBoundingClientRect();
  const items = [...band.querySelectorAll("[data-testid^='row-props-item-']")].map((it) => {
    const r = it.getBoundingClientRect();
    const label = it.querySelector("[data-role='label']");
    const value = it.querySelector("[data-role='value']");
    const vr = value.getBoundingClientRect();
 // the value's ink width: the cell's inner content + side padding 6+6
    const inner = value.firstElementChild;
    const ink = inner ? Math.ceil(inner.scrollWidth) + 12 : 0;
    const chips = value.querySelectorAll("img, [data-avatar], span > span").length;
    const overflow = value.querySelector("[data-role='person-overflow']");
    const chipEls = [...value.querySelectorAll("span")].filter((s) => s.querySelector("img, div[aria-hidden]") || /flex shrink-0 items-center/.test(s.className));
    return {
      name: it.querySelector("[data-role='label-text']").textContent.trim(),
      type: it.getAttribute("data-type"),
      item: +r.width.toFixed(1), label: +label.getBoundingClientRect().width.toFixed(1),
      valueInk: ink, valueH: +vr.height.toFixed(1),
      empty: !!it.querySelector("[data-role='empty']"),
      text: value.innerText.trim().replace(/\\n/g, " "),
      overflowText: overflow ? overflow.textContent.trim() : null,
      chipCount: chipEls.length,
    };
  });
  const arrows = [...band.querySelectorAll("[data-role='band-arrow']")].map((a) => {
    const r = a.getBoundingClientRect(); const s = getComputedStyle(a);
    return { dx: +(r.left - br.left).toFixed(1), op: +(+s.opacity).toFixed(2), cx: r.left + 16, cy: r.top + 16 };
  }).sort((a, b) => a.dx - b.dx);
  return { bandX: +br.left.toFixed(1), bandW: +br.width.toFixed(1),
    clientW: sc.clientWidth, scrollW: sc.scrollWidth, scrollLeft: +sc.scrollLeft.toFixed(1), items, arrows };
}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
await page.evaluate(() => localStorage.removeItem("row-peek-width"));

const measure = (sel) => page.evaluate(
  ([fn, s]) => new Function("return " + fn)()(document.querySelector(s)),
  [MEASURE, sel]
);
const rowIds = [...new Set(await page.$$eval("[data-testid^='db-row-']", (els) =>
  els.map((e) => e.getAttribute("data-testid").replace("db-row-", ""))
     .filter((id) => id && !/^drag-|^check-|^expand-/.test(id))
))];
const openPeek = async (rowIndex) => {
  const id = rowIds[rowIndex];
 // the same row can be drawn once per group, so use only the first
  await page.locator(`[data-testid='db-row-${id}']`).first().hover();
  await page.locator(`[data-testid='db-title-open-${id}']`).first().click({ timeout: 8000 });
  await page.waitForSelector("[data-testid='db-row-peek'] [data-pinned-row]", { timeout: 20_000 });
  await page.waitForTimeout(700);
};
const closePeek = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); };

// ── 1. What shows: same set, same order on every row; empty values keep their place ──
console.log("\n— set and order (original: the same 4 on all 33 rows) —");
const WANT = G.set.properties;
let sawEmpty = false;
for (const i of [0, 1, 2, 3, 4]) {
  await openPeek(i);
  const m = await measure("[data-testid='db-row-peek']");
  const names = m.items.map((x) => x.name);
  ok(JSON.stringify(names) === JSON.stringify(WANT), `row ${i + 1}: ${names.join(" · ")}`);
  if (m.items.some((x) => x.empty)) {
    sawEmpty = true;
    for (const it of m.items.filter((x) => x.empty)) {
      ok(it.text.replace(/\s+/g, "").includes(ko("Empty").replace(/\s+/g, "")), `row ${i + 1} ${it.name}: an empty value keeps its place ("${it.text}")`);
      ok(near(it.item, Math.max(80, it.label)), `row ${i + 1} ${it.name}: empty item width = max(80, label) — ${it.item} vs ${Math.max(80, it.label)}`);
    }
  }
  await closePeek();
}
ok(sawEmpty, "the sample had a row with an empty pinned property");

// ── 2. Several people: one chip + `+ N` ──
console.log("\n— several people —");
let checkedMany = false, checkedOne = false;
for (let i = 0; i < 8 && !(checkedMany && checkedOne); i++) {
  await openPeek(i);
  const m = await measure("[data-testid='db-row-peek']");
  for (const it of m.items.filter((x) => x.type === "person" && !x.empty)) {
    const n = (it.text.match(/\+\s*(\d+)/) ?? [])[1];
    if (n) {
      if (checkedMany) continue;
      checkedMany = true;
      ok(it.chipCount === G.people.chipsShown, `${it.name}: ${it.chipCount} chips (original 1) + "${it.overflowText}"`);
      ok(it.overflowText === `+ ${n}`, `${it.name}: overflow badge "${it.overflowText}"`);
      ok(near(it.valueH, G.people.valueHeight.withOverflow), `${it.name}: value height ${it.valueH} (original 31)`);
      ok(it.item <= G.width.max, `${it.name}: item width ${it.item} ≤ 200`);
    } else if (!checkedOne) {
      checkedOne = true;
      ok(near(it.valueH, G.people.valueHeight.plain), `${it.name}: value height with one person ${it.valueH} (original 30)`);
    }
  }
  await closePeek();
}
ok(checkedMany, "measured a pinned property with two or more people");

// ── 2b. Value height: 30 for dates, 31 for people only when there is a +N ──
console.log("\n— value height —");
{
  await openPeek(0);
  const m = await measure("[data-testid='db-row-peek']");
  for (const it of m.items) {
    if (it.type === "date")
      ok(near(it.valueH, 30, 0.5), `${it.name}(date): value height ${it.valueH} (original 30 — padding 4/4 + one 21px line)`);
    if (it.type === "person" && !it.empty)
      ok(near(it.valueH, it.overflowText ? 31 : 30, 0.5), `${it.name}(person${it.overflowText ? " +N" : ""}): value height ${it.valueH} (original ${it.overflowText ? 31 : 30})`);
  }
  await closePeek();
}

// ── 3. Width rule: clamp(max(label, value), 80, 200), independent of window width and surface ──
console.log("\n— item width —");
await openPeek(0);
const widthsByWin = {};
for (const w of [1000, 1200, 1500]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(500);
  const m = await measure("[data-testid='db-row-peek']");
  widthsByWin[w] = m.items.map((x) => x.item);
  for (const it of m.items) {
    ok(it.item >= G.width.min - G.tolerance && it.item <= G.width.max + G.tolerance, `@${w} ${it.name}: 80 ≤ ${it.item} ≤ 200`);
    ok(it.item >= it.label - G.tolerance, `@${w} ${it.name}: not narrower than the label (${it.label})`);
    if (!it.empty && it.valueInk < G.width.max)
      ok(near(it.item, Math.max(G.width.min, it.label, it.valueInk), 4), `@${w} ${it.name}: width ${it.item} = max(80, label ${it.label}, value ${it.valueInk})`);
  }
}
ok(JSON.stringify(widthsByWin[1000]) === JSON.stringify(widthsByWin[1200]) &&
   JSON.stringify(widthsByWin[1200]) === JSON.stringify(widthsByWin[1500]),
  `item widths stay the same across window widths: ${JSON.stringify(widthsByWin[1200])}`);
await page.setViewportSize({ width: 1200, height: 900 });
await page.waitForTimeout(400);

// ── 4. Arrows: only on overflow, one step = (visible width − 200) ──
console.log("\n— scroll arrows —");
{
 // narrow the window so the band overflows
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(600);
  const m = await measure("[data-testid='db-row-peek']");
  const over = m.scrollW - m.clientW;
  ok(over > 0, `band overflows (${m.clientW} / ${m.scrollW})`);
  ok(m.arrows[0]?.op === 0, "left arrow hidden at the start");
  ok(m.arrows[1]?.op === 1, "right arrow shown on overflow (without hover)");
  await page.mouse.click(m.arrows[1].cx, m.arrows[1].cy);
  await page.waitForTimeout(900);
  const m2 = await measure("[data-testid='db-row-peek']");
  const want = Math.min(m.clientW - 200, over);
  ok(near(m2.scrollLeft, want, 4), `one click scrolls ${m2.scrollLeft} (original rule clientW−200 = ${want})`);
  ok(m2.arrows[0]?.op === 1, "left arrow shown after scrolling");
  if (near(m2.scrollLeft, over, 4)) ok(m2.arrows[1]?.op === 0, "right arrow hidden at the end");
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(500);
}

// ── 4b. A value at the cap shrinks with an ellipsis ──
console.log("\n— at 200px —");
{
  const capped = await page.evaluate(() => {
    const items = [...document.querySelectorAll("[data-testid='db-row-peek'] [data-testid^='row-props-item-']")];
    const hit = items.find((it) => Math.round(it.getBoundingClientRect().width) >= 199);
    if (!hit) return null;
    const value = hit.querySelector("[data-role='value']");
 // the innermost element holding the text — the original puts nowrap/ellipsis here
    const leaf = [...value.querySelectorAll("*")].find((e) => e.scrollWidth > e.clientWidth + 1) ?? value;
    const s = getComputedStyle(leaf);
    return { name: hit.querySelector("[data-role='label-text']").textContent.trim(),
      item: +hit.getBoundingClientRect().width.toFixed(1),
      valueOverflow: getComputedStyle(value).overflow,
      leafW: Math.round(leaf.clientWidth), inkW: Math.round(leaf.scrollWidth),
      te: s.textOverflow, ws: s.whiteSpace, ov: s.overflow, text: value.innerText.trim() };
  });
  if (!capped) {
    console.log("· no pinned property at the cap on this row — ellipsis comparison skipped");
  } else {
    ok(capped.valueOverflow === "hidden", `${capped.name}: value cell hides overflow (${capped.valueOverflow})`);
    ok(capped.ws === "nowrap", `${capped.name}: stays on one line (${capped.ws})`);
    ok(capped.te === "ellipsis", `${capped.name}: shortened with an ellipsis (${capped.te}) — "${capped.text.slice(0, 24)}…"`);
    ok(capped.inkW > capped.leafW, `${capped.name}: real text width ${capped.inkW} > visible width ${capped.leafW} (original 232.3 → 188)`);
  }
}

// ── 5. Peek / full page: same rules, only the available width differs ──
console.log("\n— peek and full page —");
const peek = await measure("[data-testid='db-row-peek']");
const peekTitle = await page.locator("[data-testid='db-peek-title']").boundingBox();
ok(near(peek.bandX - peekTitle.x, G.surface.peek.bandOffsetFromTitle), `peek: band is ${(peek.bandX - peekTitle.x).toFixed(1)}px right of the title (original 2)`);
await page.locator("[data-testid='db-peek-open-full']").click();
await page.waitForSelector("[data-testid='page-row-props'] [data-pinned-row]", { timeout: 30_000 });
await page.waitForTimeout(1200);
const full = await measure("[data-testid='page-root']");
ok(JSON.stringify(full.items.map((x) => x.name)) === JSON.stringify(WANT), `full page has the same set: ${full.items.map((x) => x.name).join(" · ")}`);
ok(JSON.stringify(full.items.map((x) => x.item)) === JSON.stringify(peek.items.map((x) => x.item)),
  `full-page item widths equal the peek's: ${JSON.stringify(full.items.map((x) => x.item))}`);
const fullTitle = await page.locator("[data-testid='page-title']").boundingBox();
ok(near(full.bandX - fullTitle.x, G.surface.peek.bandOffsetFromTitle), `full page: band is ${(full.bandX - fullTitle.x).toFixed(1)}px right of the title (original 2)`);

await browser.close();
if (fails.length) { console.error(`\n${fails.length} failed`); process.exit(1); }
console.log("\nno difference from the original — exit 0");
