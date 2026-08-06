// 행 컨트롤(체크박스·⠿)이 가로 스크롤에서 어디에 있는가.
//
// 스크롤하면 우리 것은 뷰포트 고정 위치에 남아 셀 내용을 덮고 있었다. 원본은
// 스크롤되면 컨트롤을 스크롤러 왼쪽 끝으로 붙여서, 체크박스만 가장자리(+11)에
// 남고 ⠿ 는 스크롤러 바깥으로 나가 보이지 않는다
// (fixtures/notion-row-gutter.json).
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/row-gutter.check.mjs
//
// 읽기 전용: 스크롤과 호버뿐.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const SC = ".no-native-scrollbar.overflow-x-auto";

const G = JSON.parse(
  fs.readFileSync(new URL("./fixtures/notion-row-gutter.json", import.meta.url), "utf8"),
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
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-cellnav]", { timeout: 120_000 });
await page.waitForTimeout(1200);

// 표를 세로로만 화면에 넣는다 (scrollIntoView 는 가로로도 움직인다)
await page.evaluate((sc) => {
  const row = [...document.querySelectorAll("div")].find((d) => d.className.includes?.("group/dbrow"));
  const s = document.querySelector(sc);
  const keep = s?.scrollLeft ?? 0;
  row?.scrollIntoView({ block: "center" });
  if (s) { s.scrollLeft = keep; s.dispatchEvent(new Event("scroll", { bubbles: true })); }
}, SC);
await page.waitForTimeout(600);

const measure = async (left) => {
  await page.evaluate(([sc, l]) => {
    const s = document.querySelector(sc);
    s.scrollLeft = l;
    s.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, [SC, left]);
  await page.waitForTimeout(400);
  const y = await page.evaluate(() =>
    [...document.querySelectorAll("div")]
      .filter((d) => d.className.includes?.("group/dbrow"))
      .map((d) => Math.round(d.getBoundingClientRect().top + d.getBoundingClientRect().height / 2))
      .find((v) => v > 200 && v < 800),
  );
  await page.mouse.move(700, y);
  await page.waitForTimeout(350);
  return page.evaluate(([sc, rowY]) => {
    const s = document.querySelector(sc);
    const sr = s.getBoundingClientRect();
    const rowEl = [...document.querySelectorAll("div")]
      .filter((d) => d.className.includes?.("group/dbrow"))
      .find((d) => Math.abs(d.getBoundingClientRect().top + d.getBoundingClientRect().height / 2 - rowY) < 20);
    const cell = rowEl?.querySelector("[data-cellnav]");
    const grab = (prefix) => {
      const e = [...document.querySelectorAll(`[data-testid^='${prefix}']`)].find(
        (n) => Math.abs(n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2 - rowY) < 20,
      );
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), visible: r.right > sr.left + 1 && r.left < sr.right };
    };
    return {
      scroller: Math.round(sr.left),
      row: cell ? Math.round(cell.getBoundingClientRect().left) : null,
      check: grab("db-row-check-"),
      grip: grab("db-row-drag-"),
    };
  }, [SC, y]);
};

const diffs = [];
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) diffs.push(`${w}: 우리 ${got} / 노션 ${want}`); };

const at0 = await measure(0);
near("스크롤 0 · 체크박스(행 기준)", at0.check?.x - at0.row, G.notScrolled.checkboxFromRow);
near("스크롤 0 · ⠿(행 기준)", at0.grip?.x - at0.row, G.notScrolled.gripFromRow);
if (!at0.check?.visible) diffs.push("스크롤 0 · 체크박스가 안 보입니다");
if (!at0.grip?.visible) diffs.push("스크롤 0 · ⠿가 안 보입니다");

for (const left of [400, 1250]) {
  const at = await measure(left);
  near(`스크롤 ${left} · 체크박스(스크롤러 기준)`, at.check?.x - at.scroller, G.scrolled.checkboxFromScroller);
  if (at.grip?.visible !== G.scrolled.gripVisible)
    diffs.push(`스크롤 ${left} · ⠿ 보임: 우리 ${at.grip?.visible} / 노션 ${G.scrolled.gripVisible}`);
 // 겹침의 정체: 컨트롤이 스크롤러 안쪽 깊숙이 남아 셀 위에 그려지던 것
  if (at.check && at.check.x - at.scroller > 24)
    diffs.push(`스크롤 ${left} · 체크박스가 셀 위에 겹칩니다 (스크롤러+${at.check.x - at.scroller})`);
}

await browser.close();

if (diffs.length) {
  console.error(`\n  ┌─ 행 컨트롤 위치가 원본과 다릅니다 (${diffs.length}건) ────────`);
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-row-gutter.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("행 컨트롤 위치 원본과 일치 — 스크롤 전 행−26/−62, 스크롤 후 체크박스만 스크롤러+11");
