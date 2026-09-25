// 대시보드 깊이 위젯 — 두 사이드 누적 계단 영역 (호가창 스타일).
//
// Price(레벨)×Size(크기)×Side(bid/ask) 사다리를 만들고, 두 계단 폴리곤과
// 누적 합, 크기→개수 전환, 레벨 축 전환을 확인한다.
//
//   [BASE_URL=…] node e2e/dashboard-depth.check.mjs

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

const db = await api("POST", "/api/databases", { title: "depth-check", shape: "minimal" });
const dbId = db.database?.id ?? db.id;
const mk = async (name, type, config) =>
  (await api("POST", `/api/databases/${dbId}/properties`, { name, type, ...(config && { config }) })).property?.id;
const priceId = await mk("Price", "number");
const sizeId = await mk("Size", "number");
const sideId = await mk("Side", "select", {
  options: [
    { id: "bid", name: "Bid", color: "green" },
    { id: "ask", name: "Ask", color: "red" },
  ],
});

// bid 3레벨(누적 60), ask 2레벨(누적 70) — 98 레벨은 두 행이 합산돼야 한다
const ladder = [
  [98, 10, "bid"], [98, 20, "bid"], [97, 15, "bid"], [96, 15, "bid"],
  [102, 30, "ask"], [104, 40, "ask"],
];
for (const [p, s, side] of ladder)
  await api("POST", `/api/databases/${dbId}/rows`, { values: { [priceId]: p, [sizeId]: s, [sideId]: side } });

await api("POST", `/api/databases/${dbId}/views`, {
  type: "dashboard",
  name: "Dash",
  config: {
    widgets: [
      { id: "w-d", kind: "depth", width: 4, groupByPropertyId: sideId, xPropertyId: priceId, aggregate: "sum", aggregatePropertyId: sizeId },
    ],
  },
});
const { pageId } = await api("POST", `/api/databases/${dbId}/fullpage`);

const fails = [];
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='db-view-tab-']", { timeout: 120_000 });
const dashTab = page.getByTestId(/^db-view-tab-/).filter({ hasText: "Dash" }).first();
if (await dashTab.isVisible().catch(() => false)) await dashTab.click();
await page.waitForSelector("[data-testid='db-dashw-depth-w-d']", { timeout: 60_000 });

// 두 사이드 폴리곤 + 누적 합 툴팁
if ((await page.locator("[data-depth-side='bid'] path").count()) !== 1) fails.push("bid 계단 폴리곤이 없습니다");
if ((await page.locator("[data-depth-side='ask'] path").count()) !== 1) fails.push("ask 계단 폴리곤이 없습니다");
const bidTitle = await page.locator("[data-depth-side='bid'] title").textContent();
const askTitle = await page.locator("[data-depth-side='ask'] title").textContent();
if (!bidTitle?.includes("60")) fails.push(`bid 누적이 60이 아닙니다 (${bidTitle}) — 같은 레벨 두 행 합산 실패`);
if (!askTitle?.includes("70")) fails.push(`ask 누적이 70이 아닙니다 (${askTitle})`);

// 색: bid 초록 / ask 빨강
const bidStroke = await page.locator("[data-depth-side='bid'] path").getAttribute("stroke");
const askStroke = await page.locator("[data-depth-side='ask'] path").getAttribute("stroke");
if (bidStroke !== "#4ade80") fails.push(`bid 색이 초록이 아닙니다 (${bidStroke})`);
if (askStroke !== "#f87171") fails.push(`ask 색이 빨강이 아닙니다 (${askStroke})`);

// 크기 → 개수: bid 4행 / ask 2행
await page.getByTestId("db-dash-edit").click();
await page.getByTestId("db-dashw-agg-w-d").selectOption("count");
await page.waitForFunction(
  () => document.querySelector("[data-depth-side='bid'] title")?.textContent?.includes("4"),
  { timeout: 8_000 }
).catch(() => {});
const bidCnt = await page.locator("[data-depth-side='bid'] title").textContent();
if (!bidCnt?.includes("4")) fails.push(`개수 모드: bid 누적이 4가 아닙니다 (${bidCnt})`);

// 레벨 축 셀렉트에 숫자 속성이 있는지 + 전환 동작
const xOpts = await page.getByTestId("db-dashw-x-w-d").locator("option").allTextContents();
if (!xOpts.some((o) => o.includes("Price"))) fails.push("레벨 축 셀렉트에 Price가 없습니다");
if (!xOpts.some((o) => o.includes("Size"))) fails.push("레벨 축 셀렉트에 Size가 없습니다");
await page.getByTestId("db-dashw-x-w-d").selectOption({ index: 1 });
await page.waitForTimeout(500);
if ((await page.locator("[data-depth-side='bid'] path").count()) !== 1) fails.push("레벨 축 전환 후 폴리곤이 사라졌습니다");

await page.request.fetch(`${BASE}/api/pages/${pageId}`, { method: "DELETE" });
await page.request.fetch(`${BASE}/api/databases/${dbId}`, { method: "DELETE" });
await browser.close();

if (fails.length) {
  console.error(`\n  ┌─ 깊이 위젯 불일치 (${fails.length}건) ─────────────`);
  for (const f of fails) console.error(`  │ ${f}`);
  console.error("  └──────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("깊이 위젯 OK — bid 60/ask 70 누적 계단, 레벨 합산, 개수 전환, 축 전환");
