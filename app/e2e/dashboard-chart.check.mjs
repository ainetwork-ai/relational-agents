// 대시보드 차트 위젯 — 선/캔들, 날짜×숫자 축, select 마커.
//
// 임시 데이터베이스(날짜+가격+사이드, 3일치 5행)를 만들고 편집 모드에서
// 차트 종류·버킷·마커 컨트롤을 실제로 눌러 SVG가 맞게 바뀌는지 본다.
//
//   [BASE_URL=…] node e2e/dashboard-chart.check.mjs

import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
await page.request.post(`${BASE}/api/auth/demo-login`);
const api = async (method, path, body) => {
  const r = await page.request.fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    data: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()} ${await r.text()}`);
  return r.json();
};

// ---- fixture --------------------------------------------------------------
const db = await api("POST", "/api/databases", { title: "chart-check", shape: "minimal" });
const dbId = db.database?.id ?? db.id;
const mk = async (name, type, config) =>
  (await api("POST", `/api/databases/${dbId}/properties`, { name, type, ...(config && { config }) })).property?.id;
const whenId = await mk("When", "date");
const priceId = await mk("Price", "number");
const sideId = await mk("Side", "select", {
  options: [
    { id: "buy", name: "Buy", color: "green" },
    { id: "sell", name: "Sell", color: "red" },
  ],
});

// 3일 · 5행: 1일차 위꼬리 상승(100→110), 2일차 하락(120→105), 3일차 단일(95)
const rows = [
  ["2026-09-01T10:00:00Z", 100, "buy"],
  ["2026-09-01T14:00:00Z", 110, "sell"],
  ["2026-09-02T10:00:00Z", 120, "buy"],
  ["2026-09-02T14:00:00Z", 105, "sell"],
  ["2026-09-03T10:00:00Z", 95, "buy"],
];
for (const [d, v, s] of rows)
  await api("POST", `/api/databases/${dbId}/rows`, { values: { [whenId]: d, [priceId]: v, [sideId]: s } });

await api("POST", `/api/databases/${dbId}/views`, {
  type: "dashboard",
  name: "Dash",
  config: {
    widgets: [
      { id: "w-ch", kind: "chart", width: 4, chartType: "line", xPropertyId: whenId, yPropertyId: priceId, markerPropertyId: sideId },
    ],
  },
});
const { pageId } = await api("POST", `/api/databases/${dbId}/fullpage`);

const fails = [];
const count = (sel) => page.locator(sel).count();

await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='db-view-tab-']", { timeout: 120_000 });
const dashTab = page.getByTestId(/^db-view-tab-/).filter({ hasText: "Dash" }).first();
if (await dashTab.isVisible().catch(() => false)) await dashTab.click();
await page.waitForSelector("[data-testid='db-dashw-chart-w-ch']", { timeout: 60_000 });

// 선 + 마커 5개
if ((await count("[data-chart-line]")) !== 1) fails.push("선 차트: path[data-chart-line]가 1개가 아닙니다");
if ((await count("[data-chart-marker]")) !== 5) fails.push(`마커: ${await count("[data-chart-marker]")}개 / 기대 5개`);

// 편집 → 캔들(일별): 3개, 1일차 상승(초록)·2일차 하락(빨강)
await page.getByTestId("db-dash-edit").click();
await page.getByTestId("db-dashw-charttype-w-ch").selectOption("candles");
await page.getByTestId("db-dashw-bucket-w-ch").selectOption("day");
await page.waitForFunction(() => document.querySelectorAll("[data-chart-candle]").length === 3, { timeout: 8_000 }).catch(() => {});
const nCandles = await count("[data-chart-candle]");
if (nCandles !== 3) fails.push(`캔들(일별): ${nCandles}개 / 기대 3개`);
const candleFills = await page.$$eval("[data-chart-candle] rect", (rs) => rs.map((r) => r.getAttribute("fill")));
if (candleFills[0] !== "#4ade80") fails.push(`1일차 캔들이 상승(초록)이 아닙니다 (${candleFills[0]})`);
if (candleFills[1] !== "#f87171") fails.push(`2일차 캔들이 하락(빨강)이 아닙니다 (${candleFills[1]})`);

// 마커 색: buy=초록 3, sell=빨강 2
const markerFills = await page.$$eval("[data-chart-marker]", (ms) => ms.map((m) => m.getAttribute("fill")));
if (markerFills.filter((f) => f === "#4ade80").length !== 3) fails.push("Buy 마커(초록)가 3개가 아닙니다");
if (markerFills.filter((f) => f === "#f87171").length !== 2) fails.push("Sell 마커(빨강)가 2개가 아닙니다");

// 마커 없음 → 0개
await page.getByTestId("db-dashw-marker-w-ch").selectOption("");
await page.waitForFunction(() => document.querySelectorAll("[data-chart-marker]").length === 0, { timeout: 8_000 }).catch(() => {});
if ((await count("[data-chart-marker]")) !== 0) fails.push("마커 없음으로 바꿔도 마커가 남아 있습니다");

// 버킷 시간별 → 5개 (행마다 다른 시간)
await page.getByTestId("db-dashw-bucket-w-ch").selectOption("hour");
await page.waitForFunction(() => document.querySelectorAll("[data-chart-candle]").length === 5, { timeout: 8_000 }).catch(() => {});
if ((await count("[data-chart-candle]")) !== 5) fails.push(`캔들(시간별): ${await count("[data-chart-candle]")}개 / 기대 5개`);

// x/y 축 셀렉트가 속성 목록을 물고 있는지
const xOpts = await page.getByTestId("db-dashw-x-w-ch").locator("option").allTextContents();
const yOpts = await page.getByTestId("db-dashw-y-w-ch").locator("option").allTextContents();
if (!xOpts.includes("When")) fails.push("x축 셀렉트에 날짜 속성이 없습니다");
if (!yOpts.includes("Price")) fails.push("y축 셀렉트에 숫자 속성이 없습니다");

// 정리
await page.request.fetch(`${BASE}/api/pages/${pageId}`, { method: "DELETE" });
await page.request.fetch(`${BASE}/api/databases/${dbId}`, { method: "DELETE" });
await browser.close();

if (fails.length) {
  console.error(`\n  ┌─ 차트 위젯 불일치 (${fails.length}건) ─────────────`);
  for (const f of fails) console.error(`  │ ${f}`);
  console.error("  └──────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("차트 위젯 OK — 선+마커 5, 일별 캔들 3(상승 초록/하락 빨강), 시간별 5, 마커 토글");
