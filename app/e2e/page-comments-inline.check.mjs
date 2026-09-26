// A page's comments belong inside the page — not in a panel docked to the window.
//
// When the original opens a row page it puts a `Comments` section between the property band and the body
// and lays the threads out there. `.notion-page-view-discussion` is overflow-y: visible / max-height:
// none, so as comments grow the section gets longer and the page scrolls — no inner scroll.
// We used to open a 340px panel on the right.
//
//   [BASE_URL=…] [ROW_PAGE_ID=…] [USER_ID=…] node e2e/page-comments-inline.check.mjs
//
// Read-only: opens a row page and only reads coordinates.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { content } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
 // The page of a row with 3 comments (rowsWithComments in src/i18n/content/e2e-fixtures/notion-row-comments.json)
const ROW_PAGE_ID = process.env.ROW_PAGE_ID ?? "";

const F = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-row-comments.json", import.meta.url), "utf8"));
const I = F.inline;
const C = F.comment;
const M = F.mention;
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

if (!ROW_PAGE_ID) {
  console.error("\n  Give ROW_PAGE_ID — the page id of a row that has comments.");
  console.error("  How to find it: open a row with a badge in the table, take /p/<id> from the URL.\n");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${ROW_PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid='page-comment-section']", { timeout: 120_000 });
await page.waitForTimeout(1500);

const got = await page.evaluate(() => {
  const px = (v) => +Number(v).toFixed(2);
  const sec = document.querySelector("[data-testid='page-comment-section']");
  const sr = sec.getBoundingClientRect();
  const cs = getComputedStyle(sec);
  const rows = [...sec.querySelectorAll("div[data-testid^='comment-row-']")];
  const at = (el) => {
    if (!el) return null;
    const q = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { x: px(q.x - sr.x), y: px(q.y - sr.y), w: px(q.width), h: px(q.height),
             fs: s.fontSize, fw: s.fontWeight, lh: s.lineHeight, color: s.color,
             bg: s.backgroundColor, radius: s.borderRadius, pad: s.padding };
  };
  const first = rows[0];
  const spans = first ? first.querySelectorAll("span") : [];
  const avatars = rows.map((r) => px(r.getBoundingClientRect().y - sr.y));
  const mention = sec.querySelector("p span span")?.parentElement ?? null;
  return {
    count: rows.length,
    overflowY: cs.overflowY,
    maxHeight: cs.maxHeight,
    avatar: at(first && first.firstElementChild),
    author: at(spans[0]),
    date: at(spans[1]),
    body: at(first && first.querySelector("p")),
    pitch: avatars.length > 1 ? px(avatars[1] - avatars[0]) : null,
    mention: at(mention),
    composer: !!sec.querySelector("[data-testid='comment-composer-input']"),
    composerButtons: [...sec.querySelectorAll("button[aria-label]")].map((b) => {
      const q = b.getBoundingClientRect();
      return { label: b.getAttribute("aria-label"), w: px(q.width), h: px(q.height),
               radius: getComputedStyle(b).borderRadius, x: px(q.x - sr.x) };
    }),
 // Are page comments still also opening as a panel?
    dockedPanel: !!document.querySelector("[data-testid='comment-thread-panel']"),
  };
});
await browser.close();

const d = [];
const eq = (what, a, b) => { if (String(a) !== String(b)) d.push(`${what}: ours ${a} / Notion ${b}`); };
const near = (what, a, b, tol = 0.5) => {
  if (a === null || a === undefined || Math.abs(Number(a) - Number(b)) > tol)
    d.push(`${what}: ours ${a} / Notion ${b}`);
};

if (!got.count) d.push("Not a single comment was drawn (this page needs comments to measure)");
if (got.dockedPanel) d.push("A docked comment panel is still up — the original has none");

eq("outer scroll (no inner scroll)", got.overflowY, I.container.overflowY);
eq("no max height", got.maxHeight, I.container.maxHeight);

near("avatar left", got.avatar?.x, I.avatarLeft);
near("avatar size", got.avatar?.w, C.avatar.size);
near("name left", got.author?.x, I.textColumnLeftInset);
eq("name size", got.author?.fs, I.author.fs);
eq("name weight", got.author?.fw, I.author.fw);
eq("name color", got.author?.color, I.author.color);
eq("date size", got.date?.fs, I.date.fs);
eq("date color", got.date?.color, I.date.color);
near("body left", got.body?.x, I.textColumnLeftInset);
eq("body size", got.body?.fs, I.body.fs);
eq("body line height", got.body?.lh, I.body.lh);
eq("body color", got.body?.color, I.body.color);
if (got.avatar && got.body) near("body top - avatar top", got.body.y - got.avatar.y, C.bodyTopFromAvatarTop);
if (got.pitch !== null) near("one comment step", got.pitch, I.avatarPitch);

if (got.mention) {
  eq("mention background (not a chip)", got.mention.bg, M.bg);
  eq("mention radius (not a chip)", got.mention.radius, M.radius);
  eq("mention padding (not a chip)", got.mention.pad, M.padding);
  eq("mention color", got.mention.color, M.name.color);
} else {
  console.log("· no comment with a mention, so the mention was not measured");
}

if (!got.composer) d.push("No input row");
for (const want of I.composerButtons) {
  const b = got.composerButtons.find((x) => x.label === want.label);
  if (!b) { d.push(`input row button missing: ${want.label}`); continue; }
  near(`${want.label} width`, b.w, want.w);
  near(`${want.label} height`, b.h, want.h);
  eq(`${want.label} radius`, b.radius, want.radius);
}

if (d.length) {
  console.error("\n  ┌─ The in-page comment section differs from the original ─────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-row-comments.json (inline / comment / mention)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
// This section exists **only on database row pages**. It was once attached to full-page DBs and plain pages
// (2026-08-27), so that is checked here too. F.inline.surfaces is the reference.
const FULL_PAGE_DB = process.env.FULLPAGE_DB_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf";
const EMPTY_ROW = process.env.EMPTY_ROW_PAGE_ID ?? "";

const browser2 = await chromium.launch();
const ctx2 = await browser2.newContext({ viewport: { width: 1400, height: 900 } });
await ctx2.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const p2 = await ctx2.newPage();
const surface = async (id) => {
  await p2.goto(`${BASE}/p/${id}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await p2.waitForTimeout(5000);
  return p2.evaluate(() => {
    const px = (v) => +Number(v).toFixed(2);
    const sec = document.querySelector("[data-testid='page-comment-section']");
    const input = document.querySelector("[data-testid='comment-composer-input']");
    const av = sec?.querySelector("[data-testid='comment-composer-input']")
      ?.parentElement?.firstElementChild;
    const send = document.querySelector("[data-testid='comment-composer-submit']");
    const sr = sec?.getBoundingClientRect();
    const rel = (el) => {
      if (!el || !sr) return null;
      const q = el.getBoundingClientRect();
      return { x: px(q.x - sr.x), y: px(q.y - sr.y), w: px(q.width), h: px(q.height) };
    };
    return {
      discussion: document.querySelectorAll("[data-testid='page-comment-section']").length,
      composer: document.querySelectorAll("[data-testid='comment-composer-input']").length,
      commentLabel: document.querySelectorAll("[data-testid='row-props-comments']").length,
      avatar: rel(av),
      input: rel(input),
      placeholder: input?.getAttribute("placeholder") ?? null,
      inputPad: input ? getComputedStyle(input).padding : null,
      sendOpacity: send ? getComputedStyle(send).opacity : null,
    };
  });
};
const dbPage = await surface(FULL_PAGE_DB);
const emptyRow = EMPTY_ROW ? await surface(EMPTY_ROW) : null;
await browser2.close();

const s = [];
const want = (label, got, exp) => {
  for (const k of ["commentLabel", "discussion", "composer"])
    if (got[k] !== exp[k]) s.push(`${label} ${k}: ours ${got[k]} / Notion ${exp[k]}`);
};
want("full-page DB", dbPage, F.inline.surfaces.find((x) => new RegExp(content.PAGE_COMMENTS_INLINE.fullPageDb).test(x.page)));
if (emptyRow) {
  want("row page with no comments", emptyRow, F.inline.surfaces.find((x) => new RegExp(content.PAGE_COMMENTS_INLINE.noComments).test(x.page)));
 // Even with no comments, my avatar + `Add a comment` + the buttons must be there from the start.
 // It was once wrongly built as "appears when you click" (2026-08-27).
  const E = F.inline.emptyState;
  const nearE = (what, a, b, tol = 0.5) => {
    if (a === null || a === undefined || Math.abs(Number(a) - Number(b)) > tol)
      s.push(`empty state ${what}: ours ${a} / Notion ${b}`);
  };
  nearE("avatar left", emptyRow.avatar?.x, E.avatar.x);
  nearE("avatar top", emptyRow.avatar?.y, E.avatar.y);
  nearE("avatar size", emptyRow.avatar?.w, E.avatar.size);
  nearE("input left", emptyRow.input?.x, E.input.x);
  if (emptyRow.placeholder !== E.input.placeholder)
    s.push(`empty state placeholder: ours ${emptyRow.placeholder} / Notion ${E.input.placeholder}`);
  if (emptyRow.inputPad !== E.input.padding)
    s.push(`empty state input padding: ours ${emptyRow.inputPad} / Notion ${E.input.padding}`);
  if (emptyRow.sendOpacity !== E.sendOpacityWhenEmpty)
    s.push(`empty state send button opacity: ours ${emptyRow.sendOpacity} / Notion ${E.sendOpacityWhenEmpty}`);
} else console.log("· EMPTY_ROW_PAGE_ID not given, so the 'row page with no comments' was not measured");

if (s.length) {
  console.error("\n  ┌─ A comment section is on a page that must not have one ─────");
  for (const l of s) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-row-comments.json (inline.surfaces)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}

console.log(
  `${got.count} in-page comments — no inner scroll, avatar ${got.avatar.w} @x${got.avatar.x}, step ${got.pitch}, no docked panel` +
    `\nwhere the section appears also matches the original — full-page DB 0/0/0` +
    (emptyRow ? `, the row page with no comments has the input UI too (avatar @${emptyRow.avatar?.y})` : "")
);
