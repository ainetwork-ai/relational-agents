// 제목 셀에 호버하면 나오는 `열기` 버튼을 원본 수치와 대조한다.
// 기준: fixtures/notion-title-cell.json (원본은 흰 55×24 패드 안에 51×20 버튼).
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] [TITLE_PROP=…] node e2e/title-open.check.mjs
//
// 읽기 전용: 호버만 한다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const TITLE = process.env.TITLE_PROP ?? "3c55e8de-8e4b-4257-8321-3467eeb8ff6a";

const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-title-cell.json", import.meta.url), "utf8")).openButton;
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 870 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-cellnav]", { timeout: 120_000 });
await page.waitForTimeout(1200);

const sel = `[data-testid^='db-cell-'][data-testid$='-${TITLE}']`;
await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center", inline: "start" }), sel);
await page.waitForTimeout(500);
const cr = await page.locator(sel).first().evaluate((c) => {
  const e = c.closest("[data-cellnav]") ?? c;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
await page.mouse.move(cr.x + 120, cr.y + 18);
await page.waitForTimeout(400);

const m = await page.evaluate((c) => {
  const btn = document.querySelector("[data-testid^='db-title-open-']");
  if (!btn) return null;
  const pad = btn.parentElement;
  const read = (e) => { const b = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { h: Math.round(b.height), radius: s.borderRadius, bg: s.backgroundColor, padding: s.padding, gap: s.gap, fs: s.fontSize, fw: s.fontWeight, color: s.color, shadow: s.boxShadow, opacity: Number(s.opacity), pe: s.pointerEvents }; };
  const svg = btn.querySelector("svg");
  return { pad: { ...read(pad), rightInset: Math.round(c.x + c.w - pad.getBoundingClientRect().right) },
    inner: read(btn), icon: svg ? { size: Math.round(svg.getBoundingClientRect().width), color: getComputedStyle(svg).color } : null,
    label: btn.textContent.trim(), aria: btn.getAttribute("aria-label") };
}, cr);
await browser.close();

const d = [];
const eq = (w, got, want) => { if (String(got) !== String(want)) d.push(`${w}: 우리 ${got} / 노션 ${want}`); };
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) d.push(`${w}: 우리 ${got} / 노션 ${want}`); };

if (!m) d.push("호버해도 열기 버튼이 없습니다");
else {
  if (m.pad.opacity < 0.9) d.push(`호버했는데 열기가 안 보입니다 (opacity ${m.pad.opacity})`);
  near("패드 높이", m.pad.h, G.pad.h);
  eq("패드 radius", m.pad.radius, G.pad.radius);
  eq("패드 배경", m.pad.bg, G.pad.bg);
  eq("패드 padding", m.pad.padding, G.pad.padding);
  eq("패드 그림자", m.pad.shadow, G.pad.shadow);
  near("오른쪽 여백", m.pad.rightInset, G.pad.rightInset);
  near("버튼 높이", m.inner.h, G.inner.h);
  eq("버튼 radius", m.inner.radius, G.inner.radius);
  eq("버튼 padding", m.inner.padding, G.inner.padding);
  eq("버튼 gap", m.inner.gap, G.inner.gap);
  eq("라벨 크기", m.inner.fs, G.inner.fs);
  eq("라벨 굵기", m.inner.fw, G.inner.fw);
  eq("라벨 색", m.inner.color, G.inner.color);
  near("아이콘 크기", m.icon?.size, G.icon.size);
  eq("아이콘 색", m.icon?.color, G.icon.color);
  eq("라벨", m.label, G.label);
  eq("aria-label", m.aria, G.ariaLabel);
}

if (d.length) {
  console.error(`\n  ┌─ 제목 셀의 열기 버튼이 원본과 다릅니다 (${d.length}건) ────────`);
  for (const x of d) console.error(`  │ ${x}`);
  console.error("  │\n  │ 기준: e2e/fixtures/notion-title-cell.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("제목 셀의 열기 버튼 원본과 일치 — 흰 패드 24 + 버튼 20, 12px/500, 아이콘 15");
