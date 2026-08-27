// Evaluation 을 한 곳에서 바꾸면 다른 창의 페이지/표에 즉시 보이는지 — 두 컨텍스트로 잰다.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] node e2e/row-props-live.check.mjs
//
// dev 데이터를 한 번 바꾸고(첫 행의 Evaluation) 끝에 되돌린다. 원본 기준: 노션은 다른 창의
// 변경이 새로고침 없이 그 자리에서 바뀐다 — 측정값이 아니라 동작의 기준이다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const fails = [];
const ok = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fails.push(label); };

const browser = await chromium.launch();
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
  return ctx;
};
const A = await (await mk()).newPage(); // 표 + 피크
const B = await (await mk()).newPage(); // 같은 행의 전체 페이지
await A.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await A.waitForSelector("[data-cellnav]", { timeout: 60_000 });
await A.locator("[data-cellnav]").first().hover();
await A.locator("text=열기").first().click();
await A.waitForSelector("[data-testid='db-row-peek'] [data-pinned-row]", { timeout: 30_000 });
const evalItem = A.locator("[data-testid='db-row-peek'] [data-testid^='row-props-item-'][data-type='select']").first();
const propId = (await evalItem.getAttribute("data-testid")).replace("row-props-item-", "");
const cellTestid = await evalItem.locator("[data-testid^='db-cell-']").first().getAttribute("data-testid");
const rowId = cellTestid.replace("db-cell-", "").replace(`-${propId}`, "");
const peekPageId = await A.locator("[data-testid='db-row-peek']").getAttribute("data-page-id");
const dbId = await A.evaluate(async (pid) => (await fetch(`/api/pages/${pid}/row`).then((r) => r.json())).ref?.databaseId, peekPageId);
// 원래 값과 옵션들
const snap = await A.evaluate(async (id) => fetch(`/api/databases/${id}`).then((r) => r.json()), dbId);
const prop = snap.properties.find((p) => p.id === propId);
const row = snap.rows.find((r) => r.id === rowId);
const before = row.values[propId] ?? null;
const target = prop.config.options.find((o) => o.id !== before);
console.log(`행 ${rowId.slice(0, 8)} ${prop.name}: ${before ?? "(비어 있음)"} → ${target.name}`);

// B: 같은 행의 전체 페이지
const bodyPageId = row.values.__page;
await B.goto(`${BASE}/p/${bodyPageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await B.waitForSelector("[data-testid='page-row-props'] [data-pinned-row]", { timeout: 30_000 });

const readA = () => A.locator(`[data-testid='db-row-peek'] [data-testid='row-props-item-${propId}'] [data-role='value']`).innerText();
const readB = () => B.locator(`[data-testid='page-row-props'] [data-testid='row-props-item-${propId}'] [data-role='value']`).innerText();
const readTable = () => A.locator(`[data-cellnav] [data-testid='db-cell-${rowId}-${propId}']`).first().innerText().catch(() => "");
const waitFor = async (read, want, label) => {
  const t0 = Date.now();
  for (;;) {
    const v = (await read()).trim();
    if (v === want) { ok(true, `${label}: "${want}" 반영 (${Date.now() - t0}ms)`); return; }
    if (Date.now() - t0 > 6000) { ok(false, `${label}: 6초 안에 "${want}" 가 안 옴 (지금 "${v}")`); return; }
    await new Promise((r) => setTimeout(r, 150));
  }
};

// 1) 페이지(B, 전체 페이지)에서 고른다 → 피크(A) 와 표(A) 에 즉시
await B.evaluate(() => { const sc = document.querySelector("[data-testid='page-row-props'] [data-pinned-row] > div"); sc.scrollLeft = sc.scrollWidth; });
await B.locator(`[data-testid='page-row-props'] [data-testid='row-props-item-${propId}'] [data-role='value']`).click();
await B.waitForSelector("[data-testid='db-select-menu']", { timeout: 5000 });
await B.locator(`[data-testid='db-option-${propId}-${target.id}']`).click();
await waitFor(readB, target.name, "전체 페이지 자신");
await waitFor(readA, target.name, "다른 창의 피크");
await waitFor(readTable, target.name, "다른 창의 표 셀");

// 2) 피크(A)에서 되돌린다 → 전체 페이지(B) 에 즉시. Evaluation 은 밴드 밖(오른쪽)에
//    있으니 원본에서처럼 밴드를 끝까지 밀고 누른다
await A.evaluate(() => { const sc = document.querySelector("[data-testid='db-row-peek'] [data-pinned-row] > div"); sc.scrollLeft = sc.scrollWidth; });
await A.waitForTimeout(300);
await A.locator(`[data-testid='db-row-peek'] [data-testid='row-props-item-${propId}'] [data-role='value']`).click();
await A.waitForSelector("[data-testid='db-select-menu']", { timeout: 5000 });
if (before) await A.locator(`[data-testid='db-option-${propId}-${before}']`).click();
else await A.locator(`[data-testid='db-option-${propId}-none']`).click();
const beforeName = before ? prop.config.options.find((o) => o.id === before).name : "비어 있음";
await waitFor(readA, beforeName, "피크 자신");
await waitFor(readB, beforeName, "다른 창의 전체 페이지");

await browser.close();
if (fails.length) { console.error(`\n${fails.length}개 실패`); process.exit(1); }
console.log("\n모든 창에 즉시 반영 — exit 0");
