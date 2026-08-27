// 페이지의 댓글은 페이지 안에 있어야 한다 — 창에 도킹된 패널이 아니라.
//
// 원본은 행 페이지를 열면 속성 밴드와 본문 사이에 `댓글` 섹션을 두고 거기에
// 스레드를 깐다. `.notion-page-view-discussion` 은 overflow-y: visible / max-height:
// none 이라 댓글이 늘면 섹션이 길어지고 페이지가 스크롤된다 — 안쪽 스크롤이 없다.
// 우리는 오른쪽 340px 패널을 열고 있었다.
//
//   [BASE_URL=…] [ROW_PAGE_ID=…] [USER_ID=…] node e2e/page-comments-inline.check.mjs
//
// 읽기 전용: 행 페이지를 열어 좌표만 읽는다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
 // 댓글 3개가 달린 행의 페이지 (e2e/fixtures/notion-row-comments.json 의 rowsWithComments)
const ROW_PAGE_ID = process.env.ROW_PAGE_ID ?? "";

const F = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-row-comments.json", import.meta.url), "utf8"));
const I = F.inline;
const C = F.comment;
const M = F.mention;
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

if (!ROW_PAGE_ID) {
  console.error("\n  ROW_PAGE_ID 를 주세요 — 댓글이 달린 행의 페이지 id 입니다.");
  console.error("  찾는 법: 표에서 배지가 붙은 행을 열고 URL 의 /p/<id>.\n");
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
 // 페이지 댓글이 여전히 패널로도 열리고 있지는 않은가
    dockedPanel: !!document.querySelector("[data-testid='comment-thread-panel']"),
  };
});
await browser.close();

const d = [];
const eq = (what, a, b) => { if (String(a) !== String(b)) d.push(`${what}: 우리 ${a} / 노션 ${b}`); };
const near = (what, a, b, tol = 0.5) => {
  if (a === null || a === undefined || Math.abs(Number(a) - Number(b)) > tol)
    d.push(`${what}: 우리 ${a} / 노션 ${b}`);
};

if (!got.count) d.push("댓글이 하나도 안 그려졌습니다 (이 페이지에 댓글이 있어야 잽니다)");
if (got.dockedPanel) d.push("도킹된 댓글 패널이 아직 떠 있습니다 — 원본에는 없습니다");

eq("바깥 스크롤 (안쪽 스크롤 금지)", got.overflowY, I.container.overflowY);
eq("최대 높이 없음", got.maxHeight, I.container.maxHeight);

near("아바타 왼쪽", got.avatar?.x, I.avatarLeft);
near("아바타 크기", got.avatar?.w, C.avatar.size);
near("이름 왼쪽", got.author?.x, I.textColumnLeftInset);
eq("이름 크기", got.author?.fs, I.author.fs);
eq("이름 굵기", got.author?.fw, I.author.fw);
eq("이름 색", got.author?.color, I.author.color);
eq("날짜 크기", got.date?.fs, I.date.fs);
eq("날짜 색", got.date?.color, I.date.color);
near("본문 왼쪽", got.body?.x, I.textColumnLeftInset);
eq("본문 크기", got.body?.fs, I.body.fs);
eq("본문 줄높이", got.body?.lh, I.body.lh);
eq("본문 색", got.body?.color, I.body.color);
if (got.avatar && got.body) near("본문 위 - 아바타 위", got.body.y - got.avatar.y, C.bodyTopFromAvatarTop);
if (got.pitch !== null) near("댓글 한 칸", got.pitch, I.avatarPitch);

if (got.mention) {
  eq("멘션 배경 (칩이 아님)", got.mention.bg, M.bg);
  eq("멘션 라운드 (칩이 아님)", got.mention.radius, M.radius);
  eq("멘션 여백 (칩이 아님)", got.mention.pad, M.padding);
  eq("멘션 색", got.mention.color, M.name.color);
} else {
  console.log("· 멘션이 든 댓글이 없어 멘션은 못 쟀습니다");
}

if (!got.composer) d.push("입력줄이 없습니다");
for (const want of I.composerButtons) {
  const b = got.composerButtons.find((x) => x.label === want.label);
  if (!b) { d.push(`입력줄 버튼 없음: ${want.label}`); continue; }
  near(`${want.label} 폭`, b.w, want.w);
  near(`${want.label} 높이`, b.h, want.h);
  eq(`${want.label} 라운드`, b.radius, want.radius);
}

if (d.length) {
  console.error("\n  ┌─ 페이지 안 댓글 섹션이 원본과 다릅니다 ───────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-row-comments.json (inline / comment / mention)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `페이지 안 댓글 ${got.count}개 — 안쪽 스크롤 없음, 아바타 ${got.avatar.w} @x${got.avatar.x}, 한 칸 ${got.pitch}, 도킹 패널 없음`
);
