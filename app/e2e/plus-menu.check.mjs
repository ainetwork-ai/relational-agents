// 거터 + 클릭: 내용 있는 줄이면 아래에 빈 줄을 만들어, 빈 줄이면 그 줄에서 타입 메뉴를
// 연다 — "/" 글자 없이, 캐럿은 맨 앞, 필터 플레이스홀더에 옅은 알약 배경. 메뉴 치수와
// 줄 기준 위치를 원본(fixtures/notion-plus-menu.json)과 대조한다. 페이지를 스스로 만든다.
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/plus-menu.check.mjs
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-plus-menu.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };
const created = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "plus-menu.check" }) }).then((r) => r.json());
const pageId = created.page?.id ?? created.id;
const A = { id: crypto.randomUUID(), type: "paragraph", content: { text: "내용" }, parentBlockId: null, position: 1 };
const B = { id: crypto.randomUUID(), type: "paragraph", content: { text: "" }, parentBlockId: null, position: 2 };
await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({ blocks: [A, B], deletedIds: [], newIds: [A.id, B.id] }) });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(`[data-testid="block-${A.id}"]`, { timeout: 60_000 }); await page.waitForTimeout(300);
const fails = []; let checks = 0;
const eq = (label, got, want, tol = 0.5) => { checks++; const ok = typeof want === "number" ? Math.abs(got - want) <= tol : got === want; if (!ok) fails.push(`${label}: ${got} ≠ ${want}`); };
const read = () => page.evaluate(() => { const f = (v) => +v.toFixed(1); const rows = [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')]; const sel0 = window.getSelection(); const row = rows.find((r) => sel0?.anchorNode && r.contains(sel0.anchorNode)) ?? null; const ed = row?.querySelector('[data-testid^="block-editable-"]') ?? null; const cr = row?.getBoundingClientRect(); const b4 = ed && getComputedStyle(ed, "::before"); const sel = window.getSelection(); const menu = document.querySelector('[data-testid="slash-menu"]'); const mr = menu?.getBoundingClientRect(); const item = menu?.querySelector("button"); const footer = menu && [...menu.querySelectorAll("div")].find((d) => /메뉴 닫기/.test(d.textContent) && d.children.length === 2); return { blocks: rows.length, focusedRowIdx: row ? rows.indexOf(row) : -1, text: ed?.innerText ?? null, caret: sel?.anchorOffset ?? null, placeholder: ed?.getAttribute("data-placeholder"), pillBg: b4?.backgroundColor, menu: mr && { w: f(mr.width), h: f(mr.height), left: f(mr.left - cr.left), gap: f(mr.top - cr.bottom), radius: getComputedStyle(menu).borderRadius, listMaxH: getComputedStyle(menu.firstElementChild).maxHeight, itemH: f(item.getBoundingClientRect().height), footerH: footer && f(footer.getBoundingClientRect().height) } }; });
const before = await page.evaluate(() => document.querySelectorAll('[data-testid="editor-root"] [data-block-type]').length);
for (const [label, id, expectNew] of [["내용 줄", A.id, true], ["빈 줄", B.id, false]]) {
  await page.locator(`[data-testid="block-${id}"]`).hover({ position: { x: 80, y: 6 } }); await page.waitForTimeout(150);
  await page.locator(`[data-testid="block-add-below-${id}"]`).click(); await page.waitForTimeout(400);
  const s = await read();
  eq(`${label}: 줄 추가`, s.blocks - before - (label === "빈 줄" ? 1 : 0), expectNew ? 1 : 0);
  eq(`${label}: 줄 텍스트`, s.text, "");
  eq(`${label}: 캐럿 위치`, s.caret, G.behaviour.caretOffset);
  eq(`${label}: 플레이스홀더`, s.placeholder, G.placeholder.text);
  eq(`${label}: 플레이스홀더 알약`, s.pillBg, G.placeholder.pillBg);
  if (!s.menu) fails.push(`${label}: 메뉴가 열리지 않음`);
  else { eq(`${label}: 메뉴 폭`, s.menu.w, G.menu.w); eq(`${label}: 메뉴 높이`, s.menu.h, G.menu.h); eq(`${label}: 메뉴 왼쪽`, s.menu.left, G.menu.leftFromBlock); eq(`${label}: 줄과의 간격`, s.menu.gap, G.menu.gap); eq(`${label}: radius`, s.menu.radius, G.menu.radius); eq(`${label}: 리스트 max-h`, s.menu.listMaxH, G.menu.listMaxH); eq(`${label}: 항목 높이`, s.menu.itemH, G.menu.itemH); eq(`${label}: 푸터 높이`, s.menu.footerH, G.menu.footerH); }
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
}
await browser.close();
await fetch(`${BASE}/api/pages/${pageId}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});
if (fails.length) { console.log(`  ┌─ + 메뉴가 원본과 다릅니다 (${fails.length}/${checks}) ─────`); for (const f of fails) console.log(`  │ ${f}`); console.log("  └────────────────────────────────────────────────"); process.exit(1); }
console.log(`+ 메뉴 원본과 일치 — ${checks}개 체크 (내용 줄/빈 줄)`);
