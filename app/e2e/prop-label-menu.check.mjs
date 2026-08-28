// 고정 속성의 라벨을 눌렀을 때 나오는 메뉴와, 그 안의 속성 편집 팝오버를 원본 실측과 대조한다.
// 원본: fixtures/notion-row-props-band.json §labelMenu / §editPopover
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/prop-label-menu.check.mjs

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-row-props-band.json", import.meta.url), "utf8"));
const M = G.labelMenu, E = G.editPopover;

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const fails = [];
const ok = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fails.push(label); };
const near = (a, b, tol = 1) => a != null && b != null && Math.abs(a - b) <= tol;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
const rowId = (await page.$$eval("[data-testid^='db-row-']", (els) =>
  els.map((e) => e.getAttribute("data-testid").replace("db-row-", "")).filter((id) => id && !/^drag-|^check-|^expand-/.test(id))))[0];
await page.locator(`[data-testid='db-row-${rowId}']`).first().hover();
await page.locator(`[data-testid='db-title-open-${rowId}']`).first().click();
await page.waitForSelector("[data-testid='db-row-peek'] [data-pinned-row]", { timeout: 20_000 });
await page.waitForTimeout(800);

const label = page.locator("[data-testid='db-row-peek'] [data-testid^='row-props-item-'] [data-role='label']").first();
const lab = await label.boundingBox();
ok((await label.evaluate((e) => e.tagName)) === "BUTTON", "라벨이 눌리는 버튼이다");
ok((await label.getAttribute("aria-haspopup")) === "dialog", "aria-haspopup=dialog");

// ── 메뉴 ──
console.log("\n— 라벨 메뉴 —");
await label.click();
const menu = page.locator("[data-testid='db-prop-label-menu']");
await menu.waitFor({ timeout: 5000 });
await page.waitForTimeout(250);
ok((await label.getAttribute("aria-expanded")) === "true", "열려 있는 동안 라벨이 눌린 상태");
const m = await menu.evaluate((el) => {
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  const items = [...el.querySelectorAll("[role='menuitem']")].map((it) => {
    const ir = it.getBoundingClientRect(); const is = getComputedStyle(it);
    const icon = it.querySelector("span"); const ico = icon && icon.getBoundingClientRect();
    const txt = it.querySelectorAll("span")[1]; const tr = txt && txt.getBoundingClientRect();
    return { text: it.innerText.trim(), y: +(ir.top - r.top).toFixed(1), h: +ir.height.toFixed(1), w: +ir.width.toFixed(1),
      radius: parseFloat(is.borderRadius), fs: parseFloat(is.fontSize), color: is.color, disabled: it.disabled,
      iconW: ico && +ico.width.toFixed(1), iconX: ico && +(ico.left - ir.left).toFixed(1), textX: tr && +(tr.left - ir.left).toFixed(1) };
  });
  const seps = [...el.querySelectorAll("[data-role='menu-separator']")].map((d) => ({
    y: +(d.getBoundingClientRect().top - r.top).toFixed(1), h: +d.getBoundingClientRect().height.toFixed(1), bg: getComputedStyle(d).backgroundColor }));
  return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    radius: parseFloat(s.borderRadius), shadow: s.boxShadow, items, seps };
});
ok(near(m.x, lab.x, 1), `라벨 왼쪽에 맞춤 (메뉴 x ${m.x} vs 라벨 ${lab.x.toFixed(1)})`);
ok(near(m.y - (lab.y + lab.height), M.gapBelowLabel, 1), `라벨 아래 ${(m.y - lab.y - lab.height).toFixed(1)}px (원본 ${M.gapBelowLabel})`);
ok(near(m.w, M.width, 1), `메뉴 폭 ${m.w} (원본 ${M.width})`);
ok(near(m.radius, M.radius, 0.5), `radius ${m.radius} (원본 ${M.radius})`);
ok(near(m.h, M.height, 1), `메뉴 높이 ${m.h} (원본 ${M.height})`);
ok(m.items.length === M.items.length, `항목 ${m.items.length}개: ${m.items.map((i) => i.text).join(" · ")}`);
ok(JSON.stringify(m.items.map((i) => i.text)) === JSON.stringify(M.items), `항목 문구와 순서가 원본과 같음`);
for (const it of m.items) {
  ok(near(it.h, M.itemHeight, 0.5), `${it.text}: 높이 ${it.h} (원본 ${M.itemHeight})`);
  ok(near(it.w, M.itemWidth, 1), `${it.text}: 폭 ${it.w} (원본 ${M.itemWidth})`);
  ok(near(it.radius, M.itemRadius, 0.5), `${it.text}: radius ${it.radius}`);
  ok(near(it.fs, M.fontSize, 0.5), `${it.text}: 글자 ${it.fs}`);
  ok(near(it.iconW, M.iconSize, 1), `${it.text}: 아이콘 ${it.iconW} (원본 ${M.iconSize})`);
  ok(near(it.iconX, M.iconX, 1), `${it.text}: 아이콘 x${it.iconX} (원본 ${M.iconX})`);
  ok(near(it.textX, M.textX, 1.5), `${it.text}: 글자 x${it.textX} (원본 ${M.textX})`);
}
for (let i = 1; i < m.items.length; i++) {
  const gap = m.items[i].y - (m.items[i - 1].y + m.items[i - 1].h);
  const sep = m.seps.find((s) => s.y > m.items[i - 1].y && s.y < m.items[i].y);
  ok(near(gap, sep ? M.gapAcrossSeparator : M.itemGap, 1),
    `${m.items[i - 1].text}→${m.items[i].text}: ${gap.toFixed(1)}px (원본 ${sep ? M.gapAcrossSeparator : M.itemGap}${sep ? ", 구분선" : ""})`);
}
ok(m.seps.length === M.separatorsAfter.length, `구분선 ${m.seps.length}개 (원본 ${M.separatorsAfter.length})`);
for (const s of m.seps) ok(near(s.h, 1, 0.5) && s.bg === M.separatorColor, `구분선 1px ${s.bg}`);

