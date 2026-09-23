// Drag-selection + ⌘C parity with Notion (docs/notion-selection-copy.md).
// Same scenarios as selection-copy.measure.mjs, asserted against what the
// original does:
//   A  text drag inside one block → native text selection, Notion's highlight
//   B/C/H text drag across blocks → STAYS a text selection (focus kept), copy
//      is markdown (`1. …`) + semantic html (<ol><li>) + our block tree
//   E  margin marquee → block selection with the original's halo
//   D  text drag reaching an image → block selection
//   F  click on an image → that block selected, copy carries the image
//   K  Backspace on a cross-block text selection joins first and last block;
//      ⌘Z restores (dev data is expendable, and undone anyway)
//
//   [BASE_URL=http://localhost:3110] node e2e/selection-copy.check.mjs
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER = "30790fd0-9bdb-4c6c-abb8-3903fff5fd6d";
const COMCOM = "2c88615f-4a30-43f8-9608-6ac977919dc0";
const PAGE = process.env.PAGE_ID ?? "fa2188f1-ed08-414e-ab6c-345e5cf6a57f";
const HALO_BG = "rgba(35, 131, 226, 0.14)";
const SEL_BG = "rgba(35, 131, 226, 0.28)";
const OURS = "text/_ainmem-blocks-v1";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) fails++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: await sealData({ userId: USER, activeWorkspaceId: COMCOM }, { password: secret, ttl: 0 }), url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/p/${PAGE}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const ta = document.createElement("textarea"); ta.id = "__cp"; ta.style.cssText = "position:fixed;left:8px;bottom:8px;width:60px;height:24px;z-index:99999;opacity:0.01";
  document.body.appendChild(ta);
  window.__probe = { last: null };
  window.addEventListener("paste", (e) => { if (e.target !== ta) return; const cd = e.clipboardData; const out = {}; for (const t of cd.types) out[t] = cd.getData(t); window.__probe.last = { types: [...cd.types], data: out }; e.preventDefault(); e.stopImmediatePropagation(); }, true);
});
const state = () => page.evaluate(() => {
  const sel = window.getSelection();
  const rows = [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')];
  const selected = rows.filter((r) => r.querySelector(":scope > div > [data-selected]"));
  const first = selected[0]?.querySelector(":scope > div > [data-selected]");
  const st = first ? (() => { const s = getComputedStyle(first); return { bg: s.backgroundColor, radius: s.borderRadius, shadow: s.boxShadow }; })() : null;
  const rowOf = (n) => n ? ((n.nodeType === 3 ? n.parentElement : n)).closest?.("[data-block-type]")?.getAttribute("data-testid")?.slice(6, 14) : null;
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  const an = sel.anchorNode;
  return { collapsed: !r || sel.isCollapsed, startRow: r ? rowOf(r.startContainer) : null, endRow: r ? rowOf(r.endContainer) : null, halos: selected.length, haloStyle: st, selectionBg: an ? getComputedStyle(an.nodeType === 3 ? an.parentElement : an, "::selection").backgroundColor : null, active: document.activeElement?.tagName, editable: !!document.activeElement?.isContentEditable, blockCount: rows.length };
});
const copyRead = async () => {
  await page.keyboard.press("Control+c"); await page.waitForTimeout(250);
  const ok = await page.evaluate(() => { const ta = document.getElementById("__cp"); ta.focus(); return document.activeElement === ta; });
  if (!ok) return { types: [], data: {} };
  await page.keyboard.press("Control+v"); await page.waitForTimeout(250);
  return page.evaluate(() => { const r = window.__probe.last; window.__probe.last = null; return r ?? { types: [], data: {} }; });
};
const escape = async () => { await page.keyboard.press("Escape"); await page.evaluate(() => window.getSelection().removeAllRanges()); await page.mouse.click(5, 5); await page.waitForTimeout(150); };
const geo = await page.evaluate(() => [...document.querySelectorAll('[data-testid="editor-root"] [data-testid^="block-"]')].map((b) => { const r = b.getBoundingClientRect(); const ce = b.querySelector("[contenteditable]"); return { id: b.getAttribute("data-testid").slice(6), type: b.getAttribute("data-block-type"), top: Math.round(r.top + scrollY), h: Math.round(r.height), text: (ce?.innerText || "").trim().slice(0, 30), hasCe: !!ce }; }));
const texty = geo.filter((g) => g.hasCe && g.text.length > 8 && g.h < 60 && ["paragraph", "bulleted_list", "numbered_list", "heading_3", "heading_2"].includes(g.type));
let trio = null;
for (let i = 0; i + 2 < texty.length; i++) { const a = texty[i], b = texty[i + 1], d = texty[i + 2]; if (b.top - a.top < 90 && d.top - b.top < 90 && b.top > a.top && d.top > b.top) { trio = [a, b, d]; break; } }
const img = geo.find((g) => g.type === "image");
check("0. fixture: three consecutive text blocks and an image on the page", !!trio && !!img);
const rect = (id) => page.evaluate((id) => { const b = document.querySelector(`[data-testid="block-${id}"]`); const r = b.getBoundingClientRect(); const ce = b.querySelector("[contenteditable]") || b; const cr = ce.getBoundingClientRect(); return { x: cr.left, y: cr.top, w: cr.width, h: cr.height, bx: r.left, by: r.top, bw: r.width, bh: r.height }; }, id);
const scrollTo = async (docY) => { await page.evaluate((y) => { document.querySelector("main")?.scrollTo(0, y - 260); }, docY); await page.waitForTimeout(300); };
const drag = async (x1, y1, x2, y2, steps = 10) => { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await page.waitForTimeout(20); } await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(300); };
const has = (c, t) => (c.types ?? []).includes(t);

