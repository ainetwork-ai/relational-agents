// Compares basic blocks' vertical padding/gaps, heading top margin, gutter (+/6-dot) position, and the
// 6-dot click highlight area with the original's numbers (src/i18n/content/e2e-fixtures/notion-block-spacing.json).
//
// Creates its own page (POST /api/pages + PUT blocks), measures, then sends it to the archive.
// The block sequence mixes neighbors on purpose — the first-list-item rule (6px on top only when the
// previous block is not list-like) can only be measured with neighbors. Per block: box 4 + gap 1 +
// gutter 4 + highlight 4 = 13 checks; headings get 3 more typography checks.
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/block-spacing.check.mjs
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { content } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-block-spacing.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };

const C = content.BLOCK_SPACING;
const LIST = new Set(["bulleted_list", "numbered_list", "todo", "toggle"]);
const SEQ = [
  ["paragraph", C.text], ["heading1", C.heading1], ["paragraph", C.text], ["heading2", C.heading2],
  ["paragraph", C.text], ["heading3", C.heading3], ["paragraph", C.text], ["heading1", C.heading1],
  ["heading2", C.heading2], ["heading3", C.heading3], ["bulleted_list", C.bullet1], ["bulleted_list", C.bullet2],
  ["numbered_list", C.number1], ["numbered_list", C.number2], ["todo", C.todo1], ["todo", C.todo2],
  ["toggle", C.toggle], ["quote", C.quote], ["paragraph", C.text], ["bulleted_list", C.bullet],
  ["toggle", C.toggle], ["paragraph", C.text], ["toggle", C.toggle], ["quote", C.quote],
  ["numbered_list", C.number], ["heading2", C.heading2], ["todo", C.todo], ["heading1", C.heading1],
  ["bulleted_list", C.bullet], ["quote", C.quote],
  ["divider", ""], ["paragraph", C.text], ["code", "code"], ["callout", C.callout], ["paragraph", C.text],
];
const uuid = () => crypto.randomUUID();
const created = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "block-spacing.check" }) }).then((r) => r.json());
const pageId = created.page?.id ?? created.id;
if (!pageId) { console.error("Could not create the page:", created); process.exit(1); }
const blocks = SEQ.map(([type, text], i) => ({ id: uuid(), type, content: type === "todo" ? { text, checked: false } : type === "toggle" ? { text, expanded: true } : type === "code" ? { text, language: "plain" } : type === "callout" ? { text, icon: "💡" } : type === "divider" ? {} : { text }, parentBlockId: null, position: i + 1 }));
for (const b of blocks) if (b.type === "toggle") blocks.push({ id: uuid(), type: "paragraph", content: { text: C.toggleChild }, parentBlockId: b.id, position: 1 });
const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({ blocks, deletedIds: [], newIds: blocks.map((b) => b.id) }) });
if (!put.ok) { console.error("Saving blocks failed:", put.status, await put.text()); process.exit(1); }

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
 // gutter: hover → position/size of + and the 6-dot
  await page.locator(sel).hover({ position: { x: 80, y: 6 } }); await page.waitForTimeout(120);
  const grip = await page.locator(`[data-testid="block-handle-${b.id}"]`).boundingBox();
  const plus = await page.locator(`[data-testid="block-add-below-${b.id}"]`).boundingBox();
  if (!grip || !plus) fails.push(`${tag}: gutter not visible`);
  else {
    eq(`${tag} grip dx`, grip.x - m.left, G.gutter.grip.dx); eq(`${tag} grip dy`, grip.y - m.top, G.gutter.dy[role]);
    eq(`${tag} grip size`, `${grip.width}x${grip.height}`, `${G.gutter.grip.w}x${G.gutter.grip.h}`);
    eq(`${tag} plus dx`, plus.x - m.left, G.gutter.plus.dx);
 // 6-dot click → highlight area
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
  console.log(`  ┌─ block spacing/gutter/highlight differs from the original (${fails.length}/${checks}) ─────`);
  for (const f of fails.slice(0, 40)) console.log(`  │ ${f}`);
  if (fails.length > 40) console.log(`  │ … ${fails.length - 40} more`);
  console.log("  └────────────────────────────────────────────────");
  process.exit(1);
}
console.log(`block spacing, heading top margin, gutter and highlight match the original — ${checks} checks, ${tops.length} blocks`);
