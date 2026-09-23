// 사이드바 페이지 행: 호버하면 무엇이 나오고, ⋯ 메뉴를 실제로 누를 수 있는가.
//
// 두 가지를 잡는다.
//  1) 원본의 행 버튼은 `>` · `⋯` · `+` 세 개뿐이다(각 20×20). 우리에겐 여섯 점
//     손잡이가 하나 더 있었다.
//  2) 액션이 `group-hover` 로만 보이면, 포인터가 메뉴로 가는 순간 트리거가
//     display:none 이 되고 CSS 앵커가 사라져 메뉴가 접힌다 — 항목을 누를 수가
//     없었다. 메뉴가 열려 있는 동안에는 계속 보여야 한다.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/sidebar-row.check.mjs
//
// 이름을 실제로 바꾸지는 않는다(입력창이 떴는지만 보고 Escape).

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";

const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-sidebar-row.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 870 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='page-tree-item-']", { timeout: 120_000 });
await page.waitForTimeout(1000);

const row = page.locator("[data-testid^='page-tree-item-']").first();
const id = (await row.getAttribute("data-testid")).replace("page-tree-item-", "");
await row.hover();
await page.waitForTimeout(300);

const btns = await page.evaluate((id) => {
  const r = document.querySelector(`[data-testid='page-tree-item-${id}']`);
  return [...r.querySelectorAll("button")]
    .filter((b) => getComputedStyle(b).display !== "none" && getComputedStyle(b.parentElement).display !== "none")
    .map((b) => {
      const q = b.getBoundingClientRect();
      const svg = b.querySelector("svg");
      return { testid: b.dataset.testid ?? "", label: b.getAttribute("aria-label"),
        w: Math.round(q.width), h: Math.round(q.height), icon: svg ? Math.round(svg.getBoundingClientRect().width) : null };
    });
}, id);

const d = [];
const near = (w, got, want, tol = 1) => { if (Math.abs(Number(got) - Number(want)) > tol) d.push(`${w}: 우리 ${got} / 노션 ${want}`); };

if (btns.some((b) => /drag/.test(b.testid)))
  d.push("행에 드래그 손잡이(여섯 점)가 있습니다 — 원본에는 없습니다");
if (btns.length !== G.buttons.length)
  d.push(`호버 버튼 수: 우리 ${btns.length}(${btns.map((b) => b.label).join(", ")}) / 노션 ${G.buttons.length}`);
btns.forEach((b, i) => {
  const want = G.buttons[i];
  if (!want) return;
  near(`버튼 ${i} 크기`, b.w, want.size);
  near(`버튼 ${i} 높이`, b.h, want.size);
  near(`버튼 ${i} 아이콘`, b.icon, want.icon);
});

// ⋯ 를 열고 포인터를 행 밖으로 뺀 뒤에도 메뉴가 그대로 있고 눌리는가
await page.locator(`[data-testid='page-item-menu-${id}']`).click();
await page.waitForTimeout(350);
const menu = page.locator(`[data-testid='page-menu-${id}']`);
const before = await menu.boundingBox();
await page.mouse.move(700, 500);
await page.waitForTimeout(400);
const after = await menu.boundingBox();
if (!before) d.push("⋯ 를 눌러도 메뉴가 열리지 않습니다");
else if (!after) d.push("포인터가 행을 벗어나자 메뉴가 사라집니다");
else if (Math.abs(after.x - before.x) > 2 || Math.abs(after.y - before.y) > 2 || Math.abs(after.height - before.height) > 2)
  d.push(`행을 벗어나자 메뉴가 움직였습니다: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);

if (after) {
  await page.locator(`[data-testid='page-menu-rename-${id}']`).click().catch(() => d.push("메뉴 항목을 누를 수 없습니다"));
  await page.waitForTimeout(400);
  const editing = await page.locator(`[data-testid='page-rename-input-${id}']`).isVisible().catch(() => false);
  if (!editing) d.push("이름 바꾸기를 눌러도 입력창이 뜨지 않습니다");
  await page.keyboard.press("Escape");
}

await browser.close();
if (d.length) {
  console.error(`\n  ┌─ 사이드바 행이 원본과 다릅니다 (${d.length}건) ────────────────`);
  for (const x of d) console.error(`  │ ${x}`);
  console.error("  │\n  │ 기준: e2e/fixtures/notion-sidebar-row.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("사이드바 행 정상 — 버튼 3개(20×20), ⋯ 메뉴가 행을 벗어나도 남고 항목이 눌립니다");
