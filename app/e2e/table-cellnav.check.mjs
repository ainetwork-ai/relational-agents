// 표 블록 안에서의 캐럿 이동(방향키·Tab)과 셀 범위 선택(드래그·Shift+방향키)을
// 원본에서 잰 값(fixtures/notion-table-cellnav.json)과 대조한다.
//
// 원본은 CDP 로 노션 '표' 블록을 직접 두드려서 쟀다(2026-08-28, 테이블 테스트 페이지).
// 규칙 요약:
//   · 텍스트 끝에서 →  다음 셀 맨 앞 / 앞에서 ←  이전 셀 맨 끝 (행을 넘어 이어진다)
//   · ↑↓ 는 셀 안의 줄을 먼저 옮기고, 줄이 없으면 위·아래 셀로 (캐럿 x 유지)
//   · 표 끝에서 더 나가면 표 앞·뒤 블록으로 빠진다
//   · Tab/Shift+Tab 은 다음·이전 셀의 **맨 끝**, 마지막 셀 Tab 은 아무 일도 없다
//   · 캐럿이 있는 셀에는 2px 파란 테두리 한 겹, 드래그가 셀을 넘으면 텍스트가 아니라
//     **셀 범위**가 선택된다(테두리 하나로 union 을 감싸고 오른쪽 변 가운데 손잡이)
//   · 한 셀 안에서의 드래그는 그냥 텍스트 선택이고 서식 툴바가 뜬다
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/table-cellnav.check.mjs
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-table-cellnav.json", import.meta.url), "utf8"));
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
if (!pageId) { console.error("페이지를 못 만들었습니다:", created); process.exit(1); }
const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({ blocks, deletedIds: [], newIds: blocks.map((b) => b.id) }) });
if (!put.ok) { console.error("블록 저장 실패:", put.status, await put.text()); process.exit(1); }

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

/** 캐럿이 어느 셀 몇 번째 글자에 있나 + 그 x 좌표 */
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
    // 접힌 range 가 엘리먼트에 걸려 있으면 client rect 가 비어 있다 — 옆 글자로 잰다
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

/** 셀 안에 캐럿을 맨 앞/맨 끝으로 놓는다 */
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

// ── 1. 방향키·Tab ──────────────────────────────────────────────
for (const t of G.nav) {
  await page.keyboard.press("Escape").catch(() => {});
  await putCaret(t.from[0], t.from[1], t.caret ?? "end");
  const pre = await state();
  for (const k of t.keys ?? [t.key]) { await page.keyboard.press(k); await page.waitForTimeout(90); }
  const s = await state();
  const tag = `nav:${t.id}`;
  if (t.outside) {
    eq(`${tag} 표 밖으로`, s.cell ?? "밖", "밖");
  } else {
    eq(`${tag} 셀`, s.cell, t.cell);
    if (["ArrowDown", "ArrowUp"].includes(t.key)) eq(`${tag} 캐럿 x 유지`, s.caretX, pre.caretX, 6);
    else eq(`${tag} offset`, s.offset, t.offset, 0);
  }
  if (t.rows != null) eq(`${tag} 행 수`, await page.locator(`[data-testid^="table-cell-${tableId}-"]`).count() / G.table.cells[0].length, t.rows);
}

