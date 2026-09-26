// Enter during Hangul composition means "commit the syllable", not "send".
//
// Writing one comment and pressing Enter once posted two: the whole text, and 1-4ms later
// the last syllable on its own:
//
//   06:28:44.091  <whole comment>
//   06:28:44.095  <its last syllable>
//
// One keystroke arrives as two keydowns. The first is keyCode 229 ·
// isComposing=true (the IME saying it will commit the syllable), but we took it as send and
// cleared the input; the IME then wrote the syllable it was composing back into the empty input,
// and the second (ordinary) Enter sent that leftover too. Latin text does not compose, so it only
// showed up in Korean.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/ime-enter.check.mjs
//
// This script really creates comments — dev DB only. It deletes what it made at the end.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { content } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "27b5c5e5-467c-4620-bde7-8d087e8a9875";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const TEXT = content.IME_ENTER.text;

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
const posts = [];
page.on("request", (r) => {
  if (r.method() === "POST" && /\/comments$/.test(r.url())) posts.push(JSON.parse(r.postData() ?? "{}").body);
});
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid='comment-composer-input']", { timeout: 120_000 });
await page.waitForTimeout(1200);
await page.click("[data-testid='comment-composer-input']");

const cdp = await ctx.newCDPSession(page);
 // put the last syllable into a composing state
await cdp.send("Input.imeSetComposition", { text: TEXT, selectionStart: TEXT.length, selectionEnd: TEXT.length });
await page.waitForTimeout(150);

 // 1) Enter while composing (keyCode 229) — must send nothing
await cdp.send("Input.dispatchKeyEvent", {
  type: "rawKeyDown", key: "Enter", code: "Enter",
  windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229,
});
await page.waitForTimeout(700);
const afterComposing = posts.length;

 // 2) an ordinary Enter after the composition is committed — must send once, the whole text
await cdp.send("Input.insertText", { text: TEXT });
await page.waitForTimeout(200);
const beforeEnter = await page.inputValue("[data-testid='comment-composer-input']");
await page.keyboard.press("Enter");
await page.waitForTimeout(2000);

const value = await page.inputValue("[data-testid='comment-composer-input']");
await browser.close();

 // clean up the comments we made — so the check leaves no junk in the dev DB
const { Client } = await import("pg");
const url = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const pg = new Client({ connectionString: url });
await pg.connect();
const { rows } = await pg.query(
  "delete from comments where page_id=$1 and author_id=$2 and body like $3 returning body",
  [PAGE_ID, USER_ID, `%${TEXT}%`]
);
await pg.end();

const d = [];
if (afterComposing !== 0)
  d.push(`Enter while composing (keyCode 229) sent ${afterComposing} — should be 0`);
if (posts.length !== 1)
  d.push(`One Enter sent ${posts.length} (${posts.map((b) => JSON.stringify(b)).join(", ")}) — should be 1`);
if (posts.length && posts[0] !== TEXT)
  d.push(`Sent "${posts[0]}" — should be "${TEXT}" (the only-the-last-syllable-left symptom)`);
if (value !== "") d.push(`After sending, the input still holds "${value}"`);
if (beforeEnter !== TEXT)
  d.push(`Right before Enter the input was "${beforeEnter}" — composition commit was not reproduced (the check itself is broken)`);

if (d.length) {
  console.error("\n  ┌─ Enter during Hangul composition misbehaves ──────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ guard: src/hooks/use-ime-guard.ts");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`No send while composing, one send of "${posts[0]}" on Enter after commit — cleaned up ${rows.length} comments`);
