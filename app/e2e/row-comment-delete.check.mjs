// 표의 댓글 배지를 눌러 연 카드(행 댓글 팝오버) 안에서 댓글을 지울 수 있는가.
//
// comcom 제보(프로드): "데이터베이스 테이블의 댓글 아이콘 클릭하면 모달로 스레드 뜨는데,
// 그 안의 ... 에서 삭제하기 하면 삭제가 안 된다."
//
// 페이지 댓글 섹션에서는 되던 삭제가 이 카드에서만 죽어 있었다. 카드는 바깥을 누르면
// 닫히는데(useDismiss), ⋯ 메뉴와 확인창은 document.body 로 포털된 **다른 층**이라
// 거기를 누르는 것이 "바깥 클릭"으로 판정됐다 — 카드가 먼저 닫히며 메뉴·확인창을 품은
// 컴포넌트가 사라지고, 삭제는 끝내 불리지 않는다. e2e/comment-delete.check.mjs 는 페이지
// 섹션만 재서 이걸 놓쳤다.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/row-comment-delete.check.mjs
//
// 자기가 단 댓글 하나만 쓰고, 성공이든 실패든 끝나면 지운다.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pg = new Client({ connectionString: env.match(/^POSTGRES_URL=(.*)$/m)[1].trim() });
await pg.connect();
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const MARK = `ZZ row-popover delete ${Date.now()}`;

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};
const stored = async () =>
  (await pg.query("select id from comments where body=$1", [MARK])).rows.map((r) => r.id);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const popover = () => page.locator("[data-testid='row-comment-popover']");

try {
  await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  const badge = page.locator("[data-testid='comment-count-badge']").first();
  await badge.waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1200);
  await badge.click();
  await popover().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(700);
  check("0. 표의 댓글 배지로 카드가 열린다", (await popover().count()) === 1);

  // 이 카드의 입력줄로 내 댓글을 하나 단다
  const input = popover().locator("[data-testid='comment-composer-input']");
  await input.click();
  await input.type(MARK, { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const ids = await stored();
  check("1. 카드에서 댓글을 달았다", ids.length === 1, `stored=${ids.length}`);
  const id = ids[0];
  const row = popover().locator(`[data-testid='comment-row-${id}']`);
  await row.waitFor({ timeout: 10_000 });

  // ⋯ → 삭제하기
  await row.hover();
  await page.waitForTimeout(300);
  await page.locator(`[data-testid='comment-more-${id}']`).click();
  const menu = page.locator(`[data-testid='comment-menu-${id}']`);
  await menu.waitFor({ timeout: 5000 }).catch(() => {});
  check("2. ⋯ 를 누르면 메뉴가 뜬다", (await menu.count()) === 1);
  check("2. 메뉴를 여는 동안 카드는 열려 있다", (await popover().count()) === 1);

  await page.locator(`[data-testid='comment-delete-${id}']`).click().catch(() => {});
  await page.waitForTimeout(500);
  const confirm = page.locator(`[data-testid='comment-delete-confirm-${id}']`);
  check("3. 삭제하기를 누르면 확인창이 뜬다", (await confirm.count()) === 1);
  check("3. 삭제하기를 눌러도 카드가 닫히지 않는다", (await popover().count()) === 1);

  // 삭제
  await page.locator(`[data-testid='comment-delete-yes-${id}']`).click().catch(() => {});
  await page.waitForTimeout(1500);
  check("4. 서버에서 댓글이 지워졌다", (await stored()).length === 0, `stored=${(await stored()).length}`);
  check("4. 카드에서도 사라졌다", (await row.count()) === 0);
  check("4. 확인창이 닫혔다", (await confirm.count()) === 0);
  check("4. 카드는 여전히 열려 있다 (다른 댓글을 계속 볼 수 있게)", (await popover().count()) === 1);

  // 취소 경로: 취소를 눌러도 카드는 닫히지 않는다
  await input.click();
  await input.type(`${MARK} cancel`, { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const [cid] = (await pg.query("select id from comments where body=$1", [`${MARK} cancel`])).rows.map((r) => r.id);
  if (cid) {
    const crow = popover().locator(`[data-testid='comment-row-${cid}']`);
    await crow.hover();
    await page.waitForTimeout(300);
    await page.locator(`[data-testid='comment-more-${cid}']`).click().catch(() => {});
    await page.locator(`[data-testid='comment-delete-${cid}']`).click().catch(() => {});
    await page.waitForTimeout(400);
    await page.locator(`[data-testid='comment-delete-no-${cid}']`).click().catch(() => {});
    await page.waitForTimeout(500);
    check("5. 취소하면 댓글이 남고 카드도 열려 있다",
      (await crow.count()) === 1 && (await popover().count()) === 1);
  } else {
    check("5. 취소 검사용 댓글을 달았다", false);
  }

  // 카드 바깥을 누르면 여전히 닫힌다 (고치다 이걸 망가뜨리면 안 된다)
  await page.mouse.click(40, 860);
  await page.waitForTimeout(500);
  check("6. 카드 바깥을 누르면 카드는 닫힌다", (await popover().count()) === 0);

  check("Z. 페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("실행", false, String(e).slice(0, 300));
} finally {
  await pg.query("delete from comments where body like $1", [`${MARK}%`]).catch(() => {});
  await pg.end();
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
