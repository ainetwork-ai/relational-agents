// Gutter + click: on a line with content it makes an empty line below, on an empty line it opens the type menu
// on that line — without a "/" character, caret at the start, a faint pill background on the filter placeholder. Compares
// the menu dimensions and line-relative position with the original (src/i18n/content/e2e-fixtures/notion-plus-menu.json). Creates its own page.
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/plus-menu.check.mjs
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko, content } from "./i18n.mjs";
const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-plus-menu.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };
const C = content.PLUS_MENU;
const created = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "plus-menu.check" }) }).then((r) => r.json());
const pageId = created.page?.id ?? created.id;
const A = { id: crypto.randomUUID(), type: "paragraph", content: { text: C.contentText }, parentBlockId: null, position: 1 };
const B = { id: crypto.randomUUID(), type: "paragraph", content: { text: "" }, parentBlockId: null, position: 2 };
await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({ blocks: [A, B], deletedIds: [], newIds: [A.id, B.id] }) });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(`[data-testid="block-${A.id}"]`, { timeout: 60_000 }); await page.waitForTimeout(300);
const fails = []; let checks = 0;
const eq = (label, got, want, tol = 0.5) => { checks++; const ok = typeof want === "number" ? Math.abs(got - want) <= tol : got === want; if (!ok) fails.push(`${label}: ${got} ≠ ${want}`); };
const read = () => page.evaluate((closeMenu) => { const f = (v) => +v.toFixed(1); const rows = [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')]; const sel0 = window.getSelection(); const row = rows.find((r) => sel0?.anchorNode && r.contains(sel0.anchorNode)) ?? null; const ed = row?.querySelector('[data-testid^="block-editable-"]') ?? null; const cr = row?.getBoundingClientRect(); const b4 = ed && getComputedStyle(ed, "::before"); const sel = window.getSelection(); const menu = document.querySelector('[data-testid="slash-menu"]'); const mr = menu?.getBoundingClientRect(); const item = menu?.querySelector("button"); const footer = menu && [...menu.querySelectorAll("div")].find((d) => d.textContent.includes(closeMenu) && d.children.length === 2); return { blocks: rows.length, focusedRowIdx: row ? rows.indexOf(row) : -1, text: ed?.innerText ?? null, caret: sel?.anchorOffset ?? null, placeholder: ed?.getAttribute("data-placeholder"), pillBg: b4?.backgroundColor, menu: mr && { w: f(mr.width), h: f(mr.height), left: f(mr.left - cr.left), gap: f(mr.top - cr.bottom), radius: getComputedStyle(menu).borderRadius, listMaxH: getComputedStyle(menu.firstElementChild).maxHeight, itemH: f(item.getBoundingClientRect().height), footerH: footer && f(footer.getBoundingClientRect().height) } }; }, ko("Close menu"));
const before = await page.evaluate(() => document.querySelectorAll('[data-testid="editor-root"] [data-block-type]').length);
for (const [label, id, expectNew] of [["content line", A.id, true], ["empty line", B.id, false]]) {
  await page.locator(`[data-testid="block-${id}"]`).hover({ position: { x: 80, y: 6 } }); await page.waitForTimeout(150);
  await page.locator(`[data-testid="block-add-below-${id}"]`).click(); await page.waitForTimeout(400);
  const s = await read();
  eq(`${label}: line added`, s.blocks - before - (label === "empty line" ? 1 : 0), expectNew ? 1 : 0);
  eq(`${label}: line text`, s.text, "");
  eq(`${label}: caret position`, s.caret, G.behaviour.caretOffset);
  eq(`${label}: placeholder`, s.placeholder, G.placeholder.text);
  eq(`${label}: placeholder pill`, s.pillBg, G.placeholder.pillBg);
  if (!s.menu) fails.push(`${label}: menu did not open`);
  else { eq(`${label}: menu width`, s.menu.w, G.menu.w); eq(`${label}: menu height`, s.menu.h, G.menu.h); eq(`${label}: menu left`, s.menu.left, G.menu.leftFromBlock); eq(`${label}: gap from line`, s.menu.gap, G.menu.gap); eq(`${label}: radius`, s.menu.radius, G.menu.radius); eq(`${label}: list max-h`, s.menu.listMaxH, G.menu.listMaxH); eq(`${label}: item height`, s.menu.itemH, G.menu.itemH); eq(`${label}: footer height`, s.menu.footerH, G.menu.footerH); }
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
}
// click on the same line: in the original the menu closes and the line returns to the default text (measured 2026-08-26)
await page.locator(`[data-testid="block-add-below-${B.id}"]`).click({ force: true }); await page.waitForTimeout(300);
await page.locator(`[data-testid="block-${B.id}"] [data-testid^="block-editable-"]`).click({ position: { x: 5, y: 10 } }); await page.waitForTimeout(250);
eq("same-line click: menu closed", await page.locator('[data-testid="slash-menu"]').count(), 0);
eq("same-line click: default text restored", await page.locator(`[data-testid="block-${B.id}"] [data-testid^="block-editable-"]`).getAttribute("data-placeholder"), G.placeholder.defaultText);
// click outside: in the original the menu closes and the line stays
await page.locator(`[data-testid="block-add-below-${B.id}"]`).click({ force: true }); await page.waitForTimeout(300);
await page.locator(`[data-testid="block-${A.id}"] [data-testid^="block-editable-"]`).click({ position: { x: 5, y: 10 } }); await page.waitForTimeout(250);
eq("outside click: menu closed", await page.locator('[data-testid="slash-menu"]').count(), 0);
eq("outside click: line kept", await page.evaluate(() => document.querySelectorAll('[data-testid="editor-root"] [data-block-type]').length), before + 1);
await browser.close();
await fetch(`${BASE}/api/pages/${pageId}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});
if (fails.length) { console.log(`  ┌─ + menu differs from the original (${fails.length}/${checks}) ─────`); for (const f of fails) console.log(`  │ ${f}`); console.log("  └────────────────────────────────────────────────"); process.exit(1); }
console.log(`+ menu matches the original — ${checks} checks (content line/empty line)`);
