// 표 블록의 ⠿ 메뉴 — 거터의 + 옆 손잡이를 눌렀을 때 나오는 `표` 묶음.
// 원본에서 잰 값은 fixtures/notion-table-block-menu.json 에 있다.
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/table-block-menu.check.mjs
//
// 원본과 다르게 한 것(§ours): 두 번째 헤더 항목의 라벨을 `제목 열` 로 (원본은 두
// 줄 다 `제목 행` 이고 아이콘만 다르다), 그리고 원본에 없는 `정렬` 을 더했다 —
// 이 메뉴에는 행·열 맥락이 없으니 표 전체에 적용한다.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-table-block-menu.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };

const uuid = () => crypto.randomUUID();
const paraId = uuid(), tableId = uuid();
const CELLS = [["a0", "b0", "c0"], ["a1", "b1", "c1"], ["a2", "b2", "c2"]];
const created = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "table-block-menu.check" }) }).then((r) => r.json());
const pageId = created.page?.id ?? created.id;
if (!pageId) { console.error("페이지를 못 만들었습니다:", created); process.exit(1); }
const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({
  blocks: [
    { id: paraId, type: "paragraph", content: { text: "before" }, parentBlockId: null, position: 1 },
    { id: tableId, type: "table", content: { table: { cells: CELLS } }, parentBlockId: null, position: 2 },
  ], deletedIds: [], newIds: [paraId, tableId] }) });
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

const openHandle = async (blockId) => {
  await page.mouse.move(20, 700);
  await page.locator(`[data-testid="block-${blockId}"]`).hover({ position: { x: 120, y: 8 } });
  await page.waitForTimeout(200);
  await page.locator(`[data-testid="block-handle-${blockId}"]`).click();
  await page.waitForTimeout(300);
};
const section = () => page.evaluate((tid) => {
  const head = document.querySelector(`[data-testid="block-table-section-${tid}"]`);
  const row = document.querySelector(`[data-testid="block-table-headerrow-${tid}"]`);
  const colr = document.querySelector(`[data-testid="block-table-headercol-${tid}"]`);
  const align = document.querySelector(`[data-testid="block-table-align-${tid}"]`);
  const sw = (el) => {
    if (!el) return null;
    const pill = [...el.querySelectorAll("span")].find((s) => Math.abs(s.getBoundingClientRect().width - 30) < 3);
    const knob = pill?.firstElementChild;
    const pb = pill?.getBoundingClientRect(), kb = knob?.getBoundingClientRect();
    return pill ? { w: +pb.width.toFixed(1), h: +pb.height.toFixed(1), bg: getComputedStyle(pill).backgroundColor,
      radius: getComputedStyle(pill).borderTopLeftRadius, knob: kb ? { w: +kb.width.toFixed(1), h: +kb.height.toFixed(1) } : null,
      on: el.getAttribute("data-on") } : null;
  };
  const hs = head && getComputedStyle(head);
  return {
    head: head ? { txt: head.textContent.trim(), fs: hs.fontSize, fw: hs.fontWeight } : null,
    labels: [row, colr, align].map((e) => e?.textContent.trim().split("\n")[0] ?? null),
    order: [...document.querySelectorAll('[data-testid^="block-table-"], [data-testid^="block-delete-"]')].map((e) => e.getAttribute("data-testid").replace(/-[0-9a-f-]{36}$/, "")),
    switches: { row: sw(row), col: sw(colr) },
  };
}, tableId);
const look = () => page.evaluate((tid) => {
  const out = [];
  for (let r = 0; ; r++) {
    const row = [];
    for (let c = 0; ; c++) {
      const el = document.querySelector(`[data-testid="table-cell-${tid}-${r}-${c}"]`);
      if (!el) break;
      const w = el.parentElement, ws = getComputedStyle(w);
      const a = ws.textAlign;
      row.push((parseInt(ws.fontWeight, 10) >= 500 ? "B" : ".") + (ws.backgroundColor === "rgba(0, 0, 0, 0)" ? "." : "G") + "/" + (a === "start" ? "left" : a === "end" ? "right" : a));
    }
    if (!row.length) break;
    out.push(row.join(" "));
  }
  return out;
}, tableId);

// ── 1. 표 블록에만 `표` 묶음이 붙는다 ────────────────────────────
{
  await openHandle(paraId);
  eq("문단의 ⠿ 메뉴에는 표 묶음이 없다", (await section()).head, null);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  await openHandle(tableId);
  const s = await section();
  if (!s.head) fails.push("표 블록 ⠿ 메뉴에 표 묶음이 없다"), checks++;
  else {
    eq("묶음 머리글", s.head.txt, G.section.title);
    eq("머리글 글자 크기", s.head.fs, G.section.fontSize);
    eq("머리글 굵기", s.head.fw, G.section.weight);
  }
  eq("항목 라벨", s.labels, [G.tableItems[2].label, G.ours.headerColLabel.split(" —")[0], G.ours.extraItems[0]]);
  eq("표 묶음이 맨 위 (일반 항목보다 앞)", s.order[0], "block-table-section");
  eq("스위치 크기", `${s.switches.row.w}x${s.switches.row.h}`, `${G.switch.w}x${G.switch.h}`);
  eq("스위치 라운드", s.switches.row.radius, `${G.switch.radius}px`);
  eq("스위치 손잡이", `${s.switches.row.knob.w}x${s.switches.row.knob.h}`, `${G.switch.knob}x${G.switch.knob}`);
  eq("스위치 꺼짐 색", s.switches.row.bg, G.switch.off);
  eq("처음엔 둘 다 꺼짐", [s.switches.row.on, s.switches.col.on], ["0", "0"]);
}

