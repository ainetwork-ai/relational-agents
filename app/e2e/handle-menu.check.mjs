// The ⠿ handle menu's 전환 (Turn into) — measured on Notion 2026-09-09:
//   • on a text block the ⠿ menu lists 전환 first; HOVERING it opens a panel to
//     the right (menu.right − 4px, 220 wide, 28px rows) with 텍스트 · 제목1… ;
//     clicking a type converts the block
//   • on an EMPTY line the ⠿ click opens the block-type picker straight away
// Ours had the panel inside the scrolling menu → clipped → "does nothing".
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/handle-menu.check.mjs
// Converts one block and undoes it (dev data, restored by ⌘Z).
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER = "30790fd0-9bdb-4c6c-abb8-3903fff5fd6d";
const COMCOM = "2c88615f-4a30-43f8-9608-6ac977919dc0";
const PAGE = process.env.PAGE_ID ?? "fa2188f1-ed08-414e-ab6c-345e5cf6a57f";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: await sealData({ userId: USER, activeWorkspaceId: COMCOM }, { password: secret, ttl: 0 }), url: BASE }]);
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/p/${PAGE}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 20000 });
await page.waitForTimeout(1200);
const geo = await page.evaluate(() => [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')].map((b) => { const r = b.getBoundingClientRect(); const ce = b.querySelector("[contenteditable]"); const own = ce && ce.closest("[data-block-type]") === b; return { id: b.getAttribute("data-testid").slice(6), type: b.getAttribute("data-block-type"), top: Math.round(r.top + scrollY), h: Math.round(r.height), text: own ? (ce.innerText || "").trim() : null }; }));
const para = geo.find((g) => g.type === "paragraph" && g.text && g.text.length > 8 && g.h < 60);
const empty = geo.find((g) => g.type === "paragraph" && g.text === "");
check("0. fixture: a text paragraph and an empty paragraph on the page", !!para && !!empty, `para=${para?.id.slice(0, 8)} empty=${empty?.id.slice(0, 8)}`);
if (!para || !empty) { await browser.close(); process.exit(1); }
const show = async (id) => { await page.evaluate((id) => { const b = document.querySelector(`[data-testid="block-${id}"]`); document.querySelector("main").scrollTop += b.getBoundingClientRect().top - 300; }, id); await page.waitForTimeout(250); const r = await page.evaluate((id) => { const b = document.querySelector(`[data-testid="block-${id}"]`); const ce = b.querySelector("[contenteditable]") || b; const cr = ce.getBoundingClientRect(); return { x: cr.left + 30, y: cr.top + cr.height / 2 }; }, id); await page.mouse.move(r.x, r.y); await page.waitForTimeout(200); return r; };

// 1. text block: ⠿ → menu → hover 전환 → panel → click 제목1 → heading1 → ⌘Z
{ await show(para.id);
  const handle = page.locator(`[data-testid="block-handle-${para.id}"]`);
  await handle.click(); await page.waitForTimeout(300);
  const turn = page.locator(`[data-testid="block-turninto-${para.id}"]`);
  check("1a. ⠿ click opens the actions menu with 전환", await turn.isVisible());
  const tb = await turn.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.waitForTimeout(350);
  const panel = page.locator(`[data-testid="block-turninto-menu-${para.id}"]`);
  const pv = await panel.isVisible();
  check("1b. hovering 전환 opens the type panel", pv);
  if (pv) {
    const pb = await panel.boundingBox(); const mb = await page.locator(`[data-testid="block-turninto-${para.id}"]`).evaluate((el) => { const m = el.closest(".popover-anim"); const r = m.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top }; });
    check("1c. panel sits beside the menu (left ≈ menu.right − 4), top on the 전환 row, fully inside the window", Math.abs(pb.x - (mb.right - 4)) < 2 && Math.abs(pb.y - tb.y) < 2 && pb.x + pb.width <= 1400 && pb.y + pb.height <= 900, `panel x=${pb.x} menu.right=${mb.right} panel.y=${pb.y} row.y=${tb.y} h=${pb.height}`);
    const first = await panel.locator("button").first().innerText();
    const rowH = await panel.locator("button").first().evaluate((b) => b.getBoundingClientRect().height);
    check("1d. panel lists the original's order, starting 텍스트 / 제목1, rows 28px", /텍스트|Text/.test(first) && rowH === 28, `first="${first}" rowH=${rowH}`);
    await page.locator(`[data-testid="block-turninto-${para.id}-heading1"]`).click(); await page.waitForTimeout(400);
    const type = await page.evaluate((id) => document.querySelector(`[data-testid="block-${id}"]`)?.getAttribute("data-block-type"), para.id);
    check("1e. clicking 제목1 turns the block into heading1 and closes the menus", type === "heading1" && !(await turn.isVisible()) && !(await panel.isVisible()), `type=${type}`);
    await page.keyboard.press("Control+z"); await page.waitForTimeout(500);
    const back = await page.evaluate((id) => document.querySelector(`[data-testid="block-${id}"]`)?.getAttribute("data-block-type"), para.id);
    check("1f. ⌘Z restores the paragraph", back === "paragraph", `type=${back}`);
  }
  await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
// 2. empty line: ⠿ click → type picker with the filter placeholder, no actions menu
{ await show(empty.id);
  await page.locator(`[data-testid="block-handle-${empty.id}"]`).click(); await page.waitForTimeout(400);
  const menuOpen = await page.locator(`[data-testid="block-turninto-${empty.id}"]`).isVisible().catch(() => false);
  const picker = await page.evaluate((id) => { const ce = document.querySelector(`[data-testid="block-${id}"] [contenteditable]`); return { placeholder: ce?.getAttribute("placeholder") ?? ce?.dataset.placeholder ?? null, focused: document.activeElement === ce, pickerItems: document.querySelectorAll('[data-testid="slash-menu"] [data-testid^="slash-menu-item-"]').length, pickerOpen: !!document.querySelector('[data-testid="slash-menu"]') }; }, empty.id);
  check("2a. on an empty line ⠿ opens the type picker, not the actions menu", !menuOpen && picker.pickerItems > 0, JSON.stringify(picker));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
check("Z. no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
