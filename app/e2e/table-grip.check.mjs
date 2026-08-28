// 표의 행·열 그립 — 회색 선 → 6점 버튼 → 클릭하면 파란색 + 드롭다운.
// 원본에서 잰 값은 fixtures/notion-table-grip.json 에 있다(CDP 로 DOM 을 읽고,
// 색은 전체 스크린샷 픽셀로 확인했다).
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/table-grip.check.mjs
//
// 아직 없는 것: 메뉴의 `색`(셀 배경 저장이 필요하다)과 그립을 끌어 행·열 순서를
// 옮기기. 그래서 메뉴 항목 대조는 원본 목록에서 `색`을 뺀 것과 맞춘다.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-table-grip.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };

const uuid = () => crypto.randomUUID();
const tableId = uuid(), beforeId = uuid();
const CELLS = [["Alpha", "Beta", "Gamma"], ["one", "two", "three"], ["four", "five", "six"]];
const created = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "table-grip.check" }) }).then((r) => r.json());
const pageId = created.page?.id ?? created.id;
if (!pageId) { console.error("페이지를 못 만들었습니다:", created); process.exit(1); }
const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({
  blocks: [
    { id: beforeId, type: "paragraph", content: { text: "before" }, parentBlockId: null, position: 1 },
    { id: tableId, type: "table", content: { table: { cells: CELLS, headerRow: false } }, parentBlockId: null, position: 2 },
  ], deletedIds: [], newIds: [beforeId, tableId] }) });
