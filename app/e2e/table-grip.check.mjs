// Table row/column grips — gray line → 6-dot button → click turns it blue + dropdown.
// Values measured on the original are in src/i18n/content/e2e-fixtures/notion-table-grip.json (DOM read over CDP,
// colors confirmed from full-screenshot pixels).
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/table-grip.check.mjs
//
// Not there yet: the menu's `Color` (needs cell background storage) and dragging a grip to
// reorder rows/columns. So the menu item comparison matches the original list minus `Color`.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-table-grip.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };

const uuid = () => crypto.randomUUID();
const tableId = uuid(), beforeId = uuid();
const CELLS = [["Alpha", "Beta", "Gamma"], ["one", "two", "three"], ["four", "five", "six"]];
const created = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "table-grip.check" }) }).then((r) => r.json());
const pageId = created.page?.id ?? created.id;
if (!pageId) { console.error("Could not create the page:", created); process.exit(1); }
const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({
  blocks: [
    { id: beforeId, type: "paragraph", content: { text: "before" }, parentBlockId: null, position: 1 },
    { id: tableId, type: "table", content: { table: { cells: CELLS, headerRow: false } }, parentBlockId: null, position: 2 },
  ], deletedIds: [], newIds: [beforeId, tableId] }) });
if (!put.ok) { console.error("Saving blocks failed:", put.status, await put.text()); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(`[data-testid="table-cell-${tableId}-0-0"]`, { timeout: 60_000 });

await page.waitForTimeout(400);

const fails = []; let checks = 0;
const eq = (label, got, want, tol = 1) => {
  checks++;
  const ok = typeof want === "number" && typeof got === "number" ? Math.abs(got - want) <= tol : JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails.push(`${label}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
};
/** Insert the items we deliberately added into the measured original list (§menu.ours) */
const withOurs = (measured) => {
  const at = measured.indexOf(G.menu.ours.insertAfter) + 1;
  return [...measured.slice(0, at), ...G.menu.ours.items, ...measured.slice(at)];
};
const cell = (r, c) => page.locator(`[data-testid="table-cell-${tableId}-${r}-${c}"]`);
const gripSel = (kind, i) => `[data-testid="table-grip-${kind}-${tableId}-${i}"]`;
const litStr = async () => {
  const st = await gripState();
  return { cols: st.col.map((x) => (x === "off" ? "0" : "1")).join(""), rows: st.row.map((x) => (x === "off" ? "0" : "1")).join("") };
};
const gripState = () => page.evaluate((tid) => {
  const out = { col: [], row: [] };
  for (const kind of ["col", "row"]) {
    for (let i = 0; i < 8; i++) {
      const el = document.querySelector(`[data-testid="table-grip-${kind}-${tid}-${i}"]`);
      if (!el) break;
      out[kind].push(el.getAttribute("data-state"));
    }
  }
  return out;
}, tableId);
const shape = (kind, i) => page.evaluate(({ tid, kind, i }) => {
  const el = document.querySelector(`[data-testid="table-grip-${kind}-${tid}-${i}"]`);
  if (!el) return null;
  const line = el.querySelector(`[data-testid$="-line"]`);
  const btn = el.querySelector("button");
  const R = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const cellBox = document.querySelector(`[data-testid="table-cell-${tid}-0-0"]`).closest("div[class*='relative']").getBoundingClientRect();
  const out = { state: el.getAttribute("data-state"), cell0: { x: +cellBox.x.toFixed(1), y: +cellBox.y.toFixed(1) } };
  if (line) { const s = getComputedStyle(line); out.line = { ...R(line), bg: s.backgroundColor, radius: s.borderTopLeftRadius, shadow: s.boxShadow }; }
  if (btn) { const s = getComputedStyle(btn); const svg = btn.querySelector("svg");
    out.btn = { ...R(btn), bg: s.backgroundColor, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, radius: s.borderTopLeftRadius,
      fill: getComputedStyle(svg).fill, svg: svg ? { w: svg.getBoundingClientRect().width, rotate: getComputedStyle(svg).transform } : null,
      transition: s.transitionProperty + " " + s.transitionDuration, label: btn.getAttribute("aria-label") }; }
  return out;
}, { tid: tableId, kind, i });
const menu = () => page.evaluate((tid) => {
  const p = document.querySelector(`[data-testid="table-grip-menu-${tid}"]`);
  if (!p) return null;
  const b = p.getBoundingClientRect();
  const ps = getComputedStyle(p);
  const items = [...p.querySelectorAll('[data-testid^="table-grip-menu-item-"]')].map((e) => {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    const icon = e.querySelector("svg");
    const label = [...e.querySelectorAll("span")].find((n) => n.textContent.trim() && !n.dataset.testid);
    const short = [...e.querySelectorAll("span")].find((n) => /⌘/.test(n.textContent));
    const chev = [...e.querySelectorAll("svg")][1];
    const sw = e.querySelector(`[data-testid^="table-grip-menu-switch-"]`);
    const box = (n) => { if (!n) return null; const q = n.getBoundingClientRect(); const cs = getComputedStyle(n);
      return { x: +q.x.toFixed(1), y: +q.y.toFixed(1), w: +q.width.toFixed(1), h: +q.height.toFixed(1), fs: cs.fontSize, color: cs.color, bg: cs.backgroundColor, radius: cs.borderTopLeftRadius }; };
    return { label: e.innerText.split("\n")[0].trim(), x: +r.x.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), radius: s.borderTopLeftRadius, y: +r.y.toFixed(1),
      icon: box(icon), lbl: box(label), short: box(short), chev: box(chev),
      sw: sw ? { ...box(sw), on: sw.getAttribute("data-on"), knob: box(sw.firstElementChild) } : null };
  });
  const input = p.querySelector("input");
  const inputBox = input ? { ...(() => { const q = input.getBoundingClientRect(); const cs = getComputedStyle(input); return { fs: cs.fontSize, y: +q.y.toFixed(1) }; })(), ph: input.placeholder } : null;
  const list = p.querySelector('[role="listbox"]');
  const sub = document.querySelector(`[data-testid="table-grip-color-menu-${tid}"], [data-testid="table-grip-align-menu-${tid}"]`);
  const subInfo = sub ? (() => {
    const sb = sub.getBoundingClientRect(); const ss = getComputedStyle(sub);
    const rows = [...sub.querySelectorAll('[data-testid^="table-grip-opt-"]')].map((e) => {
      const q = e.getBoundingClientRect(); const swn = e.firstElementChild; const sq = swn.getBoundingClientRect();
      const lab = e.lastElementChild;
      return { id: e.getAttribute("data-testid").replace(`table-grip-opt-`, ""), w: +q.width.toFixed(1), h: +q.height.toFixed(1), y: +q.y.toFixed(1),
        swatch: { w: +sq.width.toFixed(1), h: +sq.height.toFixed(1), radius: getComputedStyle(swn).borderTopLeftRadius, color: getComputedStyle(swn).color, bg: getComputedStyle(swn).backgroundColor },
        labelDx: +(lab.getBoundingClientRect().x - q.x).toFixed(1) };
    });
    const heads = [...sub.children].flatMap((sec) => [...sec.children]).filter((e) => !e.getAttribute("data-testid")).map((e) => {
      const cs = getComputedStyle(e); return { txt: e.textContent.trim(), fs: cs.fontSize, fw: cs.fontWeight };
    });
    return { w: +sb.width.toFixed(1), radius: ss.borderTopLeftRadius, rows, heads };
  })() : null;
  return { w: +b.width.toFixed(1), radius: ps.borderTopLeftRadius, shadow: ps.boxShadow, bg: ps.backgroundColor,
    items, search: inputBox, listPad: list ? getComputedStyle(list).padding : null, gap: list ? getComputedStyle(list).gap : null, sub: subInfo };
}, tableId);
const selRange = () => page.evaluate((tid) => document.querySelector(`[data-testid="table-selection-${tid}"]`)?.getAttribute("data-range") ?? null, tableId);
const clearAll = async () => {
  await page.mouse.move(20, 700);
  await page.locator(`[data-testid="block-editable-${beforeId}"]`).click();
  await page.keyboard.press("Escape");
  await page.mouse.move(20, 700);
  await page.waitForTimeout(150);
};

// ── 1. Gray line: only the row/column of the cell under the pointer ──────────────────────────
{
  await clearAll();
  await cell(1, 1).hover();
  await page.waitForTimeout(200);
  const st = await gripState();
  eq("line: only pointer column idle", st.col, ["off", "idle", "off"]);
  eq("line: only pointer row idle", st.row, ["off", "idle", "off"]);
  const s = await shape("col", 1);
  eq("col line size", `${s.line.w}x${s.line.h}`, `${G.line.col.w}x${G.line.col.h}`);
  eq("col line color", s.line.bg, G.line.color);
  eq("col line radius", s.line.radius, `${G.line.radius}px`);
  eq("col line white ring", s.line.shadow, `${G.line.ring.color} 0px 0px 0px ${G.line.ring.width}px`);
  const r = await shape("row", 1);
  eq("row line size", `${r.line.w}x${r.line.h}`, `${G.line.row.w}x${G.line.row.h}`);
}

// ── 2. Hover on the line → 6-dot button ─────────────────────────────────────
{
  await page.locator(gripSel("col", 1)).hover();
  await page.waitForTimeout(200);
  const s = await shape("col", 1);
  eq("col grip state", s.state, "hover");
  if (!s.btn) fails.push("col 6-dot button: missing"), checks++;
  else {
    eq("col button size", `${s.btn.w}x${s.btn.h}`, `${G.button.col.w}x${G.button.col.h}`);
    eq("col button background", s.btn.bg, G.button.bg);
    eq("col button border", s.btn.border, G.button.border);
    eq("col button radius", s.btn.radius, `${G.button.radius}px`);
    eq("col button dot color", s.btn.fill, G.button.dot.color);
    eq("col button glyph 16", s.btn.svg.w, 16);
    eq("col button glyph rotation", s.btn.svg.rotate, "matrix(0, 1, -1, 0, 0, 0)");
    eq("col button transition", s.btn.transition, "opacity, transform 0.1s, 0.1s");
    eq("col button aria-label", s.btn.label, ko("Move column"));
  }
  await cell(2, 0).hover();
  await page.waitForTimeout(150);
  await page.locator(gripSel("row", 2)).hover();
  await page.waitForTimeout(200);
  const r = await shape("row", 2);
  eq("row button size", `${r.btn.w}x${r.btn.h}`, `${G.button.row.w}x${G.button.row.h}`);
  eq("row button glyph rotation (none)", r.btn.svg.rotate, "none");
  eq("row button aria-label", r.btn.label, ko("Move row"));
}

// ── 3. Click → whole column selected + blue button + dropdown ──────────────────
{
  await clearAll();
  await cell(0, 0).hover();
  await page.locator(gripSel("col", 0)).hover();
  await page.waitForTimeout(150);
  await page.locator(gripSel("col", 0)).click();
  await page.waitForTimeout(300);
  eq("click: whole column selected", await selRange(), `0,0,${CELLS.length - 1},0`);
  const s = await shape("col", 0);
  eq("click: button blue background", s.btn.bg, G.button.active.bg);
  eq("click: button blue border", s.btn.border, G.button.active.border);
  eq("click: dots white", s.btn.fill, G.button.active.dotColor);
  const m = await menu();
  if (!m) fails.push("click: no dropdown"), checks++;
  else {
    eq("menu width", m.w, G.menu.width);
    eq("menu radius", m.radius, `${G.menu.radius}px`);
    eq("menu shadow", m.shadow, G.menu.shadow);
    eq("menu background", m.bg, G.menu.bg);
    eq("menu search box", m.search?.ph, G.menu.search.placeholder);
    eq("search box font size", m.search?.fs, G.menu.searchArea.inputFontSize);
    eq("list padding", m.listPad, `${G.menu.listPad}px`);
    eq("item gap", m.gap, `${G.menu.itemGap}px`);
    eq("menu items (col) = original + our Align", m.items.map((i) => i.label), withOurs(G.menu.col));
    eq("item width", m.items[0].w, G.menu.itemWidth);
    eq("item height", m.items[0].h, G.menu.itemHeight);
    eq("item radius", m.items[0].radius, `${G.menu.itemRadius}px`);
    eq("item pitch", m.items[1].y - m.items[0].y, G.menu.itemPitch);
 // icon 20 at +8, label at +36
    const it = m.items[2];
    eq("icon size", `${it.icon.w}x${it.icon.h}`, `${G.menu.item.iconBox}x${G.menu.item.iconBox}`);
    eq("icon x", it.icon.x - it.x, G.menu.item.iconDx);
    eq("label x", it.lbl.x - it.x, G.menu.item.labelDx);
    eq("label font size", it.lbl.fs, G.menu.item.labelFontSize);
 // ⌘D · Color's arrow · the header row's switch
    const dup = m.items.find((i) => i.label === ko("Duplicate"));
    eq("⌘D font size", dup.short.fs, G.menu.shortcut.fontSize);
    eq("⌘D right inset", dup.x + dup.w - (dup.short.x + dup.short.w), G.menu.item.accessoryInset);
    const colorItem = m.items.find((i) => i.label === ko("Color"));
    eq("Color arrow size", colorItem.chev.w, G.menu.chevron.size);
    const hdr = m.items[0];
    eq("switch size", `${hdr.sw.w}x${hdr.sw.h}`, `${G.menu.switch.w}x${G.menu.switch.h}`);
    eq("switch off color", hdr.sw.bg, G.menu.switch.off);
    eq("switch knob", `${hdr.sw.knob.w}x${hdr.sw.knob.h}`, `${G.menu.switch.knob}x${G.menu.switch.knob}`);
    eq("switch right inset", hdr.x + hdr.w - (hdr.sw.x + hdr.sw.w), G.menu.item.accessoryInset);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  eq("Escape closes the menu", await menu(), null);
}

// ── 3b. `Color` submenu ───────────────────────────────────────────
{
  await clearAll();
  await cell(0, 1).hover();
  await page.locator(gripSel("col", 1)).hover();
  await page.waitForTimeout(120);
  await page.locator(gripSel("col", 1)).click();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="table-grip-menu-item-color"]').hover();
  await page.waitForTimeout(300);
  const m = await menu();
  const S = G.colorSubmenu;
  if (!m?.sub) fails.push("Color submenu: did not open"), checks++;
  else {
    eq("submenu width", m.sub.w, S.width);
    eq("submenu radius", m.sub.radius, `${S.radius}px`);
    eq("submenu sections", m.sub.heads.map((h) => h.txt), S.sections);
    eq("section header font size", m.sub.heads[0].fs, S.sectionHeader.fontSize);
    eq("section header weight", m.sub.heads[0].fw, S.sectionHeader.weight);
    eq("color count", m.sub.rows.length, S.names.length * 2, 0);
    const first = m.sub.rows[0];
    eq("color item width", first.w, S.itemW);
    eq("color item height", first.h, S.itemH);
    eq("swatch size", `${first.swatch.w}x${first.swatch.h}`, `${S.swatch.size}x${S.swatch.size}`);
    eq("swatch radius", first.swatch.radius, `${S.swatch.radius}px`);
    eq("color label x", first.labelDx, S.labelDx);
    eq("color item pitch", m.sub.rows[1].y - m.sub.rows[0].y, S.pitch);
  }
 // picking the blue background paints the whole column
  await page.locator('[data-testid="table-grip-opt-bg-blue"]').click();
  await page.waitForTimeout(500);
  const painted = await page.evaluate((tid) => [0, 1, 2].map((r) => {
    const w = document.querySelector(`[data-testid="table-cell-${tid}-${r}-1"]`).parentElement;
    return { cls: w.className.includes("hl-blue"), bg: getComputedStyle(w).backgroundColor };
  }), tableId);
  eq("background: whole column painted", painted.every((p) => p.cls), true);
  eq("background: other columns unchanged", await page.evaluate((tid) => getComputedStyle(document.querySelector(`[data-testid="table-cell-${tid}-0-0"]`).parentElement).backgroundColor, tableId), G.noCellFill.cellBackground);
 // revert
  await clearAll();
  await cell(0, 1).hover();
  await page.locator(gripSel("col", 1)).hover();
  await page.waitForTimeout(120);
  await page.locator(gripSel("col", 1)).click();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="table-grip-menu-item-color"]').hover();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="table-grip-opt-bg-default"]').click();
  await page.waitForTimeout(400);
}

// ── 3d. Align (not in the original, our addition — §menu.ours) ───────────
{
  const O = G.menu.ours.submenu;
  const alignOf = (r, c) => page.evaluate(({ tid, r, c }) => {
    const el = document.querySelector(`[data-testid="table-cell-${tid}-${r}-${c}"]`);
 // the browser default comes out as start/end — normalize to left/right
    const v = getComputedStyle(el.parentElement).textAlign;
    return v === "start" ? "left" : v === "end" ? "right" : v;
  }, { tid: tableId, r, c });
  const openMenu = async (kind, i) => {
    await clearAll();
    await cell(kind === "col" ? 0 : i, kind === "col" ? i : 0).hover();
    await page.locator(gripSel(kind, i)).hover();
    await page.waitForTimeout(120);
    await page.locator(gripSel(kind, i)).click();
    await page.waitForTimeout(250);
  };

  await openMenu("col", 1);
  await page.locator('[data-testid="table-grip-menu-item-align"]').hover();
  await page.waitForTimeout(300);
  const m = await menu();
  if (!m?.sub) fails.push("Align submenu: did not open"), checks++;
  else {
    eq("Align submenu width", m.sub.w, G.colorSubmenu.width);
    eq("Align submenu radius", m.sub.radius, `${G.colorSubmenu.radius}px`);
    eq("Align section title", m.sub.heads.map((h) => h.txt), [O.title]);
    eq("Align has 3 items", m.sub.rows.length, O.options.length, 0);
    eq("Align item width", m.sub.rows[0].w, G.colorSubmenu.itemW);
    eq("Align item pitch", m.sub.rows[1].y - m.sub.rows[0].y, G.colorSubmenu.pitch);
    eq("Align preview tile", `${m.sub.rows[0].swatch.w}x${m.sub.rows[0].swatch.h}`, `${G.colorSubmenu.swatch.size}x${G.colorSubmenu.swatch.size}`);
  }
  eq("default is left", await alignOf(1, 1), "left");
 // apply center alignment to column 1
  await page.locator('[data-testid="table-grip-opt-align-center"]').click();
  await page.waitForTimeout(450);
  eq("col align: that column is centered", await Promise.all([0, 1, 2].map((r) => alignOf(r, 1))), ["center", "center", "center"]);
  eq("col align: other columns unchanged", await alignOf(0, 0), "left");
 // right-align row 1 — it is a per-cell grid, so it layers over the column alignment
  await openMenu("row", 1);
  await page.locator('[data-testid="table-grip-menu-item-align"]').hover();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="table-grip-opt-align-right"]').click();
  await page.waitForTimeout(450);
  eq("row align: that row is right", await Promise.all([0, 1, 2].map((c) => alignOf(1, c))), ["right", "right", "right"]);
  eq("row align: other rows keep the column alignment", await alignOf(0, 1), "center");
 // the current value gets a check mark
  await openMenu("col", 1);
  await page.locator('[data-testid="table-grip-menu-item-align"]').hover();
  await page.waitForTimeout(250);
  eq("current value marked", await page.evaluate(() => document.querySelector('[data-testid="table-grip-opt-align-center"]')?.getAttribute("data-on")), "1");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
 // survives a reload
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-testid="table-cell-${tableId}-0-0"]`);
  await page.waitForTimeout(600);
  eq("alignment kept after reload", await alignOf(0, 1), "center");
 // revert (later sections expect left alignment)
  for (const [kind, i] of [["col", 1], ["row", 1]]) {
    await openMenu(kind, i);
    await page.locator('[data-testid="table-grip-menu-item-align"]').hover();
    await page.waitForTimeout(250);
    await page.locator('[data-testid="table-grip-opt-align-left"]').click();
    await page.waitForTimeout(400);
  }
  eq("reverted to left", await alignOf(1, 1), "left");
}

// ── 4. Row grip menu ─────────────────────────────────────────────
{
  await clearAll();
  await cell(0, 0).hover();
  await page.locator(gripSel("row", 0)).hover();
  await page.waitForTimeout(150);
  await page.locator(gripSel("row", 0)).click();
  await page.waitForTimeout(300);
  eq("click: whole row selected", await selRange(), `0,0,0,${CELLS[0].length - 1}`);
  const m = await menu();
  eq("menu items (row) = original + our Align", m?.items.map((i) => i.label), withOurs(G.menu.row));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// ── 5. Which grips light up — selection's top-left cell + hovered cell ─────────────
{
  const dragCells = async (from, to) => {
    const a = await cell(from[0], from[1]).boundingBox(), b = await cell(to[0], to[1]).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 8, a.y + a.height / 2 + ((b.y - a.y) * i) / 8); await page.waitForTimeout(25); }
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  for (const t of G.lit.cases) {
    if (t.drag) { await clearAll(); await dragCells(t.drag[0], t.drag[1]); }
    else if (t.click) { await clearAll(); await cell(t.click[0], t.click[1]).click(); await page.waitForTimeout(200); await page.mouse.move(20, 700); await page.waitForTimeout(200); }
    else if (t.gripCol != null) {
      await clearAll();
      await cell(0, t.gripCol).hover();
      await page.locator(gripSel("col", t.gripCol)).hover();
      await page.waitForTimeout(120);
      await page.locator(gripSel("col", t.gripCol)).click();
      await page.waitForTimeout(250);
      await page.keyboard.press("Escape"); // close only the menu, keep the selection
      await page.mouse.move(20, 700);
      await page.waitForTimeout(250);
    } else if (t.hover === null) { await page.mouse.move(20, 700); await page.waitForTimeout(250); }
    else if (t.hover) { await cell(t.hover[0], t.hover[1]).hover(); await page.waitForTimeout(250); }
    const s = await litStr();
    eq(`lines lit (${t.id}) cols`, s.cols, t.cols);
    eq(`lines lit (${t.id}) rows`, s.rows, t.rows);
  }
  const bg = await page.evaluate((tid) => getComputedStyle(document.querySelector(`[data-testid="table-cell-${tid}-0-0"]`).parentElement).backgroundColor, tableId);
  eq("no background fill on selected cells", bg, G.noCellFill.cellBackground);
}

// ── 5b. Drag a grip to move rows/columns ───────────────────────────────
{
  const texts = () => page.evaluate((tid) => {
    const rows = [];
    for (let r = 0; ; r++) {
      const row = [];
      for (let c = 0; ; c++) {
        const el = document.querySelector(`[data-testid="table-cell-${tid}-${r}-${c}"]`);
        if (!el) break;
        row.push(el.innerText);
      }
      if (!row.length) break;
      rows.push(row);
    }
    return rows;
  }, tableId);
  const dragGrip = async (kind, i, toCell, { checkMid = false } = {}) => {
    await clearAll();
    await cell(kind === "col" ? 0 : i, kind === "col" ? i : 0).hover();
    const grip = page.locator(gripSel(kind, i));
    await grip.hover();
    await page.waitForTimeout(120);
    const gb = await grip.boundingBox();
    const tb = await cell(toCell[0], toCell[1]).boundingBox();
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    const to = { x: kind === "col" ? tb.x + tb.width / 2 : gb.x + gb.width / 2, y: kind === "row" ? tb.y + tb.height / 2 : gb.y + gb.height / 2 };
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(gb.x + gb.width / 2 + ((to.x - gb.x - gb.width / 2) * k) / 10, gb.y + gb.height / 2 + ((to.y - gb.y - gb.height / 2) * k) / 10);
      await page.waitForTimeout(30);
    }
    let mid = null;
    if (checkMid) mid = await page.evaluate((tid) => {
      const R = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
      const gh = document.querySelector(`[data-testid="table-move-ghost-${tid}"]`);
      const bar = document.querySelector(`[data-testid="table-drop-bar-${tid}"]`);
      const gs = gh && getComputedStyle(gh), bs = bar && getComputedStyle(bar);
      return {
        ghost: gh ? { ...R(gh), op: gs.opacity, bg: gs.backgroundColor, shadow: gs.boxShadow, border: `${gs.borderTopWidth} ${gs.borderTopStyle} ${gs.borderTopColor}` } : null,
        bar: bar && bs.display !== "none" ? { ...R(bar), bg: bs.backgroundColor } : null,
      };
    }, tableId);
    await page.mouse.up();
    await page.waitForTimeout(500);
    return mid;
  };

  const before = await texts();
  const mid = await dragGrip("col", 0, [0, 1], { checkMid: true });
  if (!mid?.ghost) fails.push("col move: no following copy"), checks++;
  else {
    eq("ghost opacity", mid.ghost.op, String(G.move.ghost.opacity));
    eq("ghost background", mid.ghost.bg, G.move.ghost.bg);
    eq("ghost shadow", mid.ghost.shadow, G.move.ghost.shadow);
    eq("ghost border", mid.ghost.border, G.move.ghost.border.replace("solid ", "solid "));
  }
  if (!mid?.bar) fails.push("col move: no drop indicator"), checks++;
  else {
    eq("drop indicator thickness", mid.bar.w, G.move.dropBar.thickness);
    eq("drop indicator color", mid.bar.bg, G.move.dropBar.color);
  }
  const after = await texts();
  eq("col move result", after[0].join(","), [before[0][1], before[0][0], before[0][2]].join(","));
  eq("selection stays after col move", await selRange(), `0,1,${after.length - 1},1`);

  const b2 = await texts();
  await dragGrip("row", 0, [1, 0]);
  const a2 = await texts();
  eq("row move result", a2.map((r) => r[0]).join(","), [b2[1][0], b2[0][0], b2[2][0]].join(","));
  eq("selection stays after row move", await selRange(), `1,0,1,${a2[0].length - 1}`);

  // no indicator when dropping on the same spot
  const same = await dragGrip("col", 1, [0, 1], { checkMid: true });
  eq("no indicator when dragged to the same spot", same?.bar ?? null, null);
}

