// 노션 "전체 복사 → 우리 에디터 붙여넣기"를 원본과 대조한다.
//
// 입력은 진짜 클립보드 페이로드다: 원본(상담/모니터링 FLOW 페이지)에서 Cmd+A×2,
// Cmd+C 로 뜬 4개 MIME(text/plain·text/html·text/_notion-blocks-v3-production…)
// 을 그대로 ClipboardEvent 로 합성해 쏜다. 기준은 같은 폴더의 expected-tree.json
// (원본 라이브 DOM 카탈로그와 대조를 마친 트리)이다.
//
//   [BASE_URL=http://localhost:3110] node e2e/notion-paste.check.mjs
//
// 무엇을 보나:
//  1) 붙여넣기 직후: 블록 타입·깊이·텍스트가 기대 트리와 1:1 (접힌 토글 자식 제외)
//  2) 콜아웃: 파란/회색 배경, 💬 아이콘, 아이콘 없는 콜아웃, 자식이 박스 안에
//  3) 토글: 접힌 채로 붙고, 펼치면 자식이 나온다 (원본도 접혀 있다)
//  4) 리터럴 '**' 와 '<aside>' 가 어디에도 없다
//  5) 새로고침 후에도 1)이 유지된다 (저장 경로까지 통과)
//
// 페이로드가 없으면(캡처는 커밋되지 않는다) 측정 불가로 exit 1 — 추론으로 메우지
// 않는다. 다시 뜨는 법: docs/notion-golden-set.md 절차로 원본을 열고
//   node scratchpad/capture-clipboard.mjs docs/notion-clip-flow-page   # Cmd+A×2 복사 캡처
//   node scratchpad/probe-paste-types.mjs docs/notion-clip-flow-page   # paste 이벤트 4종 MIME
// 를 돌리거나, 사람이 복사해서 채운다.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const DIR = new URL("../../docs/notion-clip-flow-page/", import.meta.url);

const need = (f) => {
  const p = new URL(f, DIR);
  if (!fs.existsSync(p)) {
    console.error(`\n  캡처가 없습니다: docs/notion-clip-flow-page/${f}`);
    console.error("  (커밋되지 않는 원본 데이터입니다 — 헤더 주석의 절차로 다시 떠 주세요)\n");
    process.exit(1);
  }
  return fs.readFileSync(p, "utf8");
};
const PAYLOAD = {
  "text/plain": need("paste.text_plain.txt"),
  "text/html": need("paste.text_html.txt"),
  "text/_notion-blocks-v3-production": need("paste.text_notion_blocks_v3_production.txt"),
  "text/_notion-page-source-production": need("paste.text_notion_page_source_production.txt"),
};
const EXPECTED = JSON.parse(need("expected-tree.json")).blocks;

// ENV_FILE/USER_ID 를 주면 prod 에도 겨눌 수 있다 (배포 검증). 만드는 페이지는
// ARCHIVE=1 이면 끝나고 아카이브한다 — prod 사이드바에 잔재를 남기지 않기 위해.
const envPath = process.env.ENV_FILE
  ? new URL(process.env.ENV_FILE, `file://${process.cwd()}/`)
  : new URL("../.env.local", import.meta.url);
