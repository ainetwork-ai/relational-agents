// 댓글이 달린 행이 표에서 어떻게 표시되는가 — 제목 셀 안의 아이콘+숫자 배지.
//
// 원본은 이 배지를 제목 **바로 뒤** 5px 에 단다. 셀 오른쪽 끝이 아니다. 그래서
// 제목 입력칸이 셀을 꽉 채우고 있으면 이 위치가 나오지 않는다 — 우리 것이 그랬다.
// 폭은 폰트 문제라 그대로 맞출 수 없다(우리 Geist / 원본은 노션 자체 스택). 대신
// 글자에 안 걸리는 값들(높이·여백·라운드·아이콘·색·자간 규칙)을 잰다.
//
//   [BASE_URL=…] [PAGE_ID=…] [USER_ID=…] node e2e/row-comment-badge.check.mjs
//
// 읽기 전용: 페이지를 열어 좌표만 읽는다. dev DB 에 댓글이 하나도 없으면 잴 것이
// 없으므로 그때는 exit 1 로 멈춘다(초록불로 위장하지 않는다).

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "5722f40d-c3f6-4664-9bdb-5a24abe655cf"; // Projects
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj@comcom.ai

const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-row-comments.json", import.meta.url), "utf8")).badge;
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid^='db-row-']", { timeout: 120_000 });
await page.waitForTimeout(2500);

const got = await page.evaluate(() => {
  const px = (v) => +Number(v).toFixed(2);
  const e = document.querySelector("[data-testid='comment-count-badge']");
  if (!e) return { none: true, rows: document.querySelectorAll("[data-testid^='db-row-']").length };
  const cs = getComputedStyle(e);
  const svg = e.querySelector("svg");
  const r = e.getBoundingClientRect();
 // 제목 입력칸의 오른쪽 끝과 배지 사이 — 원본은 5px
  const cell = e.parentElement;
  const input = cell.querySelector("input");
  const ir = input?.getBoundingClientRect();
  return {
    n: e.innerText.trim(),
    h: px(r.height),
    w: px(r.width),
    radius: cs.borderRadius,
    padLeft: cs.paddingLeft,
    padRight: cs.paddingRight,
    fs: cs.fontSize,
    fw: cs.fontWeight,
    lineHeight: cs.lineHeight,
    color: cs.color,
    cursor: cs.cursor,
    numeric: cs.fontVariantNumeric,
    icon: svg ? px(svg.getBoundingClientRect().width) : null,
    iconFill: svg ? getComputedStyle(svg).fill : null,
    gapAfterTitle: ir ? px(r.x - ir.right) : null,
 // 배지가 셀 오른쪽 끝에 붙어버렸는지 (제목이 셀을 꽉 채우면 그렇게 된다)
    cellRightToBadge: px(cell.getBoundingClientRect().right - r.right),
    zeroBadges: [...document.querySelectorAll("[data-testid='comment-count-badge']")]
      .filter((b) => b.innerText.trim() === "0").length,
  };
});
await browser.close();

if (got.none) {
  console.error("\n  ┌─ 잴 것이 없습니다 ────────────────────────────────────────");
  console.error(`  │ 표에 행은 ${got.rows}개 있는데 댓글 배지가 하나도 없습니다.`);
  console.error("  │ dev DB 에 댓글을 넣고 다시 도세요 (원본의 8행 기준은 fixture 에 있습니다).");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}

const d = [];
const eq = (what, a, b) => { if (String(a) !== String(b)) d.push(`${what}: 우리 ${a} / 노션 ${b}`); };
const near = (what, a, b, tol) => { if (Math.abs(Number(a) - Number(b)) > tol) d.push(`${what}: 우리 ${a} / 노션 ${b}`); };

eq("높이", got.h, G.h);
eq("라운드", got.radius, G.radius);
eq("왼쪽 여백", got.padLeft, "2px");
eq("오른쪽 여백", got.padRight, "5px");
eq("글자 크기", got.fs, G.fs);
eq("글자 굵기", got.fw, G.fw);
eq("줄 높이", got.lineHeight, G.lineHeight);
eq("색", got.color, "rgb(44, 44, 43)");
eq("커서", got.cursor, G.cursor);
eq("아이콘 크기", got.icon, G.icon.size);
eq("아이콘 색", got.iconFill, G.icon.fill);
near("제목과의 간격", got.gapAfterTitle, G.gapAfterTitle, 0.5);
if (!/tabular-nums/.test(got.numeric))
  d.push("숫자가 tabular 가 아닙니다 — 원본은 1과 3의 배지 폭이 같습니다(33.56)");
if (got.zeroBadges) d.push(`0개짜리 배지가 ${got.zeroBadges}개 그려졌습니다 — 원본은 0이면 배지를 아예 안 답니다`);
 // 폭은 폰트 탓에 정확히 같아질 수 없지만, 셀 오른쪽 끝에 붙어버린 건 배치 버그다
if (got.cellRightToBadge < 20)
  d.push(`배지가 셀 오른쪽 끝에 붙어 있습니다(여백 ${got.cellRightToBadge}px) — 원본은 제목 바로 뒤입니다`);

if (d.length) {
  console.error("\n  ┌─ 행 댓글 배지가 원본과 다릅니다 ──────────────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-row-comments.json (badge)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `댓글 배지 원본과 일치 — ${got.h}px 높이, 아이콘 ${got.icon}px, 제목 뒤 ${got.gapAfterTitle}px` +
    ` (폭 ${got.w} vs 노션 ${G.w}: 폰트가 Geist 라 글자 폭만 다름)`
);