// ── 2. 줄바꿈된 셀 안에서의 세로 이동 ─────────────────────────────
{
  await page.evaluate(({ sel, text }) => {
    const el = document.querySelector(sel);
    el.focus(); el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, { sel: cellSel(1, 1), text: G.wrapped.text });
  await page.waitForTimeout(300);
  const box = await cellBox(1, 1);
  eq("wrapped 셀이 두 줄", box.height > G.geometry.cellMinHeight + 10, true);
  await putCaret(1, 1, "end");
  const end = await state();
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(90);
  const up = await state();
  eq("wrapped ↑ 는 셀 안 첫 줄로", up.cell, [1, 1]);
  eq("wrapped ↑ 줄이 올라감", up.caretY < end.caretY, true);
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(90);
  eq("wrapped ↓ 는 셀 안 둘째 줄로", (await state()).cell, [1, 1]);
  // 원래 값으로 되돌린다
  await page.evaluate(({ sel, text }) => {
    const el = document.querySelector(sel); el.focus(); el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, { sel: cellSel(1, 1), text: G.table.cells[1][1] });
  await page.waitForTimeout(250);
}

// ── 3. 캐럿이 있는 셀의 파란 테두리 ────────────────────────────────
{
  await putCaret(1, 1, "end");
  const s = await state();
  const box = await cellBox(1, 1);
  const sel = G.geometry.selection;
  if (!s.overlay) fails.push("캐럿 셀 테두리: 없음"), checks++;
  else {
    eq("캐럿 셀 테두리 굵기", s.overlay.bw, `${sel.borderWidth}px`);
    eq("캐럿 셀 테두리 색", s.overlay.bc, sel.borderColor);
    eq("캐럿 셀 테두리 라운드", s.overlay.radius, `${sel.borderRadius}px`);
    eq("캐럿 셀 테두리 배경", s.overlay.bg, sel.background);
    eq("캐럿 셀 테두리 x", s.overlay.x, box.x + sel.insetFromUnion);
    eq("캐럿 셀 테두리 y", s.overlay.y, box.y + sel.insetFromUnion);
    eq("캐럿 셀 테두리 w", s.overlay.w, box.width - 2 * sel.insetFromUnion);
    eq("캐럿 셀 테두리 h", s.overlay.h, box.height - 2 * sel.insetFromUnion);
  }
  eq("캐럿만 있을 때 손잡이는 없다", !!s.handle, false);
}

// ── 4. Escape / Shift+방향키 로 셀 범위 ────────────────────────────
for (const t of G.select) {
  await page.keyboard.press("Escape").catch(() => {});
  await putCaret(t.from[0], t.from[1], t.caret ?? "end");
  for (const k of t.keys ?? [t.key]) { await page.keyboard.press(k); await page.waitForTimeout(90); }
  const s = await state();
  const tag = `select:${t.id}`;
  eq(`${tag} 범위`, s.range, t.range.flat().join(","));
  eq(`${tag} 텍스트 선택 없음`, s.text, "");
}

// ── 5. 드래그 ────────────────────────────────────────────────────
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
  eq("drag:cross-cell 범위", s.range, t.range.flat().join(","));
  eq("drag:cross-cell 텍스트 선택 없음", s.text, "");
  eq("drag:cross-cell 툴바 없음", s.toolbar, false);
  const sel = G.geometry.selection;
  if (!s.overlay) fails.push("drag:cross-cell 테두리: 없음"), checks++;
  else {
    eq("drag 테두리 x", s.overlay.x, a.x + sel.insetFromUnion);
    eq("drag 테두리 y", s.overlay.y, a.y + sel.insetFromUnion);
    eq("drag 테두리 w", s.overlay.w, b.x + b.width - a.x - 2 * sel.insetFromUnion);
    eq("drag 테두리 h", s.overlay.h, b.y + b.height - a.y - 2 * sel.insetFromUnion);
  }
  const hd = sel.handle;
  if (!s.handle) fails.push("drag 손잡이: 없음"), checks++;
  else {
    eq("손잡이 크기", `${s.handle.w}x${s.handle.h}`, `${hd.w}x${hd.h}`);
    eq("손잡이 배경", s.handle.bg, hd.bg);
    eq("손잡이 테두리", `${s.handle.bw} ${s.handle.bc}`, `${hd.borderWidth}px ${hd.borderColor}`);
    eq("손잡이 x (선택 오른쪽 변)", s.handle.x + s.handle.w / 2, s.overlay.x + s.overlay.w - 1, 2);
    eq("손잡이 y (세로 가운데)", s.handle.y + s.handle.h / 2, s.overlay.y + s.overlay.h / 2, 2);
  }
}
{
  // 한 셀 안에서의 드래그 → 텍스트 선택 + 서식 툴바
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
  eq("drag:in-cell 텍스트가 선택됨", s.text.length > 0, true);
  eq("drag:in-cell 셀 범위 선택 아님", s.range ?? null, null);
  eq("drag:in-cell 서식 툴바", s.toolbar, true);
}

await browser.close();
await fetch(`${BASE}/api/pages/${pageId}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});

if (fails.length) {
  console.log(`  ┌─ 표 안 캐럿 이동·셀 선택이 원본과 다릅니다 (${fails.length}/${checks}) ─────`);
  for (const f of fails.slice(0, 40)) console.log(`  │ ${f}`);
  if (fails.length > 40) console.log(`  │ … ${fails.length - 40} more`);
  console.log("  └──────────────────────────────────────────────────");
  process.exit(1);
}
console.log(`표 안 캐럿 이동·셀 범위 선택 원본과 일치 — ${checks}개 체크`);