if (!put.ok) { console.error("블록 저장 실패:", put.status, await put.text()); process.exit(1); }

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
  const sub = document.querySelector(`[data-testid="table-grip-color-menu-${tid}"]`);
  const subInfo = sub ? (() => {
    const sb = sub.getBoundingClientRect(); const ss = getComputedStyle(sub);
    const rows = [...sub.querySelectorAll('[data-testid^="table-grip-color-"]')].map((e) => {
      const q = e.getBoundingClientRect(); const swn = e.firstElementChild; const sq = swn.getBoundingClientRect();
      const lab = e.lastElementChild;
      return { id: e.getAttribute("data-testid").replace(`table-grip-color-`, ""), w: +q.width.toFixed(1), h: +q.height.toFixed(1), y: +q.y.toFixed(1),
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

// ── 1. 회색 선: 포인터가 있는 셀의 행·열만 ──────────────────────────
{
  await clearAll();
  await cell(1, 1).hover();
  await page.waitForTimeout(200);
  const st = await gripState();
  eq("선: 포인터 열만 idle", st.col, ["off", "idle", "off"]);
  eq("선: 포인터 행만 idle", st.row, ["off", "idle", "off"]);
  const s = await shape("col", 1);
  eq("열 선 크기", `${s.line.w}x${s.line.h}`, `${G.line.col.w}x${G.line.col.h}`);
  eq("열 선 색", s.line.bg, G.line.color);
  eq("열 선 라운드", s.line.radius, `${G.line.radius}px`);
  eq("열 선 흰 링", s.line.shadow, `${G.line.ring.color} 0px 0px 0px ${G.line.ring.width}px`);
  const r = await shape("row", 1);
  eq("행 선 크기", `${r.line.w}x${r.line.h}`, `${G.line.row.w}x${G.line.row.h}`);
}

// ── 2. 선 위 호버 → 6점 버튼 ─────────────────────────────────────
{
  await page.locator(gripSel("col", 1)).hover();
  await page.waitForTimeout(200);
  const s = await shape("col", 1);
  eq("열 그립 상태", s.state, "hover");
  if (!s.btn) fails.push("열 6점 버튼: 없음"), checks++;
  else {
    eq("열 버튼 크기", `${s.btn.w}x${s.btn.h}`, `${G.button.col.w}x${G.button.col.h}`);
    eq("열 버튼 배경", s.btn.bg, G.button.bg);
    eq("열 버튼 테두리", s.btn.border, G.button.border);
    eq("열 버튼 라운드", s.btn.radius, `${G.button.radius}px`);
    eq("열 버튼 점 색", s.btn.fill, G.button.dot.color);
    eq("열 버튼 글리프 16", s.btn.svg.w, 16);
    eq("열 버튼 글리프 회전", s.btn.svg.rotate, "matrix(0, 1, -1, 0, 0, 0)");
    eq("열 버튼 트랜지션", s.btn.transition, "opacity, transform 0.1s, 0.1s");
    eq("열 버튼 aria-label", s.btn.label, "열 이동");
  }
  await cell(2, 0).hover();
  await page.waitForTimeout(150);
  await page.locator(gripSel("row", 2)).hover();
  await page.waitForTimeout(200);
  const r = await shape("row", 2);
  eq("행 버튼 크기", `${r.btn.w}x${r.btn.h}`, `${G.button.row.w}x${G.button.row.h}`);
  eq("행 버튼 글리프 회전(없음)", r.btn.svg.rotate, "none");
  eq("행 버튼 aria-label", r.btn.label, "행 이동");
}

// ── 3. 클릭 → 열 전체 선택 + 파란 버튼 + 드롭다운 ──────────────────
{
  await clearAll();
  await cell(0, 1).hover();
  await page.locator(gripSel("col", 1)).hover();
  await page.waitForTimeout(150);
  await page.locator(gripSel("col", 1)).click();
  await page.waitForTimeout(300);
  eq("클릭: 열 전체 선택", await selRange(), `0,1,${CELLS.length - 1},1`);
  const s = await shape("col", 1);
  eq("클릭: 버튼 파란 배경", s.btn.bg, G.button.active.bg);
  eq("클릭: 버튼 파란 테두리", s.btn.border, G.button.active.border);
  eq("클릭: 점 흰색", s.btn.fill, G.button.active.dotColor);
  const m = await menu();
  if (!m) fails.push("클릭: 드롭다운 없음"), checks++;
  else {
    eq("메뉴 폭", m.w, G.menu.width);
    eq("메뉴 라운드", m.radius, `${G.menu.radius}px`);
    eq("메뉴 그림자", m.shadow, G.menu.shadow);
    eq("메뉴 배경", m.bg, G.menu.bg);
    eq("메뉴 검색창", m.search?.ph, G.menu.search.placeholder);
    eq("검색창 글자 크기", m.search?.fs, G.menu.searchArea.inputFontSize);
    eq("목록 패딩", m.listPad, `${G.menu.listPad}px`);
    eq("항목 간격", m.gap, `${G.menu.itemGap}px`);
    eq("메뉴 항목(열)", m.items.map((i) => i.label), G.menu.col);
    eq("항목 폭", m.items[0].w, G.menu.itemWidth);
    eq("항목 높이", m.items[0].h, G.menu.itemHeight);
    eq("항목 라운드", m.items[0].radius, `${G.menu.itemRadius}px`);
    eq("항목 pitch", m.items[1].y - m.items[0].y, G.menu.itemPitch);
 // 아이콘 20 at +8, 라벨 at +36
    const it = m.items[2];
    eq("아이콘 크기", `${it.icon.w}x${it.icon.h}`, `${G.menu.item.iconBox}x${G.menu.item.iconBox}`);
    eq("아이콘 x", it.icon.x - it.x, G.menu.item.iconDx);
    eq("라벨 x", it.lbl.x - it.x, G.menu.item.labelDx);
    eq("라벨 글자 크기", it.lbl.fs, G.menu.item.labelFontSize);
 // ⌘D · 색의 화살표 · 제목 행의 스위치
    const dup = m.items.find((i) => i.label === "복제");
    eq("⌘D 글자 크기", dup.short.fs, G.menu.shortcut.fontSize);
    eq("⌘D 오른쪽 여백", dup.x + dup.w - (dup.short.x + dup.short.w), G.menu.item.accessoryInset);
    const colorItem = m.items.find((i) => i.label === "색");
    eq("색 화살표 크기", colorItem.chev.w, G.menu.chevron.size);
    const hdr = m.items[0];
    eq("스위치 크기", `${hdr.sw.w}x${hdr.sw.h}`, `${G.menu.switch.w}x${G.menu.switch.h}`);
    eq("스위치 꺼짐 색", hdr.sw.bg, G.menu.switch.off);
    eq("스위치 손잡이", `${hdr.sw.knob.w}x${hdr.sw.knob.h}`, `${G.menu.switch.knob}x${G.menu.switch.knob}`);
    eq("스위치 오른쪽 여백", hdr.x + hdr.w - (hdr.sw.x + hdr.sw.w), G.menu.item.accessoryInset);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  eq("Escape 로 메뉴 닫힘", await menu(), null);
}

// ── 3b. `색` 서브메뉴 ───────────────────────────────────────────
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
  if (!m?.sub) fails.push("색 서브메뉴: 안 열림"), checks++;
  else {
    eq("서브 폭", m.sub.w, S.width);
    eq("서브 라운드", m.sub.radius, `${S.radius}px`);
    eq("서브 섹션", m.sub.heads.map((h) => h.txt), S.sections);
    eq("섹션 머리 글자", m.sub.heads[0].fs, S.sectionHeader.fontSize);
    eq("섹션 머리 굵기", m.sub.heads[0].fw, S.sectionHeader.weight);
    eq("색 개수", m.sub.rows.length, S.names.length * 2, 0);
    const first = m.sub.rows[0];
    eq("색 항목 폭", first.w, S.itemW);
    eq("색 항목 높이", first.h, S.itemH);
    eq("스와치 크기", `${first.swatch.w}x${first.swatch.h}`, `${S.swatch.size}x${S.swatch.size}`);
    eq("스와치 라운드", first.swatch.radius, `${S.swatch.radius}px`);
    eq("색 라벨 x", first.labelDx, S.labelDx);
    eq("색 항목 pitch", m.sub.rows[1].y - m.sub.rows[0].y, S.pitch);
  }
 // 파란 배경을 골라 열 전체에 칠해진다
  await page.locator('[data-testid="table-grip-color-bg-blue"]').click();
  await page.waitForTimeout(500);
  const painted = await page.evaluate((tid) => [0, 1, 2].map((r) => {
    const w = document.querySelector(`[data-testid="table-cell-${tid}-${r}-1"]`).parentElement;
    return { cls: w.className.includes("hl-blue"), bg: getComputedStyle(w).backgroundColor };
  }), tableId);
  eq("배경색: 열 전체에 칠해짐", painted.every((p) => p.cls), true);
  eq("배경색: 다른 열은 그대로", await page.evaluate((tid) => getComputedStyle(document.querySelector(`[data-testid="table-cell-${tid}-0-0"]`).parentElement).backgroundColor, tableId), G.noCellFill.cellBackground);
 // 되돌린다
  await clearAll();
  await cell(0, 1).hover();
  await page.locator(gripSel("col", 1)).hover();
  await page.waitForTimeout(120);
  await page.locator(gripSel("col", 1)).click();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="table-grip-menu-item-color"]').hover();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="table-grip-color-bg-default"]').click();
  await page.waitForTimeout(400);
}

// ── 3c. 제목 행 스위치는 메뉴를 닫지 않는다 ──────────────────────
{
  await clearAll();
  await cell(0, 0).hover();
  await page.locator(gripSel("col", 0)).hover();
  await page.waitForTimeout(120);
  await page.locator(gripSel("col", 0)).click();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="table-grip-menu-item-header"]').click();
  await page.waitForTimeout(300);
  const m = await menu();
  eq("제목 행 토글 후에도 메뉴 열림", !!m, G.menu.switch.keepsMenuOpen);
  eq("스위치 켜짐 색", m?.items[0].sw.bg, G.menu.switch.on);
  eq("첫 행이 제목 행이 된다", await page.evaluate((tid) => getComputedStyle(document.querySelector(`[data-testid="table-cell-${tid}-0-0"]`).parentElement).fontWeight, tableId), "500");
  await page.locator('[data-testid="table-grip-menu-item-header"]').click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// ── 4. 행 그립 메뉴 ─────────────────────────────────────────────
{
  await clearAll();
  await cell(1, 0).hover();
  await page.locator(gripSel("row", 1)).hover();
  await page.waitForTimeout(150);
  await page.locator(gripSel("row", 1)).click();
  await page.waitForTimeout(300);
  eq("클릭: 행 전체 선택", await selRange(), `1,0,1,${CELLS[0].length - 1}`);
  const m = await menu();
  eq("메뉴 항목(행)", m?.items.map((i) => i.label), G.menu.row);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// ── 5. 어떤 그립이 켜지나 — 선택의 왼쪽위 셀 + 호버 셀 ─────────────
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
      await page.keyboard.press("Escape"); // 메뉴만 닫고 선택은 남긴다
      await page.mouse.move(20, 700);
      await page.waitForTimeout(250);
    } else if (t.hover === null) { await page.mouse.move(20, 700); await page.waitForTimeout(250); }
    else if (t.hover) { await cell(t.hover[0], t.hover[1]).hover(); await page.waitForTimeout(250); }
    const s = await litStr();
    eq(`선 켜짐(${t.id}) 열`, s.cols, t.cols);
    eq(`선 켜짐(${t.id}) 행`, s.rows, t.rows);
  }
  const bg = await page.evaluate((tid) => getComputedStyle(document.querySelector(`[data-testid="table-cell-${tid}-0-0"]`).parentElement).backgroundColor, tableId);
  eq("고른 셀에 배경 채움 없음", bg, G.noCellFill.cellBackground);
}

// ── 5b. 그립을 끌어서 행·열 옮기기 ───────────────────────────────
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
  if (!mid?.ghost) fails.push("열 이동: 따라오는 복사본 없음"), checks++;
  else {
    eq("고스트 불투명도", mid.ghost.op, String(G.move.ghost.opacity));
    eq("고스트 배경", mid.ghost.bg, G.move.ghost.bg);
    eq("고스트 그림자", mid.ghost.shadow, G.move.ghost.shadow);
    eq("고스트 테두리", mid.ghost.border, G.move.ghost.border.replace("solid ", "solid "));
  }
  if (!mid?.bar) fails.push("열 이동: 드롭 표시선 없음"), checks++;
  else {
    eq("드롭 표시선 두께", mid.bar.w, G.move.dropBar.thickness);
    eq("드롭 표시선 색", mid.bar.bg, G.move.dropBar.color);
  }
  const after = await texts();
  eq("열 이동 결과", after[0].join(","), [before[0][1], before[0][0], before[0][2]].join(","));
  eq("열 이동 뒤에도 선택은 남는다", await selRange(), `0,1,${after.length - 1},1`);

  const b2 = await texts();
  await dragGrip("row", 0, [1, 0]);
  const a2 = await texts();
  eq("행 이동 결과", a2.map((r) => r[0]).join(","), [b2[1][0], b2[0][0], b2[2][0]].join(","));
  eq("행 이동 뒤에도 선택은 남는다", await selRange(), `1,0,1,${a2[0].length - 1}`);

  // 같은 자리면 표시선이 뜨지 않는다
  const same = await dragGrip("col", 1, [0, 1], { checkMid: true });
  eq("같은 자리로 끌면 표시선 없음", same?.bar ?? null, null);
}

