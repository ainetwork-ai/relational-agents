// 동영상 블록 — 원본(노션) 측정치와 대조. docs/notion-video.md §1·§2
//
// 2026-09-10 에 내가 만든 노션 페이지에서 재고 그 페이지는 휴지통으로 보냈다:
//   · 빈 블록은 `동영상 임베드 또는 업로드` 띠 하나 (안쪽 49 높이, 글자 16px)
//   · 누르면 300폭 radius 10 팝오버가 `업로드 / 링크` 두 탭으로 열린다
//   · 업로드 탭에는 파란 기본 버튼 `동영상을 선택하세요`, 링크 탭에는 `동영상 임베드`
//   · 선택된 탭은 진한 잉크, 아닌 탭은 rgb(142,139,134)
//
// 그리고 우리 쪽에만 있는 조건: 올린 파일은 `<video preload=metadata playsInline>`
// 로 그려야 하고(탐색·iOS), `.mov`/`.m4v` 가 <iframe> 으로 새면 안 된다.
//
//   [BASE_URL=…] [USER_ID=…] node e2e/video-block.check.mjs
//
// 페이지를 스스로 만들고 끝나면 지운다.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const ME = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: ME }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

let pageId = null;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 960 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

async function makePage(title) {
  const r = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title }) });
  if (!r.ok) throw new Error(`create page failed: ${r.status} ${(await r.text()).slice(0, 140)}`);
  const d = await r.json();
  return d.page?.id ?? d.id;
}
async function addBlock(pid, type, content) {
  const r = await fetch(`${BASE}/api/pages/${pid}/blocks`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ blocks: [{ id: crypto.randomUUID(), type, content, position: 1000 }] }),
  });
  if (!r.ok) throw new Error(`put blocks failed: ${r.status} ${(await r.text()).slice(0, 140)}`);
  const d = await r.json().catch(() => ({}));
  return d;
}

