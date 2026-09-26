// Compares the menu that opens on clicking a pinned property's label, and the Edit property popover inside it,
// against the original's measurements. Original: src/i18n/content/e2e-fixtures/notion-row-props-band.json §labelMenu / §editPopover
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/prop-label-menu.check.mjs

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-row-props-band.json", import.meta.url), "utf8"));
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
ok((await label.evaluate((e) => e.tagName)) === "BUTTON", "the label is a clickable button");
ok((await label.getAttribute("aria-haspopup")) === "dialog", "aria-haspopup=dialog");

// ── menu ──
console.log("\n— label menu —");
await label.click();
const menu = page.locator("[data-testid='db-prop-label-menu']");
await menu.waitFor({ timeout: 5000 });
await page.waitForTimeout(250);
ok((await label.getAttribute("aria-expanded")) === "true", "the label stays pressed while open");
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
ok(near(m.x, lab.x, 1), `aligned to the label's left (menu x ${m.x} vs label ${lab.x.toFixed(1)})`);
ok(near(m.y - (lab.y + lab.height), M.gapBelowLabel, 1), `below the label ${(m.y - lab.y - lab.height).toFixed(1)}px (original ${M.gapBelowLabel})`);
ok(near(m.w, M.width, 1), `menu width ${m.w} (original ${M.width})`);
ok(near(m.radius, M.radius, 0.5), `radius ${m.radius} (original ${M.radius})`);
ok(near(m.h, M.height, 1), `menu height ${m.h} (original ${M.height})`);
ok(m.items.length === M.items.length, `${m.items.length} items: ${m.items.map((i) => i.text).join(" · ")}`);
ok(JSON.stringify(m.items.map((i) => i.text)) === JSON.stringify(M.items), `item wording and order match the original`);
for (const it of m.items) {
  ok(near(it.h, M.itemHeight, 0.5), `${it.text}: height ${it.h} (original ${M.itemHeight})`);
  ok(near(it.w, M.itemWidth, 1), `${it.text}: width ${it.w} (original ${M.itemWidth})`);
  ok(near(it.radius, M.itemRadius, 0.5), `${it.text}: radius ${it.radius}`);
  ok(near(it.fs, M.fontSize, 0.5), `${it.text}: text ${it.fs}`);
  ok(near(it.iconW, M.iconSize, 1), `${it.text}: icon ${it.iconW} (original ${M.iconSize})`);
  ok(near(it.iconX, M.iconX, 1), `${it.text}: icon x${it.iconX} (original ${M.iconX})`);
  ok(near(it.textX, M.textX, 1.5), `${it.text}: text x${it.textX} (original ${M.textX})`);
}
for (let i = 1; i < m.items.length; i++) {
  const gap = m.items[i].y - (m.items[i - 1].y + m.items[i - 1].h);
  const sep = m.seps.find((s) => s.y > m.items[i - 1].y && s.y < m.items[i].y);
  ok(near(gap, sep ? M.gapAcrossSeparator : M.itemGap, 1),
    `${m.items[i - 1].text}→${m.items[i].text}: ${gap.toFixed(1)}px (original ${sep ? M.gapAcrossSeparator : M.itemGap}${sep ? ", separator" : ""})`);
}
ok(m.seps.length === M.separatorsAfter.length, `${m.seps.length} separators (original ${M.separatorsAfter.length})`);
for (const s of m.seps) ok(near(s.h, 1, 0.5) && s.bg === M.separatorColor, `separator 1px ${s.bg}`);

// ── edit popover ──
console.log("\n— Edit property popover —");
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
ok(near(p.w, E.width, 1), `popover width ${p.w} (original ${E.width})`);
ok(near(p.radius, E.radius, 0.5), `radius ${p.radius}`);
ok(near(p.h, E.height, 1), `popover height ${p.h} (original ${E.height})`);
ok(p.input?.focused === true, "focus in the name input");
ok(near(p.input?.h, E.nameField.height, 1), `name input height ${p.input?.h} (original ${E.nameField.height})`);
ok(near(p.input?.fs, E.nameField.fontSize, 0.5), `name text ${p.input?.fs}`);
ok(JSON.stringify(p.rows.map((r) => r.text.split(" ")[0])) === JSON.stringify(E.rows.map((r) => r.split(" ")[0])),
  `row wording and order: ${p.rows.map((r) => r.text).join(" · ")}`);
for (const [i, r] of p.rows.entries()) {
  ok(near(r.h, E.rowHeight, 0.5), `${r.text}: height ${r.h} (original ${E.rowHeight})`);
  ok(near(r.w, E.rowWidth, 1), `${r.text}: width ${r.w} (original ${E.rowWidth})`);
  ok(near(r.x, E.rowX, 1), `${r.text}: x${r.x} (original ${E.rowX})`);
  ok(near(r.y, E.rowY[i], 1.5), `${r.text}: y${r.y} (original ${E.rowY[i]})`);
}

// ── Escape ──
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok((await page.locator("[data-testid='db-prop-edit-popover']").count()) === 0, "closed by Escape");