// ── 6. Menu actions: Insert right / Clear contents / Delete ────────────────
{
  const count = () => page.evaluate((tid) => {
    const ids = [...document.querySelectorAll(`[data-testid^="table-cell-${tid}-"]`)].map((e) => e.getAttribute("data-testid").split("-").slice(-2).map(Number));
    return { rows: Math.max(...ids.map((i) => i[0])) + 1, cols: Math.max(...ids.map((i) => i[1])) + 1 };
  }, tableId);
  const open = async (kind, i) => {
    await clearAll();
    await cell(kind === "col" ? 0 : i, kind === "col" ? i : 0).hover();
    await page.locator(gripSel(kind, i)).hover();
    await page.waitForTimeout(150);
    await page.locator(gripSel(kind, i)).click();
    await page.waitForTimeout(250);
  };
  await open("col", 1);
  await page.locator('[data-testid="table-grip-menu-item-after"]').click();
  await page.waitForTimeout(400);
  eq("Insert right → 4 cols", (await count()).cols, 4);
  await open("col", 2);
  await page.locator('[data-testid="table-grip-menu-item-delete"]').click();
  await page.waitForTimeout(400);
  eq("Delete → 3 cols", (await count()).cols, 3);
  await open("row", 1);
  await page.locator('[data-testid="table-grip-menu-item-clear"]').click();
  await page.waitForTimeout(500);
  const row1 = await page.evaluate((tid) => [0, 1, 2].map((c) => document.querySelector(`[data-testid="table-cell-${tid}-1-${c}"]`).innerText), tableId);
  eq("Clear contents → row is empty", row1.join("|"), "||");
  await open("row", 1);
  await page.locator('[data-testid="table-grip-menu-item-delete"]').click();
  await page.waitForTimeout(400);
  eq("Delete → 2 rows", (await count()).rows, 2);
}

