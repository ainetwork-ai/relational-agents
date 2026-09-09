// What clears a block selection / a cross-block text selection, and how the
// halo is drawn — asserted against Notion (docs/notion-selection-copy.md §5·§6,
// measured 2026-09-09 with real clicks on the original):
//   margin click (left/right) → cleared, caret in the block on that line
//   click on TEXT (unselected or selected block, plain/Shift/⌘) → cleared, caret there
//   Escape → cleared;  click below the last block → cleared
//   click on a block's own padding (not text) → just that block selected
//   text selection + margin click → gone;  + click other text → caret there;  + Escape → caret
//   halo: rgba(35,131,226,0.14), 4px radius, overlay inset 2px (text) / 1px top-bottom
//   (list items, 2px where they meet a non-list block), 2px sides; a selected
//   parent's children carry no halo of their own
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/deselect.check.mjs
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER = "30790fd0-9bdb-4c6c-abb8-3903fff5fd6d";
const COMCOM = "2c88615f-4a30-43f8-9608-6ac977919dc0";
const PAGE = process.env.PAGE_ID ?? "fa2188f1-ed08-414e-ab6c-345e5cf6a57f";
const HALO_BG = "rgba(35, 131, 226, 0.14)";
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
const state = () => page.evaluate(() => {
  const sel = window.getSelection();
  const rows = [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')];
  const halos = rows.filter((r) => r.querySelector(":scope > div > [data-selected]")).map((r) => r.getAttribute("data-testid").slice(6, 14));
  const blk = (n) => n ? ((n.nodeType === 3 ? n.parentElement : n)).closest?.("[data-block-type]")?.getAttribute("data-testid")?.slice(6, 14) ?? null : null;
  const ae = document.activeElement;
  return { halos, collapsed: sel.rangeCount ? sel.isCollapsed : null, caretBlock: sel.rangeCount && sel.isCollapsed ? blk(sel.anchorNode) : null, anchorBlock: blk(sel.anchorNode), focusBlock: blk(sel.focusNode), editable: !!ae?.isContentEditable };
});
const geo = await page.evaluate(() => [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')].map((b) => { const r = b.getBoundingClientRect(); const ce = b.querySelector("[contenteditable]"); const own = ce && ce.closest("[data-block-type]") === b; return { id: b.getAttribute("data-testid").slice(6), type: b.getAttribute("data-block-type"), top: Math.round(r.top + scrollY), h: Math.round(r.height), text: own ? (ce.innerText || "").trim().slice(0, 30) : "", own, depth: (() => { let d = 0, p = b.parentElement; while (p) { if (p.matches("[data-block-type]")) d++; p = p.parentElement; } return d; })() }; }));
// three DOM-adjacent SIBLING text blocks (same parent row, same depth) so each halo is its own, then the next block with text
const parentOf = (i) => { let k = i - 1; while (k >= 0 && geo[k].depth >= geo[i].depth) k--; return k; };
let run = null;
for (let i = 0; i < geo.length && !run; i++) {
  const okBlock = (g) => g.own && g.text.length > 4 && g.h < 80 && ["paragraph", "numbered_list", "bulleted_list", "heading3"].includes(g.type);
  const r = []; let j = i;
  while (j < geo.length && okBlock(geo[j]) && geo[j].depth === geo[i].depth && parentOf(j) === parentOf(i) && r.length < 3) { r.push(geo[j]); j++; if (j < geo.length && geo[j].depth > geo[i].depth) break; }
  if (r.length === 3) { let k = j; while (k < geo.length && !(geo[k].own && geo[k].text.length > 4)) k++; if (k < geo.length) run = { trio: r, after: geo[k] }; }
}
check("0. fixture: three adjacent sibling text blocks + a following text block", !!run, run ? run.trio.map((t) => t.type).join(",") : JSON.stringify(geo.slice(0, 6).map((g) => [g.type, g.depth, g.own])));
if (!run) { await browser.close(); process.exit(1); }
const { trio, after } = run;
console.log("   fixture:", JSON.stringify(trio.map((t) => [t.id.slice(0, 8), t.type, t.depth, t.text.slice(0, 20), t.h])), "after", after.id.slice(0, 8), after.type);
const rect = (id) => page.evaluate((id) => { const b = document.querySelector(`[data-testid="block-${id}"]`); const r = b.getBoundingClientRect(); const ce = b.querySelector("[contenteditable]") || b; const cr = ce.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(ce); const tr = rg.getBoundingClientRect(); return { x: cr.left, y: cr.top, w: cr.width, h: cr.height, bx: r.left, by: r.top, bw: r.width, bh: r.height, textRight: tr.right }; }, id);
const reScroll = async () => { await page.evaluate((id) => { const b = document.querySelector(`[data-testid="block-${id}"]`); const m = document.querySelector("main"); m.scrollTop += b.getBoundingClientRect().top - 300; }, trio[0].id); await page.waitForTimeout(250); };
const drag = async (x1, y1, x2, y2, steps = 8) => { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await page.waitForTimeout(15); } await page.waitForTimeout(80); await page.mouse.up(); await page.waitForTimeout(300); };
const click = async (x, y, mods = []) => { await page.mouse.click(x, y, { modifiers: mods }); await page.waitForTimeout(350); };
const clear = async () => { await page.keyboard.press("Escape"); await page.evaluate(() => window.getSelection().removeAllRanges()); await page.mouse.click(5, 5); await page.waitForTimeout(150); };
const marquee = async () => { await reScroll(); const r1 = await rect(trio[0].id), r3 = await rect(trio[2].id); await drag(r1.bx - 110, r1.by + 3, r1.bx + r1.bw / 2, r3.by + r3.bh - 4); return state(); };
const ids = trio.map((t) => t.id.slice(0, 8));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ── halo geometry ──
{ await clear(); const s = await marquee();
  check("G. marquee over three top-level blocks halos exactly those three", same(s.halos, ids), `${s.halos} vs ${ids}`);
  const g = await page.evaluate((ids) => ids.map((id) => { const row = document.querySelector(`[data-testid="block-${id}"]`); if (!row) return null; const h = row.querySelector(":scope > div > [data-selected]"); if (!h) return null; const hr = h.getBoundingClientRect(); const rr = row.getBoundingClientRect(); const s = getComputedStyle(h); return { type: row.getAttribute("data-block-type"), inset: { top: +(hr.top - rr.top).toFixed(1), left: +(hr.left - rr.left).toFixed(1), right: +(rr.right - hr.right).toFixed(1), bottom: +(rr.bottom - hr.bottom).toFixed(1) }, bg: s.backgroundColor, radius: s.borderRadius, shadow: s.boxShadow, pe: s.pointerEvents, y: hr.top, b: hr.bottom }; }), trio.map((t) => t.id));
  check("G. halo style: rgba(35,131,226,0.14), 4px radius, no shadow, pointer-events none", g.every((h) => h && h.bg === HALO_BG && h.radius === "4px" && h.shadow === "none" && h.pe === "none"), JSON.stringify(g.map((h) => h && [h.bg, h.radius, h.shadow, h.pe])));
  const LIST = new Set(["bulleted_list", "numbered_list", "todo", "toggle"]);
  const want = (i) => { const t = trio[i].type; if (!LIST.has(t)) return { top: 2, bottom: 2 }; const p = trio[i - 1], n = trio[i + 1]; return { top: p && LIST.has(p.type) ? 1 : 2, bottom: n && LIST.has(n.type) ? 1 : 2 }; };
  check("G. halo inset: 2px inside the block box (indent + 2 on the left), 2px top/bottom on text, 1px on list items between list items", g.every((h, i) => h && h.inset.left === trio[i].depth * 24 + 2 && h.inset.right === 2 && h.inset.top === want(i).top && h.inset.bottom === want(i).bottom), JSON.stringify(g.map((h) => h && [h.type, h.inset])));
  const seam = (i) => +(g[i + 1].y - g[i].b).toFixed(1);
  check("G. seam between adjacent halos = sum of the two insets (4px text·text, 2px list·list)", [0, 1].every((i) => seam(i) === want(i).bottom + want(i + 1).top), `${seam(0)}, ${seam(1)}`); }
// ── deselection matrix ──
const scenario = async (name, act, expect) => { await clear(); const before = await marquee(); if (!same(before.halos, ids)) { check(`${name}: setup`, false, `marquee gave ${before.halos}`); return; } const extra = (await act()) ?? {}; const s = await state(); const { ok, why } = expect(s, extra); check(name, ok, why ?? JSON.stringify({ halos: s.halos, caret: s.caretBlock, editable: s.editable })); };
const rx = async () => ({ r1: await rect(trio[0].id), r2: await rect(trio[1].id), r3: await rect(trio[2].id), ra: await rect(after.id) });
const cleared = (s) => s.halos.length === 0;
const caretIn = (s, id) => cleared(s) && s.collapsed === true && s.caretBlock === id.slice(0, 8) && s.editable;
await scenario("S1. left-margin click clears, caret in the block on that line", async () => { const { r2 } = await rx(); await click(r2.bx - 110, r2.by + r2.bh / 2); }, (s) => ({ ok: caretIn(s, trio[1].id) }));
await scenario("S2. right-margin click clears, caret in the block on that line", async () => { const { r2 } = await rx(); await click(Math.min(r2.bx + r2.bw + 60, 1400 - 60), r2.by + r2.bh / 2); }, (s) => ({ ok: caretIn(s, trio[1].id) }));
await scenario("S3. click on an unselected block's text clears, caret there", async () => { const { ra } = await rx(); await click(ra.x + 40, ra.y + ra.h / 2); }, (s) => ({ ok: caretIn(s, after.id) }));
await scenario("S4. click on a SELECTED block's text clears, caret there", async () => { const { r2 } = await rx(); await click(r2.x + 40, r2.y + r2.h / 2); }, (s) => ({ ok: caretIn(s, trio[1].id) }));
await scenario("S5. click on a selected row right of its text clears, caret in it", async () => { const { r2 } = await rx(); await click(Math.min(r2.textRight + 60, r2.bx + r2.bw - 8), r2.by + r2.bh / 2); }, (s) => ({ ok: caretIn(s, trio[1].id) }));
await scenario("S6. Shift+click on another block's text clears, caret there", async () => { const { ra } = await rx(); await click(ra.x + 40, ra.y + ra.h / 2, ["Shift"]); }, (s) => ({ ok: caretIn(s, after.id) }));
await scenario("S7. ⌘+click on another block's text clears, caret there", async () => { const { ra } = await rx(); await click(ra.x + 40, ra.y + ra.h / 2, ["Meta"]); }, (s) => ({ ok: caretIn(s, after.id) }));
await scenario("S8. Escape clears", async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }, (s) => ({ ok: cleared(s) }));
await scenario("S9. ⌘+click on a selected block's text clears, caret there", async () => { const { r2 } = await rx(); await click(r2.x + 40, r2.y + r2.h / 2, ["Meta"]); }, (s) => ({ ok: caretIn(s, trio[1].id) }));
await scenario("S10. click on a block's own padding (not text) selects just that block", async () => { const { r2 } = await rx(); await click(r2.x + 40, r2.by + 1); }, (s) => ({ ok: s.halos.length === 1 && s.halos[0] === trio[1].id.slice(0, 8), why: `halos=${s.halos}` }));
{ await clear(); await marquee(); await page.evaluate(() => { const m = document.querySelector("main"); m.scrollTop = m.scrollHeight; }); await page.waitForTimeout(400);
  const lb = await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')]; const r = rows[rows.length - 1].getBoundingClientRect(); return { bottom: r.bottom, cx: r.left + r.width / 2, ih: innerHeight }; });
  await click(lb.cx, Math.min(lb.bottom + 50, lb.ih - 20)); const s = await state(); check("S11. click below the last block clears", cleared(s), `halos=${s.halos}`); }
// text drags start and end on the FIRST line of each block: a press in the gap between two wrapped lines starts no selection
const line1 = (r) => r.y + Math.min(14, r.h / 2);
const textSel = async () => { await reScroll(); const r1 = await rect(trio[0].id), r2 = await rect(trio[1].id); await drag(r1.x + 40, line1(r1), r2.x + 60, line1(r2)); return state(); };
{ await clear(); const b = await textSel(); const ok0 = b.anchorBlock !== b.focusBlock && !b.collapsed; const { r2 } = await rx(); await click(r2.bx - 110, r2.by + r2.bh / 2); const s = await state(); check("T1. text selection across blocks + margin click → selection gone, caret on that line", ok0 && s.collapsed === true && s.halos.length === 0, JSON.stringify({ setup: ok0, before: b, collapsed: s.collapsed, caret: s.caretBlock })); }
{ await clear(); const b = await textSel(); const { ra } = await rx(); await click(ra.x + 40, ra.y + ra.h / 2); const s = await state(); check("T2. text selection + click on other text → caret there", b.anchorBlock !== b.focusBlock && caretIn(s, after.id)); }
{ await clear(); const b = await textSel(); await page.keyboard.press("Escape"); await page.waitForTimeout(300); const s = await state(); check("T3. text selection + Escape → a caret, no halo, no lingering range", b.anchorBlock !== b.focusBlock && s.collapsed === true && s.halos.length === 0 && s.editable, JSON.stringify({ collapsed: s.collapsed, halos: s.halos, caret: s.caretBlock })); }
check("Z. no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