const env = fs.readFileSync(envPath, "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

// ---- 대조용 페이지 생성 (dev DB — 소모품) -----------------------------------
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `rm-session=${cookie}` },
  body: JSON.stringify({ title: `notion-paste.check ${new Date().toISOString().slice(0, 16)}` }),
});
if (created.status !== 201) {
  console.error("페이지 생성 실패:", created.status, await created.text());
  process.exit(1);
}
const pageId = (await created.json()).page.id;
console.log(`대조 페이지: ${BASE}/p/${pageId}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([
  { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-block-type='paragraph'] [contenteditable]", { timeout: 60_000 });

// ---- 진짜 클립보드 그대로 paste 합성 ----------------------------------------
await page.evaluate((payload) => {
  const el = document.querySelector("[data-block-type='paragraph'] [contenteditable]");
  el.focus();
  const dt = new DataTransfer();
  for (const [type, data] of Object.entries(payload)) dt.setData(type, data);
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, PAYLOAD);
await page.waitForTimeout(1500);

// ---- 에디터 DOM → {type, depth, text} 트리 ---------------------------------
const READ_TREE = () => {
  const rows = [...document.querySelectorAll("[data-testid^='block-'][data-block-type]")];
  return rows.map((row) => {
    let depth = 0;
    for (let p = row.parentElement; p; p = p.parentElement)
      if (p.matches?.("[data-testid^='block-'][data-block-type]")) depth++;
    const leaf = [...row.querySelectorAll("[contenteditable]")].find(
      (l) => l.closest("[data-testid^='block-'][data-block-type]") === row
    );
    // textContent 는 <br> 를 통째로 삼킨다 — 줄바꿈으로 되살려 읽는다
    const leafText = (el) => {
      if (!el) return null;
      const clone = el.cloneNode(true);
      for (const br of clone.querySelectorAll("br")) br.replaceWith("\n");
      return clone.textContent;
    };
    const callout = row.getAttribute("data-block-type") === "callout"
      ? row.querySelector(`[data-testid^='callout-']`)
      : null;
    const checkbox = [...row.querySelectorAll("input[type='checkbox']")].find(
      (b) => b.closest("[data-testid^='block-'][data-block-type]") === row
    );
    const fileLabel = [...row.querySelectorAll("[data-testid^='file-block-'],[data-testid^='file-drop-']")].find(
      (b) => b.closest("[data-testid^='block-'][data-block-type]") === row
    );
    return {
      type: row.getAttribute("data-block-type"),
      depth,
      text: (leafText(leaf) ?? fileLabel?.textContent ?? "").trim(),
      ...(checkbox ? { checked: checkbox.checked } : {}),
      ...(callout ? { color: callout.getAttribute("data-color") } : {}),
      html: leaf?.innerHTML ?? "",
    };
  });
};

const fails = [];
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) fails.push(label);
};

// 기대 트리 → "화면에 보여야 하는" 시퀀스. 접힌 토글의 자식은 안 보인다.
const visibleExpected = (tree) => {
  const out = [];
  let hideBelow = null;
  for (const b of tree) {
    if (hideBelow !== null) {
      if (b.depth > hideBelow) continue;
      hideBelow = null;
    }
    out.push(b);
    if (b.type === "toggle" && b.content.expanded === false) hideBelow = b.depth;
  }
  return out;
};

const compare = (got, want, label) => {
  ok(got.length === want.length, `${label}: 블록 수 ${got.length} == ${want.length}`);
  const n = Math.min(got.length, want.length);
  let mismatch = 0;
  for (let i = 0; i < n; i++) {
    const g = got[i];
    const w = want[i];
    const wText = (w.content.text ?? "").replace(/\s+/g, " ").trim();
    const gText = g.text.replace(/\s+/g, " ").trim();
    const same =
      g.type === w.type &&
      g.depth === w.depth &&
      (w.type === "file" ? gText.includes(wText) : gText === wText) &&
      (w.content.checked === undefined || g.checked === w.content.checked) &&
      (w.content.color === undefined || g.color === w.content.color);
    if (!same && mismatch < 5) {
      console.log(
        `   #${i} got ${g.type}@${g.depth} ${JSON.stringify(gText.slice(0, 30))}` +
          ` want ${w.type}@${w.depth} ${JSON.stringify(wText.slice(0, 30))}`
      );
    }
    if (!same) mismatch++;
  }
  ok(mismatch === 0, `${label}: 타입·깊이·텍스트·체크·색 일치 (불일치 ${mismatch})`);
};

// ---- 1) 붙여넣기 직후 -------------------------------------------------------
let got = await page.evaluate(READ_TREE);
compare(got, visibleExpected(EXPECTED), "paste 직후(접힌 토글 제외)");

// ---- 4) 리터럴 마크다운 찌꺼기 ---------------------------------------------
const litNow = got.filter((b) => b.text.includes("**") || b.text.includes("<aside>"));
ok(litNow.length === 0, `리터럴 '**'/'<aside>' 없음 (발견 ${litNow.length})`);