// ── Customize layout ──
console.log("\n— Customize layout —");
await label.click();
await menu.waitFor({ timeout: 5000 });
await page.locator("[data-testid='db-prop-menu-layout']").click();
await page.waitForSelector("[data-testid='db-peek-layout-menu']", { timeout: 5000 });
const pins = await page.$$eval("[data-testid='db-peek-layout-menu'] [data-testid^='db-peek-pin-']", (els) =>
  els.filter((e) => !/-up-|-down-/.test(e.getAttribute("data-testid"))).map((e) => e.textContent.trim()));
ok(pins.length > 0, `${pins.length} properties listed (${pins.slice(0, 4).join(", ")}…)`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok((await page.locator("[data-testid='db-peek-layout-menu']").count()) === 0, "closed by Escape");

// ── the label menu in the property panel is a different list ──
console.log("\n— label menu in the property panel —");
{
  const P = G.panelLabelMenu;
  await page.locator("[data-testid='db-row-peek'] [data-testid='row-props-toggle']").click();
  await page.waitForSelector("[data-testid='db-peek-details']", { timeout: 8000 });
  await page.waitForTimeout(600);
  const plabel = page.locator("[data-testid='db-peek-details'] [data-role='label']").first();
  const pbox = await plabel.boundingBox();
  await plabel.click();
  const pmenu = page.locator("[data-testid='db-prop-label-menu']");
  await pmenu.waitFor({ timeout: 5000 });
  await page.waitForTimeout(250);
  const pm = await pmenu.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      items: [...el.querySelectorAll("[role='menuitem']")].map((it) => ({ text: it.innerText.trim(), y: +(it.getBoundingClientRect().top - r.top).toFixed(1) })) };
  });
  ok(near(pm.x, pbox.x, 1), `panel: aligned to the label's left (${pm.x} vs ${pbox.x.toFixed(1)})`);
  ok(near(pm.y - (pbox.y + pbox.height), 1, 1), `panel: below the label ${(pm.y - pbox.y - pbox.height).toFixed(1)}px`);
  ok(near(pm.w, P.width, 1), `panel menu width ${pm.w} (original ${P.width})`);
  ok(near(pm.h, P.height, 1), `panel menu height ${pm.h} (original ${P.height})`);
  ok(JSON.stringify(pm.items.map((i) => i.text)) === JSON.stringify(P.items),
    `panel items: ${pm.items.map((i) => i.text).join(" · ")}`);
  for (const [i, it] of pm.items.entries())
    ok(near(it.y, P.itemY[i], 1), `panel ${it.text}: y${it.y} (original ${P.itemY[i]})`);

  // Property visibility → submenu
  const S = P.visibilitySubmenu;
  await page.locator("[data-testid='db-prop-menu-visibility']").hover();
  const sub = page.locator("[data-testid='db-prop-visibility-menu']");
  await sub.waitFor({ timeout: 5000 });
  await page.waitForTimeout(250);
  const sm = await sub.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), radius: parseFloat(getComputedStyle(el).borderRadius),
      items: [...el.querySelectorAll("[role='menuitem']")].map((it) => ({ text: it.innerText.trim(), y: +(it.getBoundingClientRect().top - r.top).toFixed(1),
        h: +it.getBoundingClientRect().height.toFixed(1), w: +it.getBoundingClientRect().width.toFixed(1), checked: !!it.querySelector("svg") })) };
  });
  ok(near(sm.w, S.width, 1), `submenu width ${sm.w} (original ${S.width})`);
  ok(near(sm.h, S.height, 1), `submenu height ${sm.h} (original ${S.height})`);
  ok(JSON.stringify(sm.items.map((i) => i.text)) === JSON.stringify(S.items), `submenu items: ${sm.items.map((i) => i.text).join(" · ")}`);
  for (const [i, it] of sm.items.entries()) {
    ok(near(it.y, S.itemY[i], 1), `${it.text}: y${it.y} (original ${S.itemY[i]})`);
    ok(near(it.w, S.itemWidth, 1), `${it.text}: width ${it.w} (original ${S.itemWidth})`);
  }
  ok(sm.items[0].checked && !sm.items[1].checked && !sm.items[2].checked, `default '${S.current}' is checked`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

// ── a long list does not break out of the screen (with a shorter window) ──
console.log("\n— fit to screen —");
for (const h of [700, 520]) {
  await page.setViewportSize({ width: 1400, height: h });
  await page.waitForTimeout(500);
  await page.locator("[data-testid='db-row-peek'] [data-role='label']").first().click();
  await page.waitForSelector("[data-testid='db-prop-label-menu']", { timeout: 5000 });
  await page.locator("[data-testid='db-prop-menu-layout']").click();
  await page.waitForSelector("[data-testid='db-peek-layout-menu']", { timeout: 5000 });
  await page.waitForTimeout(300);
  const box = await page.evaluate((vh) => {
    const el = document.querySelector("[data-testid='db-peek-layout-menu']");
    const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), scrollH: el.scrollHeight, clientH: el.clientHeight, vh };
  }, h);
  ok(box.top >= 0 && box.bottom <= h, `window height ${h}: box ${box.top}..${box.bottom} is on screen`);
  ok(box.scrollH > box.clientH ? true : box.scrollH === box.clientH, `window height ${h}: scrolls inside on overflow (content ${box.scrollH} / visible ${box.clientH})`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
}
await page.setViewportSize({ width: 1400, height: 950 });

await browser.close();
if (fails.length) { console.error(`\n${fails.length} failed`); process.exit(1); }
console.log("\nno difference from the original — exit 0");
