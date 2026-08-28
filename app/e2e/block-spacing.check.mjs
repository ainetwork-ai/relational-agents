// 기본 블록의 세로 여백·간격, 헤딩 상단 여백, 거터(+/6점) 위치, 6점 클릭 하이라이트
// 면적을 원본 수치(fixtures/notion-block-spacing.json)와 대조한다.
//
// 스스로 페이지를 만들고(POST /api/pages + PUT blocks) 재고 나서 보관함으로 보낸다.
// 블록 시퀀스는 이웃 관계를 일부러 섞는다 — 리스트 첫 항목 규칙(앞이 리스트류가
// 아닐 때만 상단 6px)은 이웃이 있어야 잴 수 있다. 각 블록마다 박스 4 + gap 1 +
// 거터 4 + 하이라이트 4 = 13 체크, 헤딩은 타이포 3 체크가 더 붙는다.
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/block-spacing.check.mjs
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("./fixtures/notion-block-spacing.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };

const LIST = new Set(["bulleted_list", "numbered_list", "todo", "toggle"]);
const SEQ = [
  ["paragraph", "텍스트"], ["heading1", "제목1"], ["paragraph", "텍스트"], ["heading2", "제목2"],
  ["paragraph", "텍스트"], ["heading3", "제목3"], ["paragraph", "텍스트"], ["heading1", "제목1"],
  ["heading2", "제목2"], ["heading3", "제목3"], ["bulleted_list", "글머리1"], ["bulleted_list", "글머리2"],
  ["numbered_list", "번호1"], ["numbered_list", "번호2"], ["todo", "할일1"], ["todo", "할일2"],
  ["toggle", "토글"], ["quote", "인용"], ["paragraph", "텍스트"], ["bulleted_list", "글머리"],
  ["toggle", "토글"], ["paragraph", "텍스트"], ["toggle", "토글"], ["quote", "인용"],
  ["numbered_list", "번호"], ["heading2", "제목2"], ["todo", "할일"], ["heading1", "제목1"],
  ["bulleted_list", "글머리"], ["quote", "인용"],
  ["divider", ""], ["paragraph", "텍스트"], ["code", "code"], ["callout", "콜아웃"], ["paragraph", "텍스트"],
];
const uuid = () => crypto.randomUUID();
const created = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "block-spacing.check" }) }).then((r) => r.json());
const pageId = created.page?.id ?? created.id;
if (!pageId) { console.error("페이지를 못 만들었습니다:", created); process.exit(1); }
const blocks = SEQ.map(([type, text], i) => ({ id: uuid(), type, content: type === "todo" ? { text, checked: false } : type === "toggle" ? { text, expanded: true } : type === "code" ? { text, language: "plain" } : type === "callout" ? { text, icon: "💡" } : type === "divider" ? {} : { text }, parentBlockId: null, position: i + 1 }));
for (const b of blocks) if (b.type === "toggle") blocks.push({ id: uuid(), type: "paragraph", content: { text: "안" }, parentBlockId: b.id, position: 1 });
const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({ blocks, deletedIds: [], newIds: blocks.map((b) => b.id) }) });
if (!put.ok) { console.error("블록 저장 실패:", put.status, await put.text()); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 60_000 });
await page.waitForTimeout(500);