// ── 2. 제목 행 / 제목 열 이 각자 자기 축을 켠다 ───────────────────
{
  await page.locator(`[data-testid="block-table-headerrow-${tableId}"]`).click();
  await page.waitForTimeout(400);
  let s = await section();
  eq("제목 행: 스위치 켜짐", s.switches.row.on, "1");
  eq("제목 행: 스위치 파랑", s.switches.row.bg, G.switch.on);
  eq("제목 행: 메뉴는 열린 채", !!s.head, true);
  eq("제목 행: 첫 행이 제목", (await look())[0].split(" ").every((x) => x.startsWith("BG")), true);
  eq("제목 행: 다른 행은 그대로", (await look())[1].split(" ")[1].startsWith(".."), true);

  await page.locator(`[data-testid="block-table-headercol-${tableId}"]`).click();
  await page.waitForTimeout(400);
  s = await section();
  eq("제목 열: 스위치 켜짐", s.switches.col.on, "1");
  const l = await look();
  eq("제목 열: 첫 열이 제목", l.every((row) => row.split(" ")[0].startsWith("BG")), true);
  eq("제목 열: 가운데 칸은 평범", l[1].split(" ")[1].startsWith(".."), true);

 // 다시 눌러 끈다
  await page.locator(`[data-testid="block-table-headerrow-${tableId}"]`).click();
  await page.waitForTimeout(300);
  await page.locator(`[data-testid="block-table-headercol-${tableId}"]`).click();
  await page.waitForTimeout(400);
  eq("둘 다 끄면 평범해진다", (await look()).join(" ").includes("G"), false);
}

// ── 3. 정렬 (우리 것) — 표 전체 ─────────────────────────────────
{
  const A = G.ours.alignSubmenu;
  await page.locator(`[data-testid="block-table-align-${tableId}"]`).click();
  await page.waitForTimeout(300);
  const rows = await page.evaluate((tid) => {
    const m = document.querySelector(`[data-testid="block-table-align-menu-${tid}"]`);
    if (!m) return null;
    return [...m.querySelectorAll("button")].map((b) => ({ txt: b.textContent.trim(), on: b.getAttribute("data-on") }));
  }, tableId);
 // DOM 에 있는 것만으로는 부족하다 — 메뉴 상자가 스크롤 박스라서 그 안에 절대배치
 // 하면 잘려 보이지 않았다. 화면에 실제로 보이는지(그 자리의 최상단 요소가
 // 서브메뉴 안인지)까지 본다.
  const visible = await page.evaluate((tid) => {
    const m = document.querySelector(`[data-testid="block-table-align-menu-${tid}"]`);
    if (!m) return { none: true };
    const b = m.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { inWindow: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
      onTop: !!hit && m.contains(hit), w: +b.width.toFixed(1) };
  }, tableId);
  eq("정렬 서브메뉴가 창 안에 있다", visible.inWindow, true);
  eq("정렬 서브메뉴가 가려지지 않았다", visible.onTop, true);
  if (!rows) fails.push("정렬 서브메뉴가 안 열린다"), checks++;
  else {
    eq("정렬 항목", rows.map((r) => r.txt), A.options);
    eq("기본값에 체크", rows.find((r) => r.on === "1")?.txt, A.default);
  }
  await page.locator(`[data-testid="block-table-align-${tableId}-center"]`).click();
  await page.waitForTimeout(500);
  eq("가운데: 표 전체가 가운데", (await look()).every((row) => row.split(" ").every((x) => x.endsWith("/center"))), true);

 // 새로고침 후에도 남는다 (자동 저장이 끝날 시간을 준다)
  await page.waitForTimeout(1800);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-testid="table-cell-${tableId}-0-0"]`);
  await page.waitForTimeout(600);
  eq("새로고침 후에도 가운데", (await look())[1].split(" ")[1].endsWith("/center"), true);

 // 현재 값에 체크가 따라온다
  await openHandle(tableId);
  await page.locator(`[data-testid="block-table-align-${tableId}"]`).click();
  await page.waitForTimeout(300);
  eq("현재 값(가운데)에 체크", await page.evaluate((tid) => document.querySelector(`[data-testid="block-table-align-${tid}-center"]`)?.getAttribute("data-on"), tableId), "1");
  await page.locator(`[data-testid="block-table-align-${tableId}-right"]`).click();
  await page.waitForTimeout(500);
  eq("오른쪽으로도 바뀐다", (await look()).every((row) => row.split(" ").every((x) => x.endsWith("/right"))), true);
  await openHandle(tableId);
  await page.locator(`[data-testid="block-table-align-${tableId}"]`).click();
  await page.waitForTimeout(300);
  await page.locator(`[data-testid="block-table-align-${tableId}-left"]`).click();
  await page.waitForTimeout(500);
  eq("왼쪽으로 되돌림", (await look()).every((row) => row.split(" ").every((x) => x.endsWith("/left"))), true);
}

await browser.close();
await fetch(`${BASE}/api/pages/${pageId}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});

if (fails.length) {
  console.log(`  ┌─ 표 블록 ⠿ 메뉴가 기대와 다릅니다 (${fails.length}/${checks}) ─────`);
  for (const f of fails.slice(0, 40)) console.log(`  │ ${f}`);
  console.log("  └──────────────────────────────────────────────");
  process.exit(1);
}
console.log(`표 블록 ⠿ 메뉴(표 묶음 · 제목 행/열 스위치 · 정렬) — ${checks}개 체크`);