// ---- 2) 콜아웃 --------------------------------------------------------------
const blue = got.find((b) => b.type === "callout" && b.color === "blue");
ok(!!blue, "파란 배경 콜아웃 존재");
const calloutProbe = await page.evaluate(() => {
  // 콜아웃 박스는 data-color 를 가진 유일한 노드 — callout-icon-/callout-color-
  // 트리거들이 같은 접두사를 쓰므로 그걸로 거른다. 파란 콜아웃은 원본이 한
  // 줄짜리다(첫 텍스트 자식이 본문으로 흡수되는 노션 v2 규칙) — 자식 0이 정답.
  const box = [...document.querySelectorAll("[data-testid^='callout-'][data-color]")][0];
  if (!box) return null;
  return {
    icon: box.querySelector("[data-testid^='callout-icon-']")?.textContent?.trim() ?? null,
    childCount: box.querySelectorAll("[data-block-type]").length,
  };
});
ok(calloutProbe?.icon === "💬", `콜아웃 아이콘 💬 (${calloutProbe?.icon})`);
ok(calloutProbe?.childCount === 0, `한 줄 콜아웃은 본문으로 흡수 (자식 ${calloutProbe?.childCount})`);

// ---- 3) 토글: 접혀서 붙고, 펼치면 자식 --------------------------------------
const togglesBefore = got.filter((b) => b.type === "toggle").length;
ok(togglesBefore === 2, `토글 2개 (${togglesBefore})`);
// 접힘 = 자식 블록이 DOM에 없음 (visibleExpected 대조가 이미 봤지만 명시적으로)
ok(!got.some((b) => b.text.startsWith("증권봇 시나리오 수집")), "토글이 접힌 채로 붙음");

// 모두 펼친다 (안에 또 토글은 없다)
await page.evaluate(() => {
  for (const btn of document.querySelectorAll("[data-testid^='toggle-expand-']")) btn.click();
});
await page.waitForTimeout(600);
got = await page.evaluate(READ_TREE);
compare(got, EXPECTED, "토글 전부 펼친 후(전체 트리)");

const litAll = got.filter((b) => b.text.includes("**") || b.text.includes("<aside>"));
ok(litAll.length === 0, `펼친 후에도 리터럴 '**'/'<aside>' 없음 (발견 ${litAll.length})`);

// 회색·아이콘 없는 콜아웃 (토글 안에 있던 것)
const gray = got.filter((b) => b.type === "callout" && b.color === "gray");
ok(gray.length === 2, `회색 콜아웃 2개 (${gray.length})`);

// 여러 블록짜리 콜아웃: 자식들이 색 박스 **안에** 그려져야 한다 (노션 레이아웃)
const multiProbe = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("[data-testid^='callout-'][data-color]")];
  const box = boxes.find((b) => b.textContent.includes("[시나리오 활용방법]"));
  if (!box) return null;
  const rows = [...box.querySelectorAll("[data-block-type]")];
  const br = box.getBoundingClientRect();
  return {
    childCount: rows.length,
    allInside: rows.every((r) => {
      const rr = r.getBoundingClientRect();
      return rr.top >= br.top - 1 && rr.bottom <= br.bottom + 1;
    }),
  };
});
ok(
  multiProbe?.childCount === 14 && multiProbe?.allInside === true,
  `다중 블록 콜아웃 자식 14개가 박스 안에 (${multiProbe?.childCount}, inside=${multiProbe?.allInside})`
);
const noIcon = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("[data-testid^='callout-'][data-color]")];
  return boxes.filter((b) => !b.querySelector("[data-testid^='callout-icon-']")).length;
});
ok(noIcon === 2, `아이콘 없는 콜아웃 2개 (${noIcon})`);

// 볼드: 노션 주석 그대로 <b> 로 (공백·구두점 볼드 포함), ** 없이
const boldPara = got.find((b) => b.text.includes("분리하여"));
ok(!!boldPara && /<b>/.test(boldPara.html) && !boldPara.html.includes("**"),
  "깨졌던 볼드 문단이 <b>로 복원");

// ---- 5) 새로고침 후 유지 ----------------------------------------------------
// 위에서 토글을 펼쳤고 그 상태는 저장된다 — 리로드 기준은 전체 트리다.
await page.waitForTimeout(2500); // 저장 플러시
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-block-type]", { timeout: 60_000 });
await page.waitForTimeout(1200);
got = await page.evaluate(READ_TREE);
compare(got, EXPECTED, "새로고침 후(토글 펼친 상태 저장됨)");

await browser.close();
if (process.env.ARCHIVE === "1") {
  const r = await fetch(`${BASE}/api/pages/${pageId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: `rm-session=${cookie}` },
    body: JSON.stringify({ isArchived: true }),
  });
  console.log(`대조 페이지 아카이브: ${r.status}`);
}
if (fails.length) {
  console.error(`\n${fails.length}개 실패`);
  process.exit(1);
}
console.log("\n원본과 차이 없음 — exit 0");
