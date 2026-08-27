// 행 댓글 배지를 누르면 열리는 카드 — 원본은 480px 팝오버다(사이드 패널이 아니다).
//
// 우리가 갖고 있던 것은 오른쪽 340px 도킹 패널이었다: 헤더 줄, 테두리 친 스레드
// 카드, 파란 답글 버튼, 해결 버튼. 원본은 이 자리에서 그중 아무것도 보여주지 않고
// 아바타·이름·날짜·본문만 한 줄기로 쌓는다.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/row-comment-popover.check.mjs
//
// 읽기 전용: 배지를 한 번 누르고 좌표만 읽는다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai

const F = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-row-comments.json", import.meta.url), "utf8"));
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

const got = await page.evaluate(() => {
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
  const first = e.querySelector("div[data-testid^='row-comment-']");
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
    composer: !!e.querySelector("[data-testid='row-comment-input']"),
    placeholder: e.querySelector("[data-testid='row-comment-input']")?.getAttribute("placeholder"),
 // 원본이 이 자리에서 안 보여주는 것들
    hasResolve: /해결|Resolve/.test(e.innerText),
    hasHeader: !!e.querySelector("header"),
    borderedCards: [...e.querySelectorAll("div")].filter(
      (n) => getComputedStyle(n).borderTopWidth !== "0px"
    ).length,
  };
});
await browser.close();

const d = [];
const eq = (what, a, b) => { if (String(a) !== String(b)) d.push(`${what}: 우리 ${a} / 노션 ${b}`); };
const near = (what, a, b, tol = 0.5) => {
  if (a === null || Math.abs(Number(a) - Number(b)) > tol) d.push(`${what}: 우리 ${a} / 노션 ${b}`);
};

eq("폭", got.w, G.w);
eq("라운드", got.radius, G.radius);
eq("배경", got.bg, G.bg);
eq("그림자", got.shadow, G.shadow);
near("배지와의 가운데 정렬", got.centerDelta, 0);
near("배지 아래 간격", got.gapBelowBadge, 4);

near("아바타 왼쪽", got.avatar?.x, G.insetLeft);
near("아바타 위", got.avatar?.y, C.avatarTop);
near("아바타 크기", got.avatar?.w, C.avatar.size);

near("이름 왼쪽", got.author?.x, C.textColumnLeftInset);
near("이름 위", got.author?.y, C.authorTop);
eq("이름 크기", got.author?.fs, C.author.fs);
eq("이름 굵기", got.author?.fw, C.author.fw);
eq("이름 색", got.author?.color, C.author.color);

eq("날짜 크기", got.date?.fs, C.date.fs);
eq("날짜 색", got.date?.color, C.date.color);
near("이름과 날짜 간격", got.date && got.author ? got.date.x - (got.author.x + got.author.w) : null, C.date.gapAfterAuthor);

near("본문 왼쪽", got.body?.x, C.textColumnLeftInset);
near("본문 위", got.body?.y, C.bodyTop);
eq("본문 크기", got.body?.fs, C.body.fs);
eq("본문 줄높이", got.body?.lh, C.body.lineHeight);
eq("본문 색", got.body?.color, C.body.color);

if (!got.composer) d.push("아래쪽 입력줄이 없습니다");
eq("입력줄 플레이스홀더", got.placeholder, F.composer.placeholder);
if (got.hasResolve) d.push("해결 버튼이 있습니다 — 원본은 이 팝오버에 두지 않습니다");
if (got.hasHeader) d.push("헤더 줄이 있습니다 — 원본에는 없습니다");
if (got.borderedCards) d.push(`테두리 친 카드가 ${got.borderedCards}개 있습니다 — 원본은 한 줄기로 쌓기만 합니다`);

if (d.length) {
  console.error("\n  ┌─ 행 댓글 팝오버가 원본과 다릅니다 ────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-row-comments.json (popover / comment / composer)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `팝오버 원본과 일치 — ${got.w}px, 배지 가운데, 아바타 ${got.avatar.w} @${got.avatar.y}, 본문 @${got.body.y}`
);