// ── 6. 메뉴 동작: 오른쪽에 삽입 / 콘텐츠 삭제 / 삭제 ────────────────
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
  eq("오른쪽에 삽입 → 열 4", (await count()).cols, 4);
  await open("col", 2);
  await page.locator('[data-testid="table-grip-menu-item-delete"]').click();
  await page.waitForTimeout(400);
  eq("삭제 → 열 3", (await count()).cols, 3);
  await open("row", 1);
  await page.locator('[data-testid="table-grip-menu-item-clear"]').click();
  await page.waitForTimeout(500);
  const row1 = await page.evaluate((tid) => [0, 1, 2].map((c) => document.querySelector(`[data-testid="table-cell-${tid}-1-${c}"]`).innerText), tableId);
  eq("콘텐츠 삭제 → 행이 빈다", row1.join("|"), "||");
  await open("row", 1);
  await page.locator('[data-testid="table-grip-menu-item-delete"]').click();
  await page.waitForTimeout(400);
  eq("삭제 → 행 2", (await count()).rows, 2);
}

await browser.close();
await fetch(`${BASE}/api/pages/${pageId}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});

if (fails.length) {
  console.log(`  ┌─ 표 그립이 원본과 다릅니다 (${fails.length}/${checks}) ─────`);
  for (const f of fails.slice(0, 40)) console.log(`  │ ${f}`);
  console.log("  └──────────────────────────────────────────");
  process.exit(1);
}
console.log(`표 행·열 그립(회색 선 → 6점 버튼 → 파란색 + 드롭다운) 원본과 일치 — ${checks}개 체크`);
