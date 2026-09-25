// 대시보드 카운터 위젯 숫자 포매팅 — 소수 자릿수 / 접두·접미어 / ±부호색.
//
// 임시 데이터베이스를 API로 만들고, 편집 모드에서 새 컨트롤 4개를 실제로 눌러
// 값 표기가 바뀌는지 확인한다. 끝나면 만든 것들을 지운다.
//
//   [BASE_URL=…] node e2e/dashboard-counter.check.mjs

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

// ---- fixture: DB with a number property, two rows, one counter widget -------
const db = await api("POST", "/api/databases", { title: "fmt-check", shape: "minimal" });
const dbId = db.database?.id ?? db.id;
const amount = await api("POST", `/api/databases/${dbId}/properties`, { name: "Amount", type: "number" });
const amountId = amount.property?.id ?? amount.id;
await api("POST", `/api/databases/${dbId}/rows`, { values: { [amountId]: 1234.5 } });
await api("POST", `/api/databases/${dbId}/rows`, { values: { [amountId]: -34.25 } });
const view = await api("POST", `/api/databases/${dbId}/views`, {
  type: "dashboard",
  name: "Dash",
  config: { widgets: [{ id: "w-c", kind: "counter", width: 1, aggregate: "sum", aggregatePropertyId: amountId }] },
});
const viewId = view.view?.id ?? view.id;
const { pageId } = await api("POST", `/api/databases/${dbId}/fullpage`);

const fails = [];
const valueIs = async (want, label) => {
  try {
    await page.waitForFunction(
      (w) => document.querySelector("[data-testid='db-dashw-value-w-c']")?.textContent === w,
      want,
      { timeout: 8_000 }
    );
  } catch {
    const got = await page.locator("[data-testid='db-dashw-value-w-c']").textContent();
    fails.push(`${label}: 표기 "${got}" / 기대 "${want}"`);
  }
};

await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='db-view-tab-']", { timeout: 120_000 });
const dashTab = page.getByTestId(/^db-view-tab-/).filter({ hasText: "Dash" }).first();
if (await dashTab.isVisible().catch(() => false)) await dashTab.click();
await page.waitForSelector("[data-testid='db-dashboard-view']", { timeout: 60_000 });

// 기본: 자동 소수 (최대 2자리, 천 단위 구분)
await valueIs("1,200.25", "기본(자동 소수)");

await page.getByTestId("db-dash-edit").click();

// 소수 0자리
await page.getByTestId("db-dashw-decimals-w-c").selectOption("0");
await valueIs("1,200", "소수 0자리");

// 접두어 $
await page.getByTestId("db-dashw-prefix-w-c").fill("$");
await page.getByTestId("db-dashw-prefix-w-c").blur();
await valueIs("$1,200", "접두어 $");

// 접미어
await page.getByTestId("db-dashw-suffix-w-c").fill(" USD");
await page.getByTestId("db-dashw-suffix-w-c").blur();
await valueIs("$1,200 USD", "접미어 USD");

// ±부호색: 양수는 + 와 초록
await page.getByTestId("db-dashw-sign-w-c").click();
await valueIs("+$1,200 USD", "부호색 켬(+)");
// Tailwind v4는 색을 lab()으로 계산한다 — a축이 음수면 초록, 양수면 빨강
const labA = (c) => { const m = c.match(/lab\([\d.]+ (-?[\d.]+)/); return m ? Number(m[1]) : NaN; };
const color = await page.locator("[data-testid='db-dashw-value-w-c']").evaluate((e) => getComputedStyle(e).color);
if (!(labA(color) < -20)) fails.push(`부호색: 양수 색이 초록이 아닙니다 (${color})`);

// 음수로 뒤집으면 - 와 빨강 (행 하나를 크게 음수로)
await api("POST", `/api/databases/${dbId}/rows`, { values: { [amountId]: -2000 } });
await valueIs("-$800 USD", "부호색 음수(-)");
const negColor = await page.locator("[data-testid='db-dashw-value-w-c']").evaluate((e) => getComputedStyle(e).color);
if (!(labA(negColor) > 20)) fails.push(`부호색: 음수 색이 빨강이 아닙니다 (${negColor})`);

// 정리
await page.request.fetch(`${BASE}/api/pages/${pageId}`, { method: "DELETE" });
await page.request.fetch(`${BASE}/api/databases/${dbId}`, { method: "DELETE" });
await browser.close();

if (fails.length) {
  console.error(`\n  ┌─ 카운터 포매팅 불일치 (${fails.length}건) ─────────────`);
  for (const f of fails) console.error(`  │ ${f}`);
  console.error("  └──────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("카운터 포매팅 OK — 자동/0자리 소수, $ 접두어, USD 접미어, ± 부호색(초록/빨강)");
