// Measure OUR editor's drag-selection + copy, scenario for scenario the way
// Notion was measured (docs/notion-selection-copy.md). Prints JSON per
// scenario; used to diff against the original before and after the fix.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/selection-copy.measure.mjs
//
// Read-only on the page: drags, Escape, copy, and a paste into an injected
// <textarea> whose capture listener records the clipboard and preventDefaults.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER = "30790fd0-9bdb-4c6c-abb8-3903fff5fd6d"; // amy (ComCom member)
const COMCOM = "2c88615f-4a30-43f8-9608-6ac977919dc0";
const PAGE = process.env.PAGE_ID ?? "fa2188f1-ed08-414e-ab6c-345e5cf6a57f"; // "Knowledge Graph 기반 AI 전시 경험": 226 text blocks, 13 images
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";

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
  window.addEventListener("paste", (e) => {
    if (e.target !== ta) return;
    const cd = e.clipboardData; const out = {};
    for (const t of cd.types) { const v = cd.getData(t); out[t] = v.length > 400 ? v.slice(0, 400) + "…[" + v.length + "]" : v; }
    window.__probe.last = { types: [...cd.types], data: out };
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
});

const state = () => page.evaluate(() => {
  const sel = window.getSelection();
  const rows = [...document.querySelectorAll('[data-testid="editor-root"] [data-testid^="block-"]')];
  const selectedRows = rows.filter((r) => r.querySelector(":scope > div > [data-selected]"));
  const first = selectedRows[0]?.querySelector(":scope > div > [data-selected]");
  const st = first ? (() => { const s = getComputedStyle(first); return { bg: s.backgroundColor, radius: s.borderRadius, shadow: s.boxShadow, outline: s.outline }; })() : null;
  const blk = (n) => n && (n.nodeType === 3 ? n.parentElement : n).closest?.('[data-testid^="block-"]')?.getAttribute("data-testid")?.slice(6, 14);
  const an = sel.anchorNode;
  return { selText: sel.toString().slice(0, 60), selLen: sel.toString().length, ranges: sel.rangeCount, anchorBlock: blk(an), focusBlock: blk(sel.focusNode), halos: selectedRows.length, haloStyle: st, selectionBg: an ? getComputedStyle(an.nodeType === 3 ? an.parentElement : an, "::selection").backgroundColor : null, active: document.activeElement?.tagName, editable: !!document.activeElement?.isContentEditable };
});
const copyRead = async () => {
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(250);
  const ok = await page.evaluate(() => { const ta = document.getElementById("__cp"); ta.focus(); return document.activeElement === ta; });
  if (!ok) return { error: "probe not focused" };
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => { const r = window.__probe.last; window.__probe.last = null; return r; });
  return r;
};
const escape = async () => { await page.keyboard.press("Escape"); await page.evaluate(() => window.getSelection().removeAllRanges()); await page.mouse.click(5, 5); await page.waitForTimeout(150); };
const geo = await page.evaluate(() => [...document.querySelectorAll('[data-testid="editor-root"] [data-testid^="block-"]')].map((b) => {
  const r = b.getBoundingClientRect(); const ce = b.querySelector("[contenteditable]"); const cr = ce?.getBoundingClientRect();
  return { id: b.getAttribute("data-testid").slice(6), type: b.getAttribute("data-block-type"), top: Math.round(r.top + scrollY), h: Math.round(r.height), text: (ce?.innerText || "").trim().slice(0, 30), hasCe: !!ce, ceLeft: cr ? Math.round(cr.left) : null };
}));
const texty = geo.filter((g) => g.hasCe && g.text.length > 8 && g.h < 60 && ["paragraph", "bulleted_list", "numbered_list", "heading_3", "heading_2"].includes(g.type));
let trio = null;
for (let i = 0; i + 2 < texty.length; i++) { const a = texty[i], b = texty[i + 1], d = texty[i + 2]; if (b.top - a.top < 90 && d.top - b.top < 90 && b.top > a.top && d.top > b.top) { trio = [a, b, d]; break; } }
const img = geo.find((g) => g.type === "image");
console.log("trio", JSON.stringify(trio?.map((t) => [t.id.slice(0, 8), t.type, t.text])), "img", img?.id.slice(0, 8));
const rect = (id) => page.evaluate((id) => { const b = document.querySelector(`[data-testid="block-${id}"]`); const r = b.getBoundingClientRect(); const ce = b.querySelector("[contenteditable]") || b; const cr = ce.getBoundingClientRect(); return { x: cr.left, y: cr.top, w: cr.width, h: cr.height, bx: r.left, by: r.top, bw: r.width, bh: r.height }; }, id);
const scrollTo = async (docY) => { await page.evaluate((y) => { document.querySelector("main")?.scrollTo(0, y - 260); window.scrollTo(0, y - 260); }, docY); await page.waitForTimeout(300); };
const drag = async (x1, y1, x2, y2, steps = 10) => { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await page.waitForTimeout(20); } await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(300); };
const results = {};
const run = async (name, fn) => { await escape(); const r = await fn(); results[name] = r; console.log("\n##", name, "\n", JSON.stringify(r, null, 1)); await escape(); };

