// Compares caret movement (arrow keys, Tab) and cell-range selection (drag, Shift+arrows) inside
// a table block with the values measured on the original (src/i18n/content/e2e-fixtures/notion-table-cellnav.json).
//
// The original was measured by driving a Notion 'Table' block directly over CDP (2026-08-28, table test page).
// Rules in short:
//   · → at the end of the text goes to the start of the next cell / ← at the start to the end of the previous cell (wraps across rows)
//   · ↑↓ first move between lines inside the cell, and with no more lines go to the cell above/below (caret x kept)
//   · going further past the table edge exits to the block before/after the table
//   · Tab/Shift+Tab go to the **very end** of the next/previous cell; Tab in the last cell does nothing
//   · the cell with the caret gets a single 2px blue border; once a drag crosses cells, a **cell range**
//     is selected, not text (one border wraps the union, with a handle at the middle of the right edge)
//   · a drag within one cell is just a text selection and brings up the format toolbar
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/table-cellnav.check.mjs
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-table-cellnav.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };

const uuid = () => crypto.randomUUID();
const beforeId = uuid(), tableId = uuid(), afterId = uuid();
const blocks = [
  { id: beforeId, type: "paragraph", content: { text: "before" }, parentBlockId: null, position: 1 },
  { id: tableId, type: "table", content: { table: { cells: G.table.cells, headerRow: false } }, parentBlockId: null, position: 2 },
  { id: afterId, type: "paragraph", content: { text: G.table.after }, parentBlockId: null, position: 3 },
];
const created = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "table-cellnav.check" }) }).then((r) => r.json());
const pageId = created.page?.id ?? created.id;
if (!pageId) { console.error("Could not create the page:", created); process.exit(1); }
const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({ blocks, deletedIds: [], newIds: blocks.map((b) => b.id) }) });
if (!put.ok) { console.error("Saving blocks failed:", put.status, await put.text()); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(`[data-testid="table-cell-${tableId}-0-0"]`, { timeout: 60_000 });
await page.waitForTimeout(400);

const fails = []; let checks = 0;
const eq = (label, got, want, tol = 1.5) => {
  checks++;
  const ok = typeof want === "number" && typeof got === "number" ? Math.abs(got - want) <= tol : JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails.push(`${label}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
};
const cellSel = (r, c) => `[data-testid="table-cell-${tableId}-${r}-${c}"]`;

/** Which cell and character offset the caret is at + its x coordinate */
const state = () => page.evaluate((tid) => {
  const s = getSelection();
  const out = { text: s && !s.isCollapsed ? s.toString() : "", collapsed: !s || s.isCollapsed };
  const a = document.activeElement;
  out.active = a?.getAttribute?.("data-testid") ?? a?.tagName ?? null;
  if (s && s.rangeCount) {
    const node = s.anchorNode;
    const el = node && (node.nodeType === 3 ? node.parentElement : node);
    const cell = el?.closest?.(`[data-testid^="table-cell-${tid}-"]`);
    if (cell) {
      const m = cell.getAttribute("data-testid").split("-");
      out.cell = [Number(m[m.length - 2]), Number(m[m.length - 1])];
      const pre = document.createRange();
      pre.selectNodeContents(cell); pre.setEnd(s.anchorNode, s.anchorOffset);
      out.offset = pre.toString().length;
      out.cellText = cell.innerText;
    }
    // a collapsed range anchored on an element has empty client rects — measure via the neighboring character
    const rng = s.getRangeAt(0).cloneRange(); rng.collapse(true);
    let box = [...rng.getClientRects()].find((q) => q.width || q.height) ?? null;
    if (!box) {
      const node = rng.startContainer, off = rng.startOffset;
      const probe = rng.cloneRange();
      if (node.nodeType === 3 && off > 0) { probe.setStart(node, off - 1); probe.setEnd(node, off);
        const q = probe.getBoundingClientRect(); box = { x: q.right, y: q.top }; }
      else if (node.nodeType === 3 && off < (node.textContent || "").length) { probe.setStart(node, off); probe.setEnd(node, off + 1);
        const q = probe.getBoundingClientRect(); box = { x: q.left, y: q.top }; }
      else { const host = node.nodeType === 3 ? node.parentElement : node;
        const p2 = document.createRange(); p2.selectNodeContents(host);
        const rs = [...p2.getClientRects()].filter((q) => q.width || q.height);
        const last = rs[rs.length - 1];
        box = last ? { x: off >= host.childNodes.length ? last.right : rs[0].left, y: last.top } : host.getBoundingClientRect();
      }
    }
    out.caretX = Math.round(box.x); out.caretY = Math.round(box.y);
  }
  const ov = document.querySelector(`[data-testid="table-selection-${tid}"]`);
  if (ov && getComputedStyle(ov).display !== "none") {
    const b = ov.getBoundingClientRect(); const st = getComputedStyle(ov);
    out.range = ov.getAttribute("data-range");
    out.overlay = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      bw: st.borderTopWidth, bc: st.borderTopColor, radius: st.borderTopLeftRadius, bg: st.backgroundColor };
  }
  const hd = document.querySelector(`[data-testid="table-selection-handle-${tid}"]`);
  if (hd && getComputedStyle(hd).display !== "none") { const b = hd.getBoundingClientRect(); const st = getComputedStyle(hd);
    out.handle = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bg: st.backgroundColor, bw: st.borderTopWidth, bc: st.borderTopColor }; }
  out.toolbar = !!document.querySelector('[data-testid="format-toolbar"]');
  return out;
}, tableId);

/** Put the caret at the very start/end of a cell */
const putCaret = async (r, c, where = "end") => {
  await page.evaluate(({ sel, where }) => {
    const el = document.querySelector(sel);
    el.focus();
    const rng = document.createRange();
    rng.selectNodeContents(el); rng.collapse(where === "start");
    const s = getSelection(); s.removeAllRanges(); s.addRange(rng);
  }, { sel: cellSel(r, c), where });
  await page.waitForTimeout(60);
};
const cellBox = (r, c) => page.locator(cellSel(r, c)).boundingBox();

// ── 1. Arrow keys / Tab ──────────────────────────────────────────────
for (const t of G.nav) {
  await page.keyboard.press("Escape").catch(() => {});
  await putCaret(t.from[0], t.from[1], t.caret ?? "end");
  const pre = await state();
  for (const k of t.keys ?? [t.key]) { await page.keyboard.press(k); await page.waitForTimeout(90); }
  const s = await state();
  const tag = `nav:${t.id}`;
  if (t.outside) {
    eq(`${tag} out of the table`, s.cell ?? "outside", "outside");
  } else {
    eq(`${tag} cell`, s.cell, t.cell);
    if (["ArrowDown", "ArrowUp"].includes(t.key)) eq(`${tag} caret x kept`, s.caretX, pre.caretX, 6);
    else eq(`${tag} offset`, s.offset, t.offset, 0);
  }
  if (t.rows != null) eq(`${tag} row count`, await page.locator(`[data-testid^="table-cell-${tableId}-"]`).count() / G.table.cells[0].length, t.rows);
}

// ── 2. Vertical movement inside a wrapped cell ─────────────────────────────
{
  await page.evaluate(({ sel, text }) => {
    const el = document.querySelector(sel);
    el.focus(); el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, { sel: cellSel(1, 1), text: G.wrapped.text });
  await page.waitForTimeout(300);
  const box = await cellBox(1, 1);
  eq("wrapped cell has two lines", box.height > G.geometry.cellMinHeight + 10, true);
  await putCaret(1, 1, "end");
  const end = await state();
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(90);
  const up = await state();
  eq("wrapped ↑ goes to the first line in the cell", up.cell, [1, 1]);
  eq("wrapped ↑ moves up a line", up.caretY < end.caretY, true);
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(90);
  eq("wrapped ↓ goes to the second line in the cell", (await state()).cell, [1, 1]);
  // restore the original value
  await page.evaluate(({ sel, text }) => {
    const el = document.querySelector(sel); el.focus(); el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, { sel: cellSel(1, 1), text: G.table.cells[1][1] });
  await page.waitForTimeout(250);
}

// ── 3. Blue border on the caret's cell ────────────────────────────────
{
  await putCaret(1, 1, "end");
  const s = await state();
  const box = await cellBox(1, 1);
  const sel = G.geometry.selection;
  if (!s.overlay) fails.push("caret cell border: missing"), checks++;
  else {
    eq("caret cell border width", s.overlay.bw, `${sel.borderWidth}px`);
    eq("caret cell border color", s.overlay.bc, sel.borderColor);
    eq("caret cell border radius", s.overlay.radius, `${sel.borderRadius}px`);
    eq("caret cell border background", s.overlay.bg, sel.background);
    eq("caret cell border x", s.overlay.x, box.x + sel.insetFromUnion);
    eq("caret cell border y", s.overlay.y, box.y + sel.insetFromUnion);
    eq("caret cell border w", s.overlay.w, box.width - 2 * sel.insetFromUnion);
    eq("caret cell border h", s.overlay.h, box.height - 2 * sel.insetFromUnion);
  }
  eq("no handle with just a caret", !!s.handle, false);
}

// ── 4. Cell range via Escape / Shift+arrows ────────────────────────────
for (const t of G.select) {
  await page.keyboard.press("Escape").catch(() => {});
  await putCaret(t.from[0], t.from[1], t.caret ?? "end");
  for (const k of t.keys ?? [t.key]) { await page.keyboard.press(k); await page.waitForTimeout(90); }
  const s = await state();
  const tag = `select:${t.id}`;
  eq(`${tag} range`, s.range, t.range.flat().join(","));
  eq(`${tag} no text selection`, s.text, "");
}

// ── 5. Drag ────────────────────────────────────────────────────
{
  await page.keyboard.press("Escape").catch(() => {});
  const t = G.drag.find((d) => d.id === "cross-cell");
  const a = await cellBox(t.from[0], t.from[1]), b = await cellBox(t.to[0], t.to[1]);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 8, a.y + a.height / 2 + ((b.y - a.y) * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const s = await state();
  eq("drag:cross-cell range", s.range, t.range.flat().join(","));
  eq("drag:cross-cell no text selection", s.text, "");
  eq("drag:cross-cell no toolbar", s.toolbar, false);
  const sel = G.geometry.selection;
  if (!s.overlay) fails.push("drag:cross-cell border: missing"), checks++;
  else {
    eq("drag border x", s.overlay.x, a.x + sel.insetFromUnion);
    eq("drag border y", s.overlay.y, a.y + sel.insetFromUnion);
    eq("drag border w", s.overlay.w, b.x + b.width - a.x - 2 * sel.insetFromUnion);
    eq("drag border h", s.overlay.h, b.y + b.height - a.y - 2 * sel.insetFromUnion);
  }
  const hd = sel.handle;
  if (!s.handle) fails.push("drag handle: missing"), checks++;
  else {
    eq("handle size", `${s.handle.w}x${s.handle.h}`, `${hd.w}x${hd.h}`);
    eq("handle background", s.handle.bg, hd.bg);
    eq("handle border", `${s.handle.bw} ${s.handle.bc}`, `${hd.borderWidth}px ${hd.borderColor}`);
    eq("handle x (selection right edge)", s.handle.x + s.handle.w / 2, s.overlay.x + s.overlay.w - 1, 2);
    eq("handle y (vertical middle)", s.handle.y + s.handle.h / 2, s.overlay.y + s.overlay.h / 2, 2);
  }
}
{
  // drag within one cell → text selection + format toolbar
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(150);
  const box = await cellBox(0, 0);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 6, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(box.x + 6 + i * 8, y); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(350);
  const s = await state();
  eq("drag:in-cell text is selected", s.text.length > 0, true);
  eq("drag:in-cell not a cell-range selection", s.range ?? null, null);
  eq("drag:in-cell format toolbar", s.toolbar, true);
}

await browser.close();
await fetch(`${BASE}/api/pages/${pageId}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});

if (fails.length) {
  console.log(`  ┌─ caret movement / cell selection in tables differs from the original (${fails.length}/${checks}) ─────`);
  for (const f of fails.slice(0, 40)) console.log(`  │ ${f}`);
  if (fails.length > 40) console.log(`  │ … ${fails.length - 40} more`);
  console.log("  └──────────────────────────────────────────────────");
  process.exit(1);
}
console.log(`caret movement / cell-range selection in tables matches the original — ${checks} checks`);