const fails = []; let checks = 0;
const eq = (label, got, want, tol = 0.5) => { checks++; const ok = typeof want === "number" ? Math.abs(got - want) <= tol : got === want; if (!ok) fails.push(`${label}: ${got} ≠ ${want}`); };
const roleOf = (type, prevType, nextType) => {
  if (!LIST.has(type)) return type;
  const first = !(prevType && LIST.has(prevType)); const last = !(nextType && LIST.has(nextType));
  const k = first && last ? "single" : first ? "first" : last ? "last" : "next";
  return (type === "toggle" ? "toggle_" : "list_") + k;
};
const tops = blocks.filter((b) => !b.parentBlockId).sort((a, b) => a.position - b.position);
let prevId = null, prevType = null;
for (const [i, b] of tops.entries()) {
  const role = roleOf(b.type, prevType, tops[i + 1]?.type);
  const sel = `[data-testid="block-${b.id}"]`;
  await page.locator(sel).scrollIntoViewIfNeeded();
  const m = await page.evaluate(([sel, prevSel]) => {
    const el = document.querySelector(sel); const r = el.getBoundingClientRect();
    const prevBottom = prevSel ? document.querySelector(prevSel).getBoundingClientRect().bottom : null;
    const leaf = el.querySelector('[data-testid^="block-editable-"]'); const l = leaf ? leaf.getBoundingClientRect() : { top: r.top, height: 0 }; const s = getComputedStyle(leaf ?? el);
    return { top: r.top, bottom: r.bottom, h: r.height, left: r.left, w: r.width, leafTop: l.top, leafH: l.height, fs: s.fontSize, lh: s.lineHeight, fw: s.fontWeight, prevBottom };
  }, [sel, prevId ? `[data-testid="block-${prevId}"]` : null]);
  const box = G.box[role]; const tag = `${b.type}(${role}) #${b.position}`;
  if (box.h != null) eq(`${tag} wrapper h`, m.h, box.h);
  if (box.pre != null) { eq(`${tag} pre`, m.leafTop - m.top, box.pre); eq(`${tag} leaf h`, m.leafH, box.leaf); }
  if (box.post != null) eq(`${tag} post`, m.bottom - (m.leafTop + m.leafH), box.post);
  if (G.special[b.type]) {
    const sp = G.special[b.type];
    const x = await page.evaluate((sel) => { const el = document.querySelector(sel); const r = el.getBoundingClientRect();
      const hr = el.querySelector("hr"); const cont = [...el.querySelectorAll("div")].find((d) => getComputedStyle(d).backgroundColor !== "rgba(0, 0, 0, 0)");
      const leaf = el.querySelector("[data-testid^=block-editable-]"); const icon = el.querySelector("[data-testid^=callout-icon-]");
      const B = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); const s = getComputedStyle(e); return { top: q.top - r.top, left: q.left - r.left, right: r.right - q.right, h: q.height, w: q.width, bg: s.backgroundColor, radius: s.borderRadius, fs: s.fontSize, lh: s.lineHeight }; };
      return { hr: B(hr), cont: B(cont), leaf: B(leaf), icon: B(icon) }; }, sel);
    if (b.type === "divider") { eq(`${tag} line h`, x.hr.h, sp.lineH); eq(`${tag} line inset`, x.hr.left, sp.lineInsetX); eq(`${tag} line top`, x.hr.top, sp.lineTopFromWrap); eq(`${tag} line color`, x.hr.bg, sp.lineColor); }
    if (b.type === "code") { eq(`${tag} container inset`, x.cont.left, sp.containerInsetX); eq(`${tag} container radius`, x.cont.radius, sp.containerRadius); eq(`${tag} container bg`, x.cont.bg, sp.containerBg); eq(`${tag} text left`, x.leaf.left, sp.textLeftFromWrap); eq(`${tag} font-size`, x.leaf.fs, sp.fontSize); eq(`${tag} line-height`, x.leaf.lh, sp.lineHeight); }
    if (b.type === "callout") { eq(`${tag} container inset`, x.cont.left, sp.containerInsetX); eq(`${tag} container radius`, x.cont.radius, sp.containerRadius); eq(`${tag} container bg`, x.cont.bg, sp.containerBg); eq(`${tag} icon size`, `${x.icon.w}x${x.icon.h}`, `${sp.iconSize}x${sp.iconSize}`); eq(`${tag} icon left`, x.icon.left, sp.iconLeftFromWrap); eq(`${tag} text left`, x.leaf.left, sp.textLeftFromWrap); eq(`${tag} text font-size`, x.leaf.fs, sp.textFontSize); eq(`${tag} text line-height`, x.leaf.lh, sp.textLineHeight); }
  }
  if (m.prevBottom != null) eq(`${tag} gap from prev`, m.top - m.prevBottom, G.gap);
  if (G.type[b.type]) { const t = G.type[b.type]; eq(`${tag} font-size`, m.fs, t.fontSize); eq(`${tag} line-height`, m.lh, t.lineHeight); eq(`${tag} font-weight`, m.fw, t.fontWeight); }
 // 거터: hover → +와 6점의 위치/크기
  await page.locator(sel).hover({ position: { x: 80, y: 6 } }); await page.waitForTimeout(120);
  const grip = await page.locator(`[data-testid="block-handle-${b.id}"]`).boundingBox();
  const plus = await page.locator(`[data-testid="block-add-below-${b.id}"]`).boundingBox();
  if (!grip || !plus) fails.push(`${tag}: gutter not visible`);
  else {
    eq(`${tag} grip dx`, grip.x - m.left, G.gutter.grip.dx); eq(`${tag} grip dy`, grip.y - m.top, G.gutter.dy[role]);
    eq(`${tag} grip size`, `${grip.width}x${grip.height}`, `${G.gutter.grip.w}x${G.gutter.grip.h}`);
    eq(`${tag} plus dx`, plus.x - m.left, G.gutter.plus.dx);
 // 6점 클릭 → 하이라이트 면적
    await page.locator(`[data-testid="block-handle-${b.id}"]`).click(); await page.waitForTimeout(150);
    const halo = await page.evaluate((sel) => { const el = document.querySelector(sel); const h = el.querySelector('[data-testid^="block-halo-"]'); if (!h) return null; const r = el.getBoundingClientRect(); const hr = h.getBoundingClientRect(); const s = getComputedStyle(h); return { t: hr.top - r.top, b: r.bottom - hr.bottom, l: hr.left - r.left, rr: r.right - hr.right, bg: s.backgroundColor, radius: s.borderRadius }; }, sel);
    if (!halo) fails.push(`${tag}: no halo on grip click`);
    else {
      const [it, ib] = G.halo.inset[role] ?? G.halo.inset.default;
      eq(`${tag} halo top`, halo.t, it); eq(`${tag} halo bottom`, halo.b, ib); eq(`${tag} halo left`, halo.l, G.halo.left); eq(`${tag} halo right`, halo.rr, G.halo.right);
      eq(`${tag} halo color`, halo.bg, G.halo.bg); eq(`${tag} halo radius`, halo.radius, G.halo.radius);
    }
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  }
  prevId = b.id; prevType = b.type;
}
await browser.close();
await fetch(`${BASE}/api/pages/${pageId}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});

if (fails.length) {
  console.log(`  ┌─ 블록 여백/거터/하이라이트가 원본과 다릅니다 (${fails.length}/${checks}) ─────`);
  for (const f of fails.slice(0, 40)) console.log(`  │ ${f}`);
  if (fails.length > 40) console.log(`  │ … ${fails.length - 40} more`);
  console.log("  └────────────────────────────────────────────────");
  process.exit(1);
}
console.log(`블록 여백·헤딩 상단 여백·거터·하이라이트 원본과 일치 — ${checks}개 체크, ${tops.length}개 블록`);