await scrollTo(trio[0].top);
// A
{ await escape(); const r = await rect(trio[1].id); await drag(r.x + 30, r.y + r.h / 2, r.x + 120, r.y + r.h / 2 + 1); const s = await state(); const c = await copyRead();
  check("A. text drag inside a block: native text selection, no halo", !s.collapsed && s.halos === 0 && s.startRow === s.endRow);
  check("A. selection highlight is the original's rgba(35,131,226,0.28)", s.selectionBg === SEL_BG, s.selectionBg);
  check("A. ⌘C copies the text", (c.data["text/plain"] ?? "").length > 0); }
// B / C / H
const across = async (label, endId, endDy) => {
  await escape(); const r1 = await rect(trio[0].id), r2 = await rect(endId);
  await drag(r1.x + 30, r1.y + r1.h / 2, r2.x + 100, endDy ?? r2.y + r2.h / 2);
  const s = await state(); const c = await copyRead();
  check(`${label}. stays a TEXT selection spanning blocks (no halo, focus kept)`, !s.collapsed && s.halos === 0 && s.startRow !== s.endRow && s.editable, `start=${s.startRow} end=${s.endRow} halos=${s.halos} editable=${s.editable}`);
  check(`${label}. ⌘C: markdown text/plain with list markers`, /^(\d+\.|-|#) /.test(c.data["text/plain"] ?? "") && (c.data["text/plain"] ?? "").includes("\n"), JSON.stringify((c.data["text/plain"] ?? "").slice(0, 60)));
  check(`${label}. ⌘C: semantic text/html, not the browser's styled spans`, /^<(ol|ul|p|h[1-3])/.test(c.data["text/html"] ?? "") && !(c.data["text/html"] ?? "").includes("<span style"), (c.data["text/html"] ?? "").slice(0, 60));
  check(`${label}. ⌘C: carries our block tree`, has(c, OURS));
};
await across("B", trio[1].id);
await across("C", trio[2].id);
{ const r3 = await rect(trio[2].id); await across("H", trio[2].id, r3.by + r3.bh + 30); }
// E
{ await escape(); const r1 = await rect(trio[0].id), r3 = await rect(trio[2].id); await drag(r1.bx - 110, r1.by - 20, r1.bx + r1.bw / 2, r3.by + r3.bh + 10, 14); const s = await state(); const c = await copyRead();
  check("E. margin marquee selects blocks (halo), no text selection", s.halos >= 3 && s.collapsed, `halos=${s.halos}`);
  check("E. halo is the original's: rgba(35,131,226,0.14), 4px, no shadow", s.haloStyle?.bg === HALO_BG && s.haloStyle?.radius === "4px" && s.haloStyle?.shadow === "none", JSON.stringify(s.haloStyle));
  check("E. ⌘C on the block selection: markdown + html + tree", (c.data["text/plain"] ?? "").length > 0 && /^<(ol|ul|p|h[1-3])/.test(c.data["text/html"] ?? "") && has(c, OURS), (c.types ?? []).join(",")); }
// D
{ await escape(); await scrollTo(img.top); const before = geo.filter((g) => g.hasCe && g.top < img.top && g.text.length > 4).at(-1); const rb = await rect(before.id), ri = await rect(img.id);
  await drag(rb.x + 30, rb.y + rb.h / 2, ri.bx + ri.bw / 2, ri.by + ri.bh / 2); const s = await state(); const c = await copyRead();
  check("D. text drag reaching an image turns into a block selection", s.halos >= 1 && s.collapsed, `halos=${s.halos}`);
  check("D. ⌘C carries the image in markdown/html/tree", (c.data["text/plain"] ?? "").includes("![") && (c.data["text/html"] ?? "").includes("<img") && has(c, OURS)); }
// F
{ await escape(); const ri = await rect(img.id); await page.mouse.click(ri.bx + ri.bw / 2, ri.by + ri.bh / 2); await page.waitForTimeout(300); const s = await state(); const c = await copyRead();
  check("F. clicking an image selects its block", s.halos === 1, `halos=${s.halos}`);
  check("F. ⌘C copies the image block", (c.data["text/html"] ?? "").startsWith("<p><img") && has(c, OURS)); }
// K: Backspace across blocks joins, ⌘Z restores
{ await escape(); await scrollTo(trio[0].top); const before = await state(); const r1 = await rect(trio[0].id), r2 = await rect(trio[1].id);
  const t1 = await page.evaluate((id) => document.querySelector(`[data-testid="block-${id}"] [contenteditable]`).innerText, trio[0].id);
  const t2 = await page.evaluate((id) => document.querySelector(`[data-testid="block-${id}"] [contenteditable]`).innerText, trio[1].id);
  await drag(r1.x + 30, r1.y + r1.h / 2, r2.x + 100, r2.y + r2.h / 2);
  await page.keyboard.press("Backspace"); await page.waitForTimeout(400);
  const after = await state();
  const joined = await page.evaluate((id) => document.querySelector(`[data-testid="block-${id}"] [contenteditable]`)?.innerText ?? null, trio[0].id);
  check("K. Backspace on a cross-block text selection joins first and last block", after.blockCount === before.blockCount - 1 && joined !== null && joined.length < t1.length + t2.length && t1.startsWith(joined.slice(0, 2)) && t2.endsWith(joined.slice(-6)), `blocks ${before.blockCount}→${after.blockCount}, "${(joined ?? "").slice(0, 40)}"`);
  await page.keyboard.press("Control+z"); await page.waitForTimeout(600);
  const restored = await state();
  const t1b = await page.evaluate((id) => document.querySelector(`[data-testid="block-${id}"] [contenteditable]`)?.innerText ?? null, trio[0].id);
  check("K. ⌘Z brings the blocks back", restored.blockCount === before.blockCount && t1b === t1, `blocks=${restored.blockCount} before="${t1.slice(0, 30)}" after="${(t1b ?? "").slice(0, 30)}"`); }

check("Z. no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
