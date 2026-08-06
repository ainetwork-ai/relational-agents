// 사람 피커를 원본 수치와 대조한다.
//
// 기준은 `fixtures/notion-person-picker.json` — 노션에서 TL(250px 셀) ·
// Sherpa(117px 빈 셀) · Assignee(469px 셀) 세 개를 열어 잰 값이다. 폭 규칙이
// "셀 폭"이 아니라 **max(240, 셀 폭)** 이라는 것도 거기서 나왔다(117 셀에서 240).
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] node e2e/person-picker.check.mjs
//
// 읽기 전용: 셀을 열어 재고 Escape. 아무도 고르지 않는다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
// TL(사람 있음) · Sherpa(빈 셀, 좁다) — 노션에서 잰 것과 같은 열
const COLUMNS = [
  { name: "TL", id: "a5e56bb9-f142-4d50-846e-1cd135407a83" },
  { name: "Sherpa", id: "b5f04d82-95f6-49c0-8e39-e481569e3afe" },
];

const G = JSON.parse(
  fs.readFileSync(new URL("./fixtures/notion-person-picker.json", import.meta.url), "utf8"),
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
// dev 서버가 다른 세션과 공유돼 첫 컴파일이 몇 분 걸릴 때가 있다
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
await page.waitForTimeout(1200);

const READ = () => {
  const box = document.querySelector("[data-testid^='db-person-popover-']");
  if (!box) return null;
  const rb = box.getBoundingClientRect();
  const rel = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x - rb.x), y: Math.round(r.y - rb.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const bar = box.firstElementChild;
  const input = box.querySelector("input");
  const label = [...box.querySelectorAll("div,span")].find((d) => d.textContent.trim() === "원하는 만큼 선택" && !d.children.length);
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
const eq = (w, got, want) => { if (String(got) !== String(want)) diffs.push(`${w}: 우리 ${got} / 노션 ${want}`); };
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) diffs.push(`${w}: 우리 ${got} / 노션 ${want}`); };

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
  const o = await page.evaluate(READ);
  if (!o) { diffs.push(`${col.name}: 피커가 열리지 않았습니다`); continue; }

  const wantW = Math.max(240, cr.w);
  eq(`${col.name} box.width (셀 ${cr.w})`, o.box.w, wantW);
  eq(`${col.name} box.height`, o.box.h, G.box.h);
  eq(`${col.name} box.radius`, o.box.radius, G.box.radius);
  near(`${col.name} box.x − cell.x`, o.box.x - cr.x, G.box.dxFromCell);
  near(`${col.name} box.y − cell.y`, o.box.y - cr.y, G.box.dyFromCell);

  eq(`${col.name} bar.bg`, o.bar.bg, G.bar.bg);
  eq(`${col.name} bar.radius`, o.bar.radius, G.bar.radius);
  eq(`${col.name} bar.maxHeight`, o.bar.maxH, G.bar.maxH);
  if (!cr.t) near(`${col.name} 빈 바 높이`, o.bar.h, G.bar.emptyH);

  near(`${col.name} 입력 높이`, o.input?.h, G.bar.inputH);
  eq(`${col.name} 입력 크기`, o.input?.fs, G.bar.inputFs);
  if (!cr.t) near(`${col.name} 입력 y`, o.input?.y, G.bar.itemY);

  if (cr.t) {
    near(`${col.name} 선택항목 y`, o.firstChip?.y, G.bar.itemY);
    near(`${col.name} 선택항목 x`, o.firstChip?.x, G.bar.avatarX);
    near(`${col.name} 항목 제거 크기`, o.remove?.w, G.bar.removeSize);
    eq(`${col.name} 항목 제거 라벨`, o.remove?.label, G.bar.removeLabel);
  }

  near(`${col.name} 라벨 x`, o.label?.x, G.label.x);
  near(`${col.name} 라벨 y`, o.label?.y, o.bar.h + G.label.gapAfterBar);
  eq(`${col.name} 라벨 크기`, o.label?.fs, G.label.fs);
  eq(`${col.name} 라벨 굵기`, o.label?.fw, G.label.fw);

  near(`${col.name} 옵션 행 x`, o.rows[0]?.x, G.row.x);
  near(`${col.name} 옵션 행 높이`, o.rows[0]?.h, G.row.h);
  near(`${col.name} 옵션 행 y`, o.rows[0]?.y, (o.label?.y ?? 0) + G.label.h + G.row.gapAfterLabel);
  if (o.rows[1]) near(`${col.name} 옵션 행 간격`, o.rows[1].y - o.rows[0].y, G.row.pitch);
  near(`${col.name} 아바타 x`, o.rowAvatar?.x, G.row.avatarX);
  near(`${col.name} 아바타 크기`, o.rowAvatar?.w, G.row.avatarSize);
  near(`${col.name} 이름 x`, o.rowName?.x, G.row.nameX);
  eq(`${col.name} 이름 크기`, o.rowName?.fs, G.row.nameFs);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

await browser.close();

if (diffs.length) {
  console.error(`\n  ┌─ 사람 피커가 원본과 다릅니다 (${diffs.length}건) ──────────────`);
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-person-picker.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`사람 피커 원본과 일치 — ${COLUMNS.map((c) => c.name).join(" · ")} (박스/바/선택항목/라벨/행)`);
