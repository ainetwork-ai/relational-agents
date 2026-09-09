// OUR editor: what clears a block selection / a cross-block text selection —
// the same matrix measured on Notion (docs/notion-selection-copy.md §5).
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/deselect.measure.mjs
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER = "30790fd0-9bdb-4c6c-abb8-3903fff5fd6d";
const COMCOM = "2c88615f-4a30-43f8-9608-6ac977919dc0";
const PAGE = process.env.PAGE_ID ?? "fa2188f1-ed08-414e-ab6c-345e5cf6a57f";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: await sealData({ userId: USER, activeWorkspaceId: COMCOM }, { password: secret, ttl: 0 }), url: BASE }]);
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/p/${PAGE}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 20000 });
await page.waitForTimeout(1200);
const state = () => page.evaluate(() => {
  const sel = window.getSelection();
  const rows = [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')];
  const halos = rows.filter((r) => r.querySelector(":scope > div > [data-selected]")).map((r) => r.getAttribute("data-testid").slice(6, 14));
  const blk = (n) => n ? ((n.nodeType === 3 ? n.parentElement : n)).closest?.("[data-block-type]")?.getAttribute("data-testid")?.slice(6, 14) ?? null : null;
  const ae = document.activeElement;
  return { halos, collapsed: sel.rangeCount ? sel.isCollapsed : null, selLen: sel.toString().length, caretBlock: sel.rangeCount && sel.isCollapsed ? blk(sel.anchorNode) : null, anchorBlock: blk(sel.anchorNode), focusBlock: blk(sel.focusNode), active: ae?.tagName, activeEditable: !!ae?.isContentEditable, activeBlock: ae ? blk(ae) : null };
});
const geo = await page.evaluate(() => [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')].map((b) => { const r = b.getBoundingClientRect(); const ce = b.querySelector("[contenteditable]"); return { id: b.getAttribute("data-testid").slice(6), type: b.getAttribute("data-block-type"), top: Math.round(r.top + scrollY), h: Math.round(r.height), text: (ce?.innerText || "").trim().slice(0, 30), hasCe: !!ce }; }));
const texty = geo.filter((g) => g.hasCe && g.text.length > 8 && g.h < 60 && ["paragraph", "bulleted_list", "numbered_list"].includes(g.type));
let ti = -1; for (let i = 0; i + 3 < texty.length; i++) { const a = texty[i], b = texty[i + 1], d = texty[i + 2], e = texty[i + 3]; if (b.top - a.top < 90 && d.top - b.top < 90 && e.top - d.top < 90 && b.top > a.top && d.top > b.top && e.top > d.top) { ti = i; break; } }
const trio = [texty[ti], texty[ti + 1], texty[ti + 2]], after = texty[ti + 3];
console.log("trio", trio.map((t) => t.id.slice(0, 8)), "after", after.id.slice(0, 8));
const rect = (id) => page.evaluate((id) => { const b = document.querySelector(`[data-testid="block-${id}"]`); const r = b.getBoundingClientRect(); const ce = b.querySelector("[contenteditable]") || b; const cr = ce.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(ce); const tr = rg.getBoundingClientRect(); return { x: cr.left, y: cr.top, w: cr.width, h: cr.height, bx: r.left, by: r.top, bw: r.width, bh: r.height, textRight: tr.right }; }, id);
await page.evaluate((y) => document.querySelector("main")?.scrollTo(0, y - 300), trio[0].top); await page.waitForTimeout(300);
const drag = async (x1, y1, x2, y2, steps = 8) => { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await page.waitForTimeout(15); } await page.waitForTimeout(80); await page.mouse.up(); await page.waitForTimeout(300); };
const click = async (x, y, mods = []) => { await page.mouse.click(x, y, { modifiers: mods }); await page.waitForTimeout(350); };
const clear = async () => { await page.keyboard.press("Escape"); await page.evaluate(() => window.getSelection().removeAllRanges()); await page.mouse.click(5, 5); await page.waitForTimeout(150); };
const marquee = async () => { const r1 = await rect(trio[0].id), r3 = await rect(trio[2].id); await drag(r1.bx - 110, r1.by - 20, r1.bx + r1.bw / 2, r3.by + r3.bh + 10); return state(); };
const rx = async () => ({ r1: await rect(trio[0].id), r2: await rect(trio[1].id), r3: await rect(trio[2].id), ra: await rect(after.id) });
const results = {};
const scenario = async (name, act) => { await clear(); const before = await marquee(); const extra = (await act()) ?? {}; const s = await state(); results[name] = { before: before.halos, ...extra, after: s }; console.log("##", name, JSON.stringify(results[name])); };
await scenario("S1_click_left_margin", async () => { const { r2 } = await rx(); await click(r2.bx - 110, r2.by + r2.bh / 2); });
await scenario("S2_click_right_margin", async () => { const { r2 } = await rx(); await click(Math.min(r2.bx + r2.bw + 60, 1400 - 60), r2.by + r2.bh / 2); });
await scenario("S3_click_text_of_unselected_block", async () => { const { ra } = await rx(); await click(ra.x + 40, ra.y + ra.h / 2); });
await scenario("S4_click_text_of_selected_block", async () => { const { r2 } = await rx(); await click(r2.x + 40, r2.y + r2.h / 2); });
await scenario("S5_click_selected_row_right_of_text", async () => { const { r2 } = await rx(); const x = Math.min(r2.textRight + 60, r2.bx + r2.bw - 8); await click(x, r2.by + r2.bh / 2); return { x: Math.round(x), textRight: Math.round(r2.textRight), rowRight: Math.round(r2.bx + r2.bw) }; });
await scenario("S6_shift_click_unselected_block", async () => { const { ra } = await rx(); await click(ra.x + 40, ra.y + ra.h / 2, ["Shift"]); });
await scenario("S7_meta_click_unselected_block", async () => { const { ra } = await rx(); await click(ra.x + 40, ra.y + ra.h / 2, ["Meta"]); });
await scenario("S8_escape", async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); });
await scenario("S9_meta_click_selected_block", async () => { const { r2 } = await rx(); await click(r2.x + 40, r2.y + r2.h / 2, ["Meta"]); });
await scenario("S10_click_gap_between_blocks", async () => { const { r1, r2 } = await rx(); await click(r2.x + 40, (r1.by + r1.bh + r2.by) / 2); return { gapPx: Math.round(r2.by - (r1.by + r1.bh)) }; });
const textSel = async () => { const r1 = await rect(trio[0].id), r2 = await rect(trio[1].id); await drag(r1.x + 40, r1.y + r1.h / 2, r2.x + 60, r2.y + r2.h / 2); return state(); };
{ await clear(); const b = await textSel(); const { r2 } = await rx(); await click(r2.bx - 110, r2.by + r2.bh / 2); results.T1 = { before: { anchor: b.anchorBlock, focus: b.focusBlock }, after: await state() }; console.log("## T1_textsel_then_click_left_margin", JSON.stringify(results.T1)); }
{ await clear(); const b = await textSel(); const { ra } = await rx(); await click(ra.x + 40, ra.y + ra.h / 2); results.T2 = { before: { anchor: b.anchorBlock, focus: b.focusBlock }, after: await state() }; console.log("## T2_textsel_then_click_other_text", JSON.stringify(results.T2)); }
{ await clear(); const b = await textSel(); await page.keyboard.press("Escape"); await page.waitForTimeout(300); results.T3 = { before: { anchor: b.anchorBlock, focus: b.focusBlock }, after: await state() }; console.log("## T3_textsel_then_escape", JSON.stringify(results.T3)); }
{ await clear(); await marquee(); await page.evaluate(() => { const m = document.querySelector("main"); m.scrollTo(0, m.scrollHeight); }); await page.waitForTimeout(400);
  const lb = await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid="editor-root"] > * [data-block-type], [data-testid="editor-root"] [data-block-type]')]; const r = rows[rows.length - 1].getBoundingClientRect(); return { bottom: r.bottom, cx: r.left + r.width / 2, ih: innerHeight }; });
  const s0 = await state(); await click(lb.cx, Math.min(lb.bottom + 50, lb.ih - 20)); results.S11 = { before: s0.halos, after: await state() }; console.log("## S11_click_below_last_block", JSON.stringify(results.S11)); }
console.log("errors:", errors.length ? errors.join(" | ") : "none");
fs.writeFileSync("e2e/out-deselect.json", JSON.stringify(results, null, 1));
await browser.close();
