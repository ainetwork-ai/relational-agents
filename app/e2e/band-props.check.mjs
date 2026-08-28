// 고정 속성 밴드가 원본과 같은지 — 무엇이 나오는가(집합·순서·행 불변), 사람이 여러 명일 때,
// 항목 폭 규칙, 화살표, 그리고 피크/풀페이지 차이. 원본 실측은 fixtures/notion-row-props-band.json.
// 기하(라벨 24 · 값 30 · gap 8 · 화살표 32)는 row-props.check.mjs 가 본다 — 여기서는 겹치지 않는 것만.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/band-props.check.mjs
//
// 밴드에 무엇이 서는지는 데이터베이스의 선택(config.pinned/pinnedOrder)이라, dev DB 를
// 다시 시드했다면 먼저 피크의 `레이아웃 사용자 지정` 에서 TL · Assignee · End date ·
// Evaluation 을 이 순서로 고정해야 한다 — 안 그러면 첫 대조부터 어긋난다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-row-props-band.json", import.meta.url), "utf8"));

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const fails = [];
const ok = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fails.push(label); };
const near = (a, b, tol = G.tolerance) => a != null && b != null && Math.abs(a - b) <= tol;

// 밴드를 훑어 항목마다 이름·폭·라벨 폭·값의 실제 내용 폭·사람 칩/+N 을 읽는다
const MEASURE = `(root) => {
  const band = root.querySelector("[data-pinned-row]");
  if (!band) return null;
  const sc = band.querySelector("[data-role='band-track']").parentElement;
  const br = band.getBoundingClientRect();
  const items = [...band.querySelectorAll("[data-testid^='row-props-item-']")].map((it) => {
    const r = it.getBoundingClientRect();
    const label = it.querySelector("[data-role='label']");
    const value = it.querySelector("[data-role='value']");
    const vr = value.getBoundingClientRect();
 // 값의 잉크 폭: 셀 안쪽 내용 + 좌우 패딩 6+6
    const inner = value.firstElementChild;
    const ink = inner ? Math.ceil(inner.scrollWidth) + 12 : 0;
    const chips = value.querySelectorAll("img, [data-avatar], span > span").length;
    const overflow = value.querySelector("[data-role='person-overflow']");
    const chipEls = [...value.querySelectorAll("span")].filter((s) => s.querySelector("img, div[aria-hidden]") || /flex shrink-0 items-center/.test(s.className));
    return {
      name: it.querySelector("[data-role='label-text']").textContent.trim(),
      type: it.getAttribute("data-type"),
      item: +r.width.toFixed(1), label: +label.getBoundingClientRect().width.toFixed(1),
      valueInk: ink, valueH: +vr.height.toFixed(1),
      empty: !!it.querySelector("[data-role='empty']"),
      text: value.innerText.trim().replace(/\\n/g, " "),
      overflowText: overflow ? overflow.textContent.trim() : null,
      chipCount: chipEls.length,
    };
  });
  const arrows = [...band.querySelectorAll("[data-role='band-arrow']")].map((a) => {
    const r = a.getBoundingClientRect(); const s = getComputedStyle(a);
    return { dx: +(r.left - br.left).toFixed(1), op: +(+s.opacity).toFixed(2), cx: r.left + 16, cy: r.top + 16 };
  }).sort((a, b) => a.dx - b.dx);
  return { bandX: +br.left.toFixed(1), bandW: +br.width.toFixed(1),
    clientW: sc.clientWidth, scrollW: sc.scrollWidth, scrollLeft: +sc.scrollLeft.toFixed(1), items, arrows };
}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
await page.evaluate(() => localStorage.removeItem("row-peek-width"));

const measure = (sel) => page.evaluate(
  ([fn, s]) => new Function("return " + fn)()(document.querySelector(s)),
  [MEASURE, sel]
);
const rowIds = [...new Set(await page.$$eval("[data-testid^='db-row-']", (els) =>
  els.map((e) => e.getAttribute("data-testid").replace("db-row-", ""))
     .filter((id) => id && !/^drag-|^check-|^expand-/.test(id))
))];
const openPeek = async (rowIndex) => {
  const id = rowIds[rowIndex];
 // 같은 행이 그룹마다 그려질 수 있어 첫 번째만 쓴다
  await page.locator(`[data-testid='db-row-${id}']`).first().hover();
  await page.locator(`[data-testid='db-title-open-${id}']`).first().click({ timeout: 8000 });
  await page.waitForSelector("[data-testid='db-row-peek'] [data-pinned-row]", { timeout: 20_000 });
  await page.waitForTimeout(700);
};
const closePeek = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); };

// ── 1. 무엇이 나오는가: 행이 달라도 같은 집합·같은 순서, 빈 값도 자리를 지킨다 ──
console.log("\n— 집합과 순서 (원본: 33행 전부 같은 4개) —");
const WANT = G.set.properties;
let sawEmpty = false;
for (const i of [0, 1, 2, 3, 4]) {
  await openPeek(i);
  const m = await measure("[data-testid='db-row-peek']");
  const names = m.items.map((x) => x.name);
  ok(JSON.stringify(names) === JSON.stringify(WANT), `행 ${i + 1}: ${names.join(" · ")}`);
  if (m.items.some((x) => x.empty)) {
    sawEmpty = true;
    for (const it of m.items.filter((x) => x.empty)) {
      ok(/비어 있음|비어있음/.test(it.text), `행 ${i + 1} ${it.name}: 빈 값도 자리를 지킴 ("${it.text}")`);
      ok(near(it.item, Math.max(80, it.label)), `행 ${i + 1} ${it.name}: 빈 항목 폭 = max(80, 라벨) — ${it.item} vs ${Math.max(80, it.label)}`);
    }
  }
  await closePeek();
}
ok(sawEmpty, "빈 값인 고정 속성을 가진 행이 표본에 있었다");

// ── 2. 사람이 여러 명일 때: 칩 하나 + `+ N` ──
console.log("\n— 사람이 여러 명일 때 —");
let checkedMany = false, checkedOne = false;
for (let i = 0; i < 8 && !(checkedMany && checkedOne); i++) {
  await openPeek(i);
  const m = await measure("[data-testid='db-row-peek']");
  for (const it of m.items.filter((x) => x.type === "person" && !x.empty)) {
    const n = (it.text.match(/\+\s*(\d+)/) ?? [])[1];
    if (n) {
      if (checkedMany) continue;
      checkedMany = true;
      ok(it.chipCount === G.people.chipsShown, `${it.name}: 칩 ${it.chipCount}개 (원본 1개) + "${it.overflowText}"`);
      ok(it.overflowText === `+ ${n}`, `${it.name}: 넘침 배지 "${it.overflowText}"`);
      ok(near(it.valueH, G.people.valueHeight.withOverflow), `${it.name}: 값 높이 ${it.valueH} (원본 31)`);
      ok(it.item <= G.width.max, `${it.name}: 항목 폭 ${it.item} ≤ 200`);
    } else if (!checkedOne) {
      checkedOne = true;
      ok(near(it.valueH, G.people.valueHeight.plain), `${it.name}: 한 명일 때 값 높이 ${it.valueH} (원본 30)`);
    }
  }
  await closePeek();
}
ok(checkedMany, "사람이 둘 이상인 고정 속성을 재봤다");

// ── 3. 폭 규칙: clamp(max(라벨, 값), 80, 200), 창 폭·표면과 무관 ──
console.log("\n— 항목 폭 —");
await openPeek(0);
const widthsByWin = {};
for (const w of [1000, 1200, 1500]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(500);
  const m = await measure("[data-testid='db-row-peek']");
  widthsByWin[w] = m.items.map((x) => x.item);
  for (const it of m.items) {
    ok(it.item >= G.width.min - G.tolerance && it.item <= G.width.max + G.tolerance, `@${w} ${it.name}: 80 ≤ ${it.item} ≤ 200`);
    ok(it.item >= it.label - G.tolerance, `@${w} ${it.name}: 라벨(${it.label})보다 좁지 않음`);
    if (!it.empty && it.valueInk < G.width.max)
      ok(near(it.item, Math.max(G.width.min, it.label, it.valueInk), 4), `@${w} ${it.name}: 폭 ${it.item} = max(80, 라벨 ${it.label}, 값 ${it.valueInk})`);
  }
}
ok(JSON.stringify(widthsByWin[1000]) === JSON.stringify(widthsByWin[1200]) &&
   JSON.stringify(widthsByWin[1200]) === JSON.stringify(widthsByWin[1500]),
  `창 폭이 달라도 항목 폭은 그대로: ${JSON.stringify(widthsByWin[1200])}`);
await page.setViewportSize({ width: 1200, height: 900 });
await page.waitForTimeout(400);

// ── 4. 화살표: 넘칠 때만, 한 번에 (보이는 폭 − 200) ──
console.log("\n— 스크롤 화살표 —");
{
 // 창을 좁혀 밴드를 넘치게 만든다
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(600);
  const m = await measure("[data-testid='db-row-peek']");
  const over = m.scrollW - m.clientW;
  ok(over > 0, `밴드가 넘침 (${m.clientW} / ${m.scrollW})`);
  ok(m.arrows[0]?.op === 0, "맨 앞에서 왼쪽 화살표 숨김");
  ok(m.arrows[1]?.op === 1, "넘치면 오른쪽 화살표 보임 (호버 없이)");
  await page.mouse.click(m.arrows[1].cx, m.arrows[1].cy);
  await page.waitForTimeout(900);
  const m2 = await measure("[data-testid='db-row-peek']");
  const want = Math.min(m.clientW - 200, over);
  ok(near(m2.scrollLeft, want, 4), `한 번 누르면 ${m2.scrollLeft} 만큼 (원본 규칙 clientW−200 = ${want})`);
  ok(m2.arrows[0]?.op === 1, "스크롤한 뒤 왼쪽 화살표 보임");
  if (near(m2.scrollLeft, over, 4)) ok(m2.arrows[1]?.op === 0, "끝에 닿으면 오른쪽 화살표 숨김");
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(500);
}

// ── 4b. 상한에 닿은 값은 줄임표로 줄어든다 ──
console.log("\n— 200px 에 닿았을 때 —");
{
  const capped = await page.evaluate(() => {
    const items = [...document.querySelectorAll("[data-testid='db-row-peek'] [data-testid^='row-props-item-']")];
    const hit = items.find((it) => Math.round(it.getBoundingClientRect().width) >= 199);
    if (!hit) return null;
    const value = hit.querySelector("[data-role='value']");
 // 글자를 담은 가장 안쪽 요소 — 원본은 여기에 nowrap/ellipsis 를 걸어 둔다
    const leaf = [...value.querySelectorAll("*")].find((e) => e.scrollWidth > e.clientWidth + 1) ?? value;
    const s = getComputedStyle(leaf);
    return { name: hit.querySelector("[data-role='label-text']").textContent.trim(),
      item: +hit.getBoundingClientRect().width.toFixed(1),
      valueOverflow: getComputedStyle(value).overflow,
      leafW: Math.round(leaf.clientWidth), inkW: Math.round(leaf.scrollWidth),
      te: s.textOverflow, ws: s.whiteSpace, ov: s.overflow, text: value.innerText.trim() };
  });
  if (!capped) {
    console.log("· 상한에 닿은 고정 속성이 이 행에 없음 — 줄임표 대조 생략");
  } else {
    ok(capped.valueOverflow === "hidden", `${capped.name}: 값 셀이 넘침을 감춤 (${capped.valueOverflow})`);
    ok(capped.ws === "nowrap", `${capped.name}: 한 줄 유지 (${capped.ws})`);
    ok(capped.te === "ellipsis", `${capped.name}: 줄임표로 줄임 (${capped.te}) — "${capped.text.slice(0, 24)}…"`);
    ok(capped.inkW > capped.leafW, `${capped.name}: 실제 글자 폭 ${capped.inkW} > 보이는 폭 ${capped.leafW} (원본 232.3 → 188)`);
  }
}

// ── 5. 피크 / 풀페이지: 같은 규칙, 가용 폭만 다름 ──
console.log("\n— 피크와 풀페이지 —");
const peek = await measure("[data-testid='db-row-peek']");
const peekTitle = await page.locator("[data-testid='db-peek-title']").boundingBox();
ok(near(peek.bandX - peekTitle.x, G.surface.peek.bandOffsetFromTitle), `피크: 밴드가 제목보다 ${(peek.bandX - peekTitle.x).toFixed(1)}px 오른쪽 (원본 2)`);
await page.locator("[data-testid='db-peek-open-full']").click();
await page.waitForSelector("[data-testid='page-row-props'] [data-pinned-row]", { timeout: 30_000 });
await page.waitForTimeout(1200);
const full = await measure("[data-testid='page-root']");
ok(JSON.stringify(full.items.map((x) => x.name)) === JSON.stringify(WANT), `풀페이지도 같은 집합: ${full.items.map((x) => x.name).join(" · ")}`);
ok(JSON.stringify(full.items.map((x) => x.item)) === JSON.stringify(peek.items.map((x) => x.item)),
  `풀페이지 항목 폭이 피크와 같음: ${JSON.stringify(full.items.map((x) => x.item))}`);
const fullTitle = await page.locator("[data-testid='page-title']").boundingBox();
ok(near(full.bandX - fullTitle.x, G.surface.peek.bandOffsetFromTitle), `풀페이지: 밴드가 제목보다 ${(full.bandX - fullTitle.x).toFixed(1)}px 오른쪽 (원본 2)`);

await browser.close();
if (fails.length) { console.error(`\n${fails.length}개 실패`); process.exit(1); }
console.log("\n원본과 차이 없음 — exit 0");