// ── 편집 팝오버 ──
console.log("\n— 속성 편집 팝오버 —");
await page.locator("[data-testid='db-prop-menu-edit']").click();
const pop = page.locator("[data-testid='db-prop-edit-popover']");
await pop.waitFor({ timeout: 5000 });
await page.waitForTimeout(250);
const p = await pop.evaluate((el) => {
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  const input = el.querySelector("input"); const ir = input && input.getBoundingClientRect();
  const rows = [...el.querySelectorAll("[role='menuitem']")].map((it) => {
    const rr = it.getBoundingClientRect();
    return { text: it.innerText.trim().replace(/\n/g, " "), y: +(rr.top - r.top).toFixed(1), h: +rr.height.toFixed(1), w: +rr.width.toFixed(1), x: +(rr.left - r.left).toFixed(1), disabled: it.disabled };
  });
  return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), radius: parseFloat(s.borderRadius), shadow: s.boxShadow,
    input: input && { x: +(ir.left - r.left).toFixed(1), h: +ir.height.toFixed(1), fs: parseFloat(getComputedStyle(input).fontSize), value: input.value, focused: input === document.activeElement },
    rows };
});
ok(near(p.w, E.width, 1), `팝오버 폭 ${p.w} (원본 ${E.width})`);
ok(near(p.radius, E.radius, 0.5), `radius ${p.radius}`);
ok(near(p.h, E.height, 1), `팝오버 높이 ${p.h} (원본 ${E.height})`);
ok(p.input?.focused === true, "이름 입력에 포커스");
ok(near(p.input?.h, E.nameField.height, 1), `이름 입력 높이 ${p.input?.h} (원본 ${E.nameField.height})`);
ok(near(p.input?.fs, E.nameField.fontSize, 0.5), `이름 글자 ${p.input?.fs}`);
ok(JSON.stringify(p.rows.map((r) => r.text.split(" ")[0])) === JSON.stringify(E.rows.map((r) => r.split(" ")[0])),
  `줄 문구와 순서: ${p.rows.map((r) => r.text).join(" · ")}`);
for (const [i, r] of p.rows.entries()) {
  ok(near(r.h, E.rowHeight, 0.5), `${r.text}: 높이 ${r.h} (원본 ${E.rowHeight})`);
  ok(near(r.w, E.rowWidth, 1), `${r.text}: 폭 ${r.w} (원본 ${E.rowWidth})`);
  ok(near(r.x, E.rowX, 1), `${r.text}: x${r.x} (원본 ${E.rowX})`);
  ok(near(r.y, E.rowY[i], 1.5), `${r.text}: y${r.y} (원본 ${E.rowY[i]})`);
}

// ── Escape ──
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok((await page.locator("[data-testid='db-prop-edit-popover']").count()) === 0, "Escape 로 닫힘");

// ── 레이아웃 사용자 지정 ──
console.log("\n— 레이아웃 사용자 지정 —");
await label.click();
await menu.waitFor({ timeout: 5000 });
await page.locator("[data-testid='db-prop-menu-layout']").click();
await page.waitForSelector("[data-testid='db-peek-layout-menu']", { timeout: 5000 });
const pins = await page.$$eval("[data-testid='db-peek-layout-menu'] [data-testid^='db-peek-pin-']", (els) =>
  els.filter((e) => !/-up-|-down-/.test(e.getAttribute("data-testid"))).map((e) => e.textContent.trim()));
ok(pins.length > 0, `속성 목록 ${pins.length}개 (${pins.slice(0, 4).join(", ")}…)`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok((await page.locator("[data-testid='db-peek-layout-menu']").count()) === 0, "Escape 로 닫힘");

await browser.close();
if (fails.length) { console.error(`\n${fails.length}개 실패`); process.exit(1); }
console.log("\n원본과 차이 없음 — exit 0");
