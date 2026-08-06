// A hover affordance has a SCOPE, and the only way to see the scope is to look
// at what did NOT light up.
//
// The original shows 열기 for the whole row and 댓글/복사 for the one column the
// pointer is in. We shipped both keyed to the row's hover group, so pointing at
// any cell lit the 댓글 button in every qualifying cell of that row. Nothing was
// missing or misplaced — the button I checked was exactly where it belonged —
// so measuring the hovered cell alone said "correct" every time. The bug lives
// in the siblings.
//
// Hovers cells across one row and asserts, for each: exactly ONE cell shows an
// action bar and it is the hovered one, while 열기 stays lit throughout.
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] \
//     node e2e/db-hover-scope.check.mjs
//
// Read-only: hovering changes nothing, and nothing is clicked.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238"; // Projects
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
await ctx.addCookies([
  { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });

// a row with enough action-bearing cells for "only one" to mean something
const probe = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("div")].filter((d) =>
    d.className.includes?.("group/dbrow"),
  );
  for (const r of rows) {
    const acts = r.querySelectorAll(
      "[data-testid^='db-cell-comment-'],[data-testid^='db-cell-copy-']",
    );
    if (acts.length >= 3) {
      r.dataset.hoverProbe = "1";
      return { actions: acts.length, cells: r.querySelectorAll(":scope > [data-cellnav]").length };
    }
  }
  return null;
});
if (!probe) {
  console.error("no row with 3+ action cells — nothing to check");
  await browser.close();
  process.exit(1);
}

const cells = page.locator("[data-hover-probe='1'] > [data-cellnav]");
const total = await cells.count();
const withActions = await page.evaluate(() =>
  [...document.querySelectorAll("[data-hover-probe='1'] > [data-cellnav]")]
    .map((c, i) =>
      c.querySelector("[data-testid^='db-cell-comment-'],[data-testid^='db-cell-copy-']") ? i : -1,
    )
    .filter((i) => i >= 0),
);

const failures = [];
for (const i of withActions) {
  await cells.nth(i).hover();
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => {
    const row = document.querySelector("[data-hover-probe='1']");
    const lit = [];
    [...row.querySelectorAll(":scope > [data-cellnav]")].forEach((c, idx) => {
      const bar = c.querySelector(
        "[data-testid^='db-cell-comment-'],[data-testid^='db-cell-copy-']",
      )?.parentElement;
      if (bar && Number(getComputedStyle(bar).opacity) > 0.5) lit.push(idx);
    });
    const open = row.querySelector("[aria-label='사이드 보기에서 열기']");
 // the BUTTON's own painted opacity, not its parent's: reading the parent was
 // reading the cell, which is always 1, and it hid a button that never showed
    const openOpacity = open
      ? [open, ...(function up(e) { const out = []; let n = e; while (n && n !== row) { out.push(n); n = n.parentElement; } return out; })(open)]
          .reduce((acc, n) => acc * Number(getComputedStyle(n).opacity), 1)
      : null;
    return { lit, open: openOpacity };
  });
  const ok = state.lit.length === 1 && state.lit[0] === i;
  if (!ok) failures.push(`hover cell #${i}: lit ${JSON.stringify(state.lit)}, expected [${i}]`);
  if (!(state.open > 0.5)) failures.push(`hover cell #${i}: 열기 not shown (${state.open})`);
  console.log(`cell #${i} → lit ${JSON.stringify(state.lit)}  열기 ${state.open}`);
}

await browser.close();

if (failures.length) {
  console.error("\n셀 호버 범위가 틀렸습니다:");
  for (const f of failures) console.error(`  ${f}`);
  console.error("\n댓글/복사는 포인터가 있는 셀 하나만, 열기는 행 전체입니다.");
  console.error("group-hover/dbrow 로 걸면 그 행의 모든 셀이 같이 켜집니다.\n");
  process.exit(1);
}
console.log(`\n호버 범위 정상 — ${withActions.length}개 셀 각각 자기 것만 켬 (행 ${total}칸)`);