try {
  pageId = await makePage("ZZ video block check");
  check("0. 검사용 페이지를 만들었다", !!pageId, String(pageId));

  // ── 빈 동영상 블록 ────────────────────────────────────────────────────────
  await addBlock(pageId, "video", { url: "" });
  await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  const empty = page.locator('[data-testid^="video-empty-"]');
  await empty.waitFor({ timeout: 60_000 });

  const e = await empty.evaluate((el) => {
    const s = getComputedStyle(el);
    const label = [...el.querySelectorAll("*")].find((n) => n.children.length === 0 && (n.innerText || "").trim());
    const ls = label && getComputedStyle(label);
    return { h: Math.round(el.offsetHeight), text: (el.innerText || "").trim(), fs: ls?.fontSize, radius: s.borderRadius };
  });
  check("E1. 빈 블록의 문구가 원본과 같다", e.text === "동영상 임베드 또는 업로드", e.text);
  check("E2. 띠 높이 49 · 글자 16px", near(e.h, 49, 2) && e.fs === "16px", JSON.stringify(e));

  // ── 팝오버 ────────────────────────────────────────────────────────────────
  await empty.click();
  const picker = page.locator('[data-testid^="video-picker-"]');
  await picker.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(250);
  const p = await picker.evaluate((el) => {
    const s = getComputedStyle(el);
    const up = el.querySelector('[data-testid^="video-tab-upload-"]');
    const lk = el.querySelector('[data-testid^="video-tab-link-"]');
    return {
      w: el.offsetWidth,
      radius: s.borderRadius,
      shadowLayers: (s.boxShadow.match(/rgba?\(/g) || []).length,
      up: up ? { t: up.innerText.trim(), color: getComputedStyle(up).color, sel: up.getAttribute("aria-selected") } : null,
      lk: lk ? { t: lk.innerText.trim(), color: getComputedStyle(lk).color, sel: lk.getAttribute("aria-selected") } : null,
    };
  });
  check("P1. 팝오버 폭 300 · radius 10", p.w === 300 && p.radius === "10px", JSON.stringify({ w: p.w, radius: p.radius }));
  check("P2. 그림자 3겹", p.shadowLayers === 3, String(p.shadowLayers));
  check("P3. 탭이 업로드 · 링크 두 개, 업로드가 선택된 상태", p.up?.t === "업로드" && p.lk?.t === "링크" && p.up?.sel === "true", JSON.stringify({ up: p.up?.t, lk: p.lk?.t, sel: p.up?.sel }));
  check("P4. 안 선택된 탭 색이 rgb(142,139,134)", p.lk?.color === "rgb(142, 139, 134)", String(p.lk?.color));

  const choose = page.locator('[data-testid^="video-choose-"]');
  check("P5. 업로드 탭에 `동영상을 선택하세요` 버튼", (await choose.count()) === 1 && (await choose.innerText()).trim() === "동영상을 선택하세요", (await choose.innerText().catch(() => "없음")).trim());
  const file = page.locator('[data-testid^="video-file-"]');
  check("P6. 그 버튼이 여는 것은 동영상 파일 선택창", (await file.getAttribute("accept").catch(() => "")).includes("video/"), String(await file.getAttribute("accept").catch(() => "없음")));

  await page.locator('[data-testid^="video-tab-link-"]').click();
  await page.waitForTimeout(250);
  check("P7. 링크 탭에는 URL 칸과 `동영상 임베드` 버튼",
    (await page.locator('[data-testid^="video-url-input-"]').count()) === 1 &&
      (await page.locator('[data-testid^="video-embed-"]').innerText()).trim() === "동영상 임베드");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("P8. Escape 로 닫힌다", (await picker.count()) === 0);

  // ── 재생기 ────────────────────────────────────────────────────────────────
  for (const [url, label] of [
    ["/api/files/key/files/" + "a".repeat(64) + ".mp4", "우리 프록시 주소"],
    ["https://example.invalid/clip.mov", ".mov"],
    ["https://example.invalid/clip.m4v", ".m4v"],
  ]) {
    const pid = await makePage(`ZZ video ${label}`);
    await addBlock(pid, "video", { url });
    await page.goto(`${BASE}/p/${pid}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const el = page.locator('[data-testid^="video-el-"]');
    const ok = await el.count().catch(() => 0);
    check(`V. ${label} 은 <video> 로 그린다 (iframe 이 아니다)`, ok === 1, `n=${ok}`);
    if (ok === 1) {
      const a = await el.evaluate((v) => ({ preload: v.preload, playsInline: v.playsInline, controls: v.controls, cls: v.className }));
      check(`V. ${label} — preload=metadata · playsInline · controls · 16:9 예약`,
        a.preload === "metadata" && a.playsInline && a.controls && /aspect-video/.test(a.cls), JSON.stringify(a));
    }
    await fetch(`${BASE}/api/pages/${pid}`, { method: "DELETE", headers: H }).catch(() => {});
  }

  // 유튜브는 여전히 프레임이어야 한다
  {
    const pid = await makePage("ZZ video youtube");
    await addBlock(pid, "video", { url: "https://www.youtube.com/watch?v=Nx114VWepoI" });
    await page.goto(`${BASE}/p/${pid}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(600);
    check("V. 유튜브 링크는 임베드 프레임으로 남는다",
      (await page.locator('[data-testid^="video-el-"]').count()) === 0 &&
        (await page.locator('[data-testid^="video-frame-"] iframe').count()) === 1);
    await fetch(`${BASE}/api/pages/${pid}`, { method: "DELETE", headers: H }).catch(() => {});
  }

  check("Z. 페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (err) {
  check("실행", false, String(err).slice(0, 300));
} finally {
  if (pageId) await fetch(`${BASE}/api/pages/${pageId}`, { method: "DELETE", headers: H }).catch(() => {});
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
