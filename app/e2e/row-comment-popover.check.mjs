// The card that opens from a row's comment badge — the original is a 480px popover (not a side panel).
//
// What we had was a 340px panel docked on the right: a header row, bordered thread
// cards, a blue reply button, a resolve button. The original shows none of that here
// and just stacks avatar·name·date·body in a single column.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/row-comment-popover.check.mjs
//
// Read-only: clicks the badge once and only reads coordinates.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai

const F = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-row-comments.json", import.meta.url), "utf8"));
const G = F.popover;
const C = F.comment;
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
const badge = page.locator("[data-testid='comment-count-badge']").first();
await badge.waitFor({ timeout: 120_000 });
await page.waitForTimeout(1200);
await badge.click();
await page.waitForSelector("[data-testid='row-comment-popover']", { timeout: 20_000 });
await page.waitForTimeout(900);

const got = await page.evaluate((resolveLabel) => {
  const px = (v) => +Number(v).toFixed(2);
  const e = document.querySelector("[data-testid='row-comment-popover']");
  const b = document.querySelector("[data-testid='comment-count-badge']");
  const r = e.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  const cs = getComputedStyle(e);
  const at = (el) => {
    if (!el) return null;
    const q = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { x: px(q.x - r.x), y: px(q.y - r.y), w: px(q.width), h: px(q.height),
             fs: s.fontSize, fw: s.fontWeight, lh: s.lineHeight, color: s.color };
  };
  const first = e.querySelector("div[data-testid^='comment-row-']");
  const spans = first ? first.querySelectorAll("span") : [];
  return {
    w: px(r.width),
    radius: cs.borderRadius,
    bg: cs.backgroundColor,
    shadow: cs.boxShadow,
    centerDelta: px(r.x + r.width / 2 - (br.x + br.width / 2)),
    gapBelowBadge: px(r.y - br.bottom),
    avatar: at(first && first.firstElementChild),
    author: at(spans[0]),
    date: at(spans[1]),
    body: at(first && first.querySelector("p")),
    composer: !!e.querySelector("[data-testid='comment-composer-input']"),
    placeholder: e.querySelector("[data-testid='comment-composer-input']")?.getAttribute("placeholder"),
 // Things the original does not show here
    hasResolve: new RegExp(`${resolveLabel}|Resolve`).test(e.innerText),
    hasHeader: !!e.querySelector("header"),
    borderedCards: [...e.querySelectorAll("div")].filter(
      (n) => getComputedStyle(n).borderTopWidth !== "0px"
    ).length,
  };
}, ko("Resolve"));
await browser.close();

const d = [];
const eq = (what, a, b) => { if (String(a) !== String(b)) d.push(`${what}: ours ${a} / Notion ${b}`); };
const near = (what, a, b, tol = 0.5) => {
  if (a === null || Math.abs(Number(a) - Number(b)) > tol) d.push(`${what}: ours ${a} / Notion ${b}`);
};

eq("width", got.w, G.w);
eq("radius", got.radius, G.radius);
eq("background", got.bg, G.bg);
eq("shadow", got.shadow, G.shadow);
near("centered on the badge", got.centerDelta, 0);
near("gap below the badge", got.gapBelowBadge, 4);

near("avatar left", got.avatar?.x, G.insetLeft);
near("avatar top", got.avatar?.y, G.insetTop);
near("avatar size", got.avatar?.w, C.avatar.size);

near("name left", got.author?.x, C.textColumnLeftInset);
near("name top", got.author?.y, G.insetTop + C.authorTopFromAvatarTop);
eq("name size", got.author?.fs, C.author.fs);
eq("name weight", got.author?.fw, C.author.fw);
eq("name color", got.author?.color, C.author.color);

eq("date size", got.date?.fs, C.date.fs);
eq("date color", got.date?.color, C.date.color);
near("gap between name and date", got.date && got.author ? got.date.x - (got.author.x + got.author.w) : null, C.date.gapAfterAuthor);

near("body left", got.body?.x, C.textColumnLeftInset);
near("body top", got.body?.y, G.insetTop + C.bodyTopFromAvatarTop);
eq("body size", got.body?.fs, C.body.fs);
eq("body line height", got.body?.lh, C.body.lineHeight);
eq("body color", got.body?.color, C.body.color);

if (!got.composer) d.push("No input row at the bottom");
eq("input row placeholder", got.placeholder, F.composer.placeholder);
if (got.hasResolve) d.push("There is a resolve button — the original does not put one in this popover");
if (got.hasHeader) d.push("There is a header row — the original has none");
if (got.borderedCards) d.push(`${got.borderedCards} bordered cards — the original just stacks in a single column`);

if (d.length) {
  console.error("\n  ┌─ The row comment popover differs from the original ──────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-row-comments.json (popover / comment / composer)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `Popover matches the original — ${got.w}px, centered on the badge, avatar ${got.avatar.w} @${got.avatar.y}, body @${got.body.y}`
);
