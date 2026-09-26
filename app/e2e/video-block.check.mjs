// Video block — compared against the original (Notion) measurements. docs/notion-video.md §1·§2
//
// Measured on 2026-09-10 on a Notion page I made, then sent that page to the Trash:
//   · an empty block is one `Embed or upload a video` strip (inner height 49, text 16px)
//   · clicking opens a 300-wide radius-10 popover with two tabs, `Upload / Link`
//   · the Upload tab has the blue primary button `Choose a video`, the Link tab has `Embed video`
//   · the selected tab is dark ink, the other rgb(142,139,134)
//
// And a condition only on our side: an uploaded file must render as `<video preload=metadata playsInline>`
// (seeking, iOS), and `.mov`/`.m4v` must not leak into an <iframe>.
//
//   [BASE_URL=…] [USER_ID=…] node e2e/video-block.check.mjs
//
// Makes its own pages and deletes them at the end.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko } from "./i18n.mjs";

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
  check("0. made the test page", !!pageId, String(pageId));

  // ── empty video block ─────────────────────────────────────────────────────
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
  check("E1. the empty block text matches the original", e.text === ko("Embed or upload a video"), e.text);
  check("E2. strip height 49 · text 16px", near(e.h, 49, 2) && e.fs === "16px", JSON.stringify(e));

  // ── popover ───────────────────────────────────────────────────────────────
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
  check("P1. popover width 300 · radius 10", p.w === 300 && p.radius === "10px", JSON.stringify({ w: p.w, radius: p.radius }));
  check("P2. three shadow layers", p.shadowLayers === 3, String(p.shadowLayers));
  check("P3. two tabs, Upload · Link, with Upload selected", p.up?.t === ko("Upload") && p.lk?.t === ko("Link") && p.up?.sel === "true", JSON.stringify({ up: p.up?.t, lk: p.lk?.t, sel: p.up?.sel }));
  check("P4. the unselected tab color is rgb(142,139,134)", p.lk?.color === "rgb(142, 139, 134)", String(p.lk?.color));

  const choose = page.locator('[data-testid^="video-choose-"]');
  check("P5. the Upload tab has the `Choose a video` button", (await choose.count()) === 1 && (await choose.innerText()).trim() === ko("Choose a video"), (await choose.innerText().catch(() => "missing")).trim());
  const file = page.locator('[data-testid^="video-file-"]');
  check("P6. that button opens a video file picker", (await file.getAttribute("accept").catch(() => "")).includes("video/"), String(await file.getAttribute("accept").catch(() => "missing")));

  await page.locator('[data-testid^="video-tab-link-"]').click();
  await page.waitForTimeout(250);
  check("P7. the Link tab has a URL field and the `Embed video` button",
    (await page.locator('[data-testid^="video-url-input-"]').count()) === 1 &&
      (await page.locator('[data-testid^="video-embed-"]').innerText()).trim() === ko("Embed video"));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("P8. Escape closes it", (await picker.count()) === 0);

  // ── player ────────────────────────────────────────────────────────────────
  for (const [url, label] of [
    ["/api/files/key/files/" + "a".repeat(64) + ".mp4", "our proxy URL"],
    ["https://example.invalid/clip.mov", ".mov"],
    ["https://example.invalid/clip.m4v", ".m4v"],
  ]) {
    const pid = await makePage(`ZZ video ${label}`);
    await addBlock(pid, "video", { url });
    await page.goto(`${BASE}/p/${pid}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const el = page.locator('[data-testid^="video-el-"]');
    const ok = await el.count().catch(() => 0);
    check(`V. ${label} renders as <video> (not an iframe)`, ok === 1, `n=${ok}`);
    if (ok === 1) {
      const a = await el.evaluate((v) => ({ preload: v.preload, playsInline: v.playsInline, controls: v.controls, cls: v.className }));
      check(`V. ${label} — preload=metadata · playsInline · controls · 16:9 reserved`,
        a.preload === "metadata" && a.playsInline && a.controls && /aspect-video/.test(a.cls), JSON.stringify(a));
    }
    await fetch(`${BASE}/api/pages/${pid}`, { method: "DELETE", headers: H }).catch(() => {});
  }

  // YouTube must still be a frame
  {
    const pid = await makePage("ZZ video youtube");
    await addBlock(pid, "video", { url: "https://www.youtube.com/watch?v=Nx114VWepoI" });
    await page.goto(`${BASE}/p/${pid}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(600);
    check("V. a YouTube link stays an embed frame",
      (await page.locator('[data-testid^="video-el-"]').count()) === 0 &&
        (await page.locator('[data-testid^="video-frame-"] iframe').count()) === 1);
    await fetch(`${BASE}/api/pages/${pid}`, { method: "DELETE", headers: H }).catch(() => {});
  }

  check("Z. no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (err) {
  check("run", false
, String(err).slice(0, 300));
} finally {
  if (pageId) await fetch(`${BASE}/api/pages/${pageId}`, { method: "DELETE", headers: H }).catch(() => {});
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