await scrollTo(trio[0].top);
await run("A_text_within_block", async () => { const r = await rect(trio[1].id); await drag(r.x + 30, r.y + r.h / 2, r.x + 120, r.y + r.h / 2 + 1); const s = await state(); await page.screenshot({ path: "e2e/out-sel-A.png" }).catch(() => {}); return { s, clip: await copyRead() }; });
await run("B_text_across_two_blocks", async () => { const r1 = await rect(trio[0].id), r2 = await rect(trio[1].id); await drag(r1.x + 30, r1.y + r1.h / 2, r2.x + 100, r2.y + r2.h / 2); const s = await state(); await page.screenshot({ path: "e2e/out-sel-B.png" }).catch(() => {}); return { s, clip: await copyRead() }; });
await run("C_across_three_blocks", async () => { const r1 = await rect(trio[0].id), r3 = await rect(trio[2].id); await drag(r1.x + 30, r1.y + r1.h / 2, r3.x + 100, r3.y + r3.h / 2); const s = await state(); return { s, clip: await copyRead() }; });
await run("E_margin_marquee_top_down", async () => { const r1 = await rect(trio[0].id), r3 = await rect(trio[2].id); await drag(r1.bx - 110, r1.by - 20, r1.bx + r1.bw / 2, r3.by + r3.bh + 10, 14); const s = await state(); await page.screenshot({ path: "e2e/out-sel-E.png" }).catch(() => {}); return { s, clip: await copyRead() }; });
await run("H_text_drag_past_last_block", async () => { const r1 = await rect(trio[0].id), r3 = await rect(trio[2].id); await drag(r1.x + 30, r1.y + r1.h / 2, r3.x + 30, r3.by + r3.bh + 30); const s = await state(); return { s, clip: await copyRead() }; });
if (img) {
  await scrollTo(img.top);
  const before = geo.filter((g) => g.hasCe && g.top < img.top && g.text.length > 4).at(-1);
  await run("D_text_into_image", async () => { const rb = await rect(before.id), ri = await rect(img.id); await drag(rb.x + 30, rb.y + rb.h / 2, ri.bx + ri.bw / 2, ri.by + ri.bh / 2); const s = await state(); await page.screenshot({ path: "e2e/out-sel-D.png" }).catch(() => {}); return { s, clip: await copyRead() }; });
  await run("F_click_image", async () => { const ri = await rect(img.id); await page.mouse.click(ri.bx + ri.bw / 2, ri.by + ri.bh / 2); await page.waitForTimeout(300); const s = await state(); return { s, clip: await copyRead() }; });
}
console.log("\nerrors:", errors.length ? errors.join(" | ") : "none");
fs.writeFileSync("e2e/out-selection-copy.json", JSON.stringify(results, null, 1));
await browser.close();