// ── 6b. Structural edits carry color/alignment along (regression) ──────────────
// It broke once: `Insert left` shifted only cells, so the color stayed on the new empty column and the
// original column came out bare on the right. Now every structural edit goes through
// lib/editor/table-data.ts, so the grids move together.
{
  const grid = () => page.evaluate((tid) => {
    const rows = [];
    for (let r = 0; ; r++) {
      const row = [];
      for (let c = 0; ; c++) {
        const el = document.querySelector(`[data-testid="table-cell-${tid}-${r}-${c}"]`);
        if (!el) break;
        const w = el.parentElement;
        const a = getComputedStyle(w).textAlign;
        row.push(`${el.innerText || "∅"}/${w.className.match(/hl-\w+/)?.[0]?.slice(3) ?? "-"}/${a === "start" ? "left" : a === "end" ? "right" : a}`);
      }
      if (!row.length) break;
      rows.push(row.join(" "));
    }
    return rows;
  }, tableId);
  const open = async (kind, i) => {
    await clearAll();
    await cell(kind === "col" ? 0 : i, kind === "col" ? i : 0).hover();
    await page.locator(gripSel(kind, i)).hover();
    await page.waitForTimeout(120);
    await page.locator(gripSel(kind, i)).click();
    await page.waitForTimeout(250);
  };
  const pick = async (item, opt) => {
    await page.locator(`[data-testid="table-grip-menu-item-${item}"]`).hover();
    await page.waitForTimeout(250);
    await page.locator(`[data-testid="table-grip-opt-${opt}"]`).click();
    await page.waitForTimeout(450);
  };

 // column 1 to blue background + center
  await open("col", 1);
  await pick("color", "bg-blue");
  await open("col", 1);
  await pick("align", "align-center");
  let g0 = await grid();
  eq("setup: only col 1 blue/center", g0[0].split(" ")[1].split("/").slice(1).join("/"), "blue/center");

 // Insert left → new column is bare, color moves right with the original column
  await open("col", 1);
  await page.locator('[data-testid="table-grip-menu-item-before"]').click();
  await page.waitForTimeout(500);
  let g = await grid();
  eq("Insert left: new col (1) is bare", g[0].split(" ")[1], "∅/-/left");
  eq("Insert left: color/align on the shifted col (2)", g[0].split(" ")[2].split("/").slice(1).join("/"), "blue/center");
  eq("Insert left: text is in that col too", g[0].split(" ")[2].split("/")[0], g0[0].split(" ")[1].split("/")[0]);

 // Insert right → color stays put, new column on the right
  await open("col", 2);
  await page.locator('[data-testid="table-grip-menu-item-after"]').click();
  await page.waitForTimeout(500);
  g = await grid();
  eq("Insert right: color stays on col 2", g[0].split(" ")[2].split("/").slice(1).join("/"), "blue/center");
  eq("Insert right: new col (3) is bare", g[0].split(" ")[3], "∅/-/left");

 // Duplicate → the copy has the color/alignment too
  await open("col", 2);
  await page.locator('[data-testid="table-grip-menu-item-duplicate"]').click();
  await page.waitForTimeout(500);
  g = await grid();
  eq("Duplicate: copy is blue/center too", g[0].split(" ")[3].split("/").slice(1).join("/"), "blue/center");
  eq("Duplicate: same content too", g[0].split(" ")[3].split("/")[0], g[0].split(" ")[2].split("/")[0]);

 // Delete → remaining columns' colors do not shift out of place
  await open("col", 0);
  await page.locator('[data-testid="table-grip-menu-item-delete"]').click();
  await page.waitForTimeout(500);
  g = await grid();
  eq("Delete: blue col moves one to the left", g[0].split(" ")[1].split("/").slice(1).join("/"), "blue/center");
  eq("Delete: the col to its left is bare", g[0].split(" ")[0], "∅/-/left");

 // dragging a grip carries the color along
  await clearAll();
  await cell(0, 1).hover();
  const grip = page.locator(gripSel("col", 1));
  await grip.hover();
  await page.waitForTimeout(120);
  const gb = await grip.boundingBox();
  const last = (await grid())[0].split(" ").length - 1;
  const tb = await cell(0, last).boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(gb.x + gb.width / 2 + ((tb.x + tb.width / 2 - gb.x - gb.width / 2) * k) / 10, gb.y + gb.height / 2); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(500);
  g = await grid();
  eq("move: color/align move along", g[0].split(" ")[last].split("/").slice(1).join("/"), "blue/center");

 // same rule for rows
  await open("row", 1);
  await pick("color", "bg-red");
  g0 = await grid();
  eq("setup: row 1 is red", g0[1].split(" ").every((cellStr) => cellStr.split("/")[1] === "red"), true);
  await open("row", 1);
  await page.locator('[data-testid="table-grip-menu-item-before"]').click();
  await page.waitForTimeout(500);
  g = await grid();
  eq("Insert above: new row is bare", g[1].split(" ").every((cellStr) => cellStr.endsWith("/-/left")), true);
  eq("Insert above: red moves to the row below", g[2].split(" ").every((cellStr) => cellStr.split("/")[1] === "red"), true);

 // reset color/alignment (later sections see a plain table)
 // color is per cell, so sweeping every column covers every cell
  const width = (await grid())[0].split(" ").length;
  for (let i = 0; i < width; i++) {
    await open("col", i);
    await pick("color", "bg-default");
    await open("col", i);
    await pick("align", "align-left");
  }
  eq("reverted: no color/alignment", (await grid()).join(" ").includes("/blue/") || (await grid()).join(" ").includes("/red/"), false);
}

