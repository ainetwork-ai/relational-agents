// Can a comment be deleted inside the card opened from a table's comment badge (the row comment popover)?
//
// comcom report (prod): "Clicking the comment icon in a database table opens the thread in a modal,
// but choosing Delete from the ... in there does not delete it."
//
// Deletion that worked in the page comment section was dead only in this card. The card closes on an
// outside click (useDismiss), and the ⋯ menu and the confirm are **other layers** portaled to document.body,
// so clicking there counted as an "outside click" — the card closed first, the component holding the
// menu·confirm went away, and delete was never called. e2e/comment-delete.check.mjs only measures the page
// section and missed this.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/row-comment-delete.check.mjs
//
// Only uses one comment of its own, and removes it at the end whether it passes or fails.
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
  check("0. the table's comment badge opens the card", (await popover().count()) === 1);

  // Post one comment of mine through this card's input row
  const input = popover().locator("[data-testid='comment-composer-input']");
  await input.click();
  await input.type(MARK, { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const ids = await stored();
  check("1. posted a comment from the card", ids.length === 1, `stored=${ids.length}`);
  const id = ids[0];
  const row = popover().locator(`[data-testid='comment-row-${id}']`);
  await row.waitFor({ timeout: 10_000 });

  // ⋯ → Delete
  await row.hover();
  await page.waitForTimeout(300);
  await page.locator(`[data-testid='comment-more-${id}']`).click();
  const menu = page.locator(`[data-testid='comment-menu-${id}']`);
  await menu.waitFor({ timeout: 5000 }).catch(() => {});
  check("2. clicking ⋯ shows the menu", (await menu.count()) === 1);
  check("2. the card stays open while the menu is open", (await popover().count()) === 1);

  await page.locator(`[data-testid='comment-delete-${id}']`).click().catch(() => {});
  await page.waitForTimeout(500);
  const confirm = page.locator(`[data-testid='comment-delete-confirm-${id}']`);
  check("3. clicking Delete shows the confirm", (await confirm.count()) === 1);
  check("3. clicking Delete does not close the card", (await popover().count()) === 1);

  // Delete
  await page.locator(`[data-testid='comment-delete-yes-${id}']`).click().catch(() => {});
  await page.waitForTimeout(1500);
  check("4. the comment was deleted on the server", (await stored()).length === 0, `stored=${(await stored()).length}`);
  check("4. and disappeared from the card", (await row.count()) === 0);
  check("4. the confirm closed", (await confirm.count()) === 0);
  check("4. the card is still open (so the other comments stay visible)", (await popover().count()) === 1);

  // Cancel path: clicking Cancel does not close the card either
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
    check("5. cancelling keeps the comment and the card stays open",
      (await crow.count()) === 1 && (await popover().count()) === 1);
  } else {
    check("5. posted the comment for the cancel check", false);
  }

  // Clicking outside the card still closes it (the fix must not break this)
  await page.mouse.click(40, 860);
  await page.waitForTimeout(500);
  check("6. clicking outside the card closes it", (await popover().count()) === 0);

  // Deleting the only comment of a row: the badge disappears, and the card anchored to the badge closes too.
  // (Before the fix the card lost its anchor, jumped to the top left of the screen and showed "No comments yet")
  {
    // Pick a visible row with no comments and post exactly one comment of mine on it
    const rowIds = await page.$$eval("[data-dbrow]", (els) =>
      els.filter((e) => !e.querySelector("[data-testid='comment-count-badge']"))
        .map((e) => e.getAttribute("data-testid").replace("db-row-", "")));
    let sole = null;
    for (const rid of rowIds) {
      const pid = (await pg.query("select values->>'__page' p from db_rows where id::text=$1", [rid])).rows[0]?.p;
      if (!pid) continue;
      const n = (await pg.query("select count(*)::int n from comments where page_id::text=$1", [pid])).rows[0].n;
      if (n === 0) { sole = { rid, pid }; break; }
    }
    check("7. found a row with no comments", !!sole);
    if (sole) {
      const r = await fetch(`${BASE}/api/pages/${sole.pid}/comments`, {
        method: "POST",
        headers: { cookie: `rm-session=${cookie}`, "content-type": "application/json" },
        body: JSON.stringify({ body: `${MARK} sole` }),
      });
      const sid = (await pg.query("select id from comments where body=$1", [`${MARK} sole`])).rows[0]?.id;
      check("7. posted one comment on that row", r.ok && !!sid, `status=${r.status}`);
      await page.reload({ waitUntil: "domcontentloaded" });
      const soleBadge = page.locator(`[data-testid='db-row-${sole.rid}'] [data-testid='comment-count-badge']`).first();
      await soleBadge.waitFor({ timeout: 120_000 });
      await page.waitForTimeout(1200);
      await soleBadge.click();
      await popover().waitFor({ timeout: 10_000 });
      const srow = popover().locator(`[data-testid='comment-row-${sid}']`);
      await srow.waitFor({ timeout: 10_000 });
      await srow.hover();
      await page.waitForTimeout(300);
      await page.locator(`[data-testid='comment-more-${sid}']`).click().catch(() => {});
      await page.locator(`[data-testid='comment-delete-${sid}']`).click().catch(() => {});
      await page.waitForTimeout(400);
      await page.locator(`[data-testid='comment-delete-yes-${sid}']`).click().catch(() => {});
      await page.waitForTimeout(1500);
      check("7. the last comment was deleted on the server",
        (await pg.query("select 1 from comments where id=$1", [sid])).rowCount === 0);
      check("7. the badge disappears", (await soleBadge.count()) === 0);
      check("7. the card closes too (does not jump to the top left)", (await popover().count()) === 0);
    }
  }

  check("Z. no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("run", false, String(e).slice(0, 300));
} finally {
  await pg.query("delete from comments where body like $1", [`${MARK}%`]).catch(() => {});
  await pg.end();
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
