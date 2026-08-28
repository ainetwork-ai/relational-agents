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
  const items = [...p.querySelectorAll('[data-testid^="table-grip-menu-item-"]')].map((e) => {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return { label: e.innerText.split("\n")[0].trim(), w: +r.width.toFixed(1), h: +r.height.toFixed(1), radius: s.borderTopLeftRadius, y: +r.y.toFixed(1) };
  });
  const input = p.querySelector("input");
  return { w: +b.width.toFixed(1), items, search: input ? { ph: input.placeholder } : null };
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
    eq("메뉴 검색창", m.search?.ph, G.menu.search.placeholder);
    eq("메뉴 항목(열)", m.items.map((i) => i.label), G.menu.col.filter((l) => l !== "색"));
    eq("항목 폭", m.items[0].w, G.menu.itemWidth);
    eq("항목 높이", m.items[0].h, G.menu.itemHeight);
    eq("항목 라운드", m.items[0].radius, `${G.menu.itemRadius}px`);
    eq("항목 pitch", m.items[1].y - m.items[0].y, G.menu.itemPitch);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  eq("Escape 로 메뉴 닫힘", await menu(), null);
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
  eq("메뉴 항목(행)", m?.items.map((i) => i.label), G.menu.row.filter((l) => l !== "색"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// ── 5. 드래그로 셀을 고르면 걸친 행·열의 선이 모두 켜진다 ──────────
{
  await clearAll();
  const a = await cell(0, 0).boundingBox(), b = await cell(1, 1).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 8, a.y + a.height / 2 + ((b.y - a.y) * i) / 8); await page.waitForTimeout(25); }
  await page.mouse.up();
  await page.waitForTimeout(250);
  const st = await gripState();
  eq("드래그 후 열 선", st.col, ["idle", "idle", "off"]);
  eq("드래그 후 행 선", st.row, ["idle", "idle", "off"]);
  const bg = await page.evaluate((tid) => getComputedStyle(document.querySelector(`[data-testid="table-cell-${tid}-0-0"]`).parentElement).backgroundColor, tableId);
  eq("고른 셀에 배경 채움 없음", bg, G.noCellFill.cellBackground);
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