// ── 7. Header toggle: only on the first row/column grip, each for its own axis ────────────
{
  /** per-cell (bold, has background) map */
  const look = () => page.evaluate((tid) => {
    const out = [];
    for (let r = 0; ; r++) {
      const row = [];
      for (let c = 0; ; c++) {
        const el = document.querySelector(`[data-testid="table-cell-${tid}-${r}-${c}"]`);
        if (!el) break;
        const w = el.parentElement;
        const ws = getComputedStyle(w);
        row.push((parseInt(getComputedStyle(el).fontWeight, 10) >= 500 || parseInt(ws.fontWeight, 10) >= 500 ? "B" : ".") +
          (ws.backgroundColor === "rgba(0, 0, 0, 0)" ? "." : "G"));
      }
      if (!row.length) break;
      out.push(row.join(" "));
    }
    return out;
  }, tableId);
  const open = async (kind, i) => {
    await clearAll();
    await cell(kind === "col" ? 0 : i, kind === "col" ? i : 0).hover();
    await page.locator(gripSel(kind, i)).hover();
    await page.waitForTimeout(120);
    await page.locator(gripSel(kind, i)).click();
    await page.waitForTimeout(250);
  };
  const H = G.menu.headerItem;
  const dim = async () => (await look()).length ? { rows: (await look()).length, cols: (await look())[0].split(" ").length } : { rows: 0, cols: 0 };
  const map = ({ rows, cols }, kind) =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const head = (kind === "col" && c === 0) || (kind === "row" && r === 0) || (kind === "both" && (c === 0 || r === 0));
        return head ? "BG" : "..";
      }).join(" ")
    );

  await open("col", 1);
  let m = await menu();
  eq("col 1 menu has no header toggle", m.items.length, H.itemCountWithout + G.menu.ours.items.length, 0);
  eq("col 1 menu first item", m.items[0].label, ko("Color"));
  await page.keyboard.press("Escape");

  await open("col", 0);
  m = await menu();
  eq("col 0 menu has the header toggle", m.items.length, H.itemCountWith + G.menu.ours.items.length, 0);
  eq("header toggle label", m.items[0].label, H.label);
  await page.locator('[data-testid="table-grip-menu-item-header"]').click();
  await page.waitForTimeout(350);
  m = await menu();
  eq("menu stays open after header toggle", !!m, G.menu.switch.keepsMenuOpen);
  eq("switch on color", m?.items[0].sw.bg, G.menu.switch.on);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  eq("col 0 toggle → first col is header", await look(), map(await dim(), "col"));
  const hb = await page.evaluate((tid) => getComputedStyle(document.querySelector(`[data-testid="table-cell-${tid}-0-0"]`).parentElement).backgroundColor, tableId);
  eq("header cell background", hb, G.headerCell.bg);
  eq("header cell weight", await page.evaluate((tid) => getComputedStyle(document.querySelector(`[data-testid="table-cell-${tid}-0-0"]`).parentElement).fontWeight, tableId), G.headerCell.fontWeight);

  await open("row", 0);
  await page.locator('[data-testid="table-grip-menu-item-header"]').click();
  await page.waitForTimeout(350);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  eq("row 0 toggle → first row is header too (independent)", await look(), map(await dim(), "both"));

 // tied to the position: deleting the first row makes the new first row the header
  await open("row", 0);
  await page.locator('[data-testid="table-grip-menu-item-delete"]').click();
  await page.waitForTimeout(450);
  eq("after deleting first row the new first row is header", await look(), map(await dim(), "both"));

 // moving the first column right leaves the header in place
  await clearAll();
  await cell(0, 0).hover();
  const grip = page.locator(gripSel("col", 0));
  await grip.hover();
  await page.waitForTimeout(120);
  const gb = await grip.boundingBox(), tb = await cell(0, 2).boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(gb.x + gb.width / 2 + ((tb.x + tb.width / 2 - gb.x - gb.width / 2) * k) / 10, gb.y + gb.height / 2); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(500);
  eq("header stays in place when first col moves", await look(), map(await dim(), "both"));

 // restore (turn both headers off)
  for (const kind of ["col", "row"]) {
    await open(kind, 0);
    await page.locator('[data-testid="table-grip-menu-item-header"]').click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  eq("both off → plain table", (await look()).join("/").includes("G"), false);
}


await browser.close();
await fetch(`${BASE}/api/pages/${pageId}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});

if (fails.length) {
  console.log(`  ┌─ table grips differ from the original (${fails.length}/${checks}) ─────`);
  for (const f of fails.slice(0, 40)) console.log(`  │ ${f}`);
  console.log("  └──────────────────────────────────────────");
  process.exit(1);
}
console.log(`table row/col grips (gray line → 6-dot button → blue + dropdown) match the original — ${checks} checks`);
