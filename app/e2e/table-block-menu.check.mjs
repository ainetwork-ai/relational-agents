// The table block's ⠿ menu — the `Table` group that appears when you press the handle next to + in the gutter.
// Values measured on the original are in src/i18n/content/e2e-fixtures/notion-table-block-menu.json.
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] node e2e/table-block-menu.check.mjs
//
// Where we differ from the original (§ours): the second header item is labeled `Header column` (in the
// original both lines say `Header row` and only the icon differs), and we added `Align`, which the original
// lacks — this menu has no row/column context, so it applies to the whole table.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const G = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-table-block-menu.json", import.meta.url), "utf8"));
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };

const uuid = () => crypto.randomUUID();
const paraId = uuid(), tableId = uuid();
const CELLS = [["a0", "b0", "c0"], ["a1", "b1", "c1"], ["a2", "b2", "c2"]];
const created = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: "table-block-menu.check" }) }).then((r) => r.json());
const pageId = created.page?.id ?? created.id;
if (!pageId) { console.error("Could not create the page:", created); process.exit(1); }
const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({
  blocks: [
    { id: paraId, type: "paragraph", content: { text: "before" }, parentBlockId: null, position: 1 },
    { id: tableId, type: "table", content: { table: { cells: CELLS } }, parentBlockId: null, position: 2 },
  ], deletedIds: [], newIds: [paraId, tableId] }) });
if (!put.ok) { console.error("Saving blocks failed:", put.status, await put.text()); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(`[data-testid="table-cell-${tableId}-0-0"]`, { timeout: 60_000 });
await page.waitForTimeout(400);

const fails = []; let checks = 0;
const eq = (label, got, want, tol = 1) => {
  checks++;
  const ok = typeof want === "number" && typeof got === "number" ? Math.abs(got - want) <= tol : JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails.push(`${label}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
};

const openHandle = async (blockId) => {
  await page.mouse.move(20, 700);
  await page.locator(`[data-testid="block-${blockId}"]`).hover({ position: { x: 120, y: 8 } });
  await page.waitForTimeout(200);
  await page.locator(`[data-testid="block-handle-${blockId}"]`).click();
  await page.waitForTimeout(300);
};
const section = () => page.evaluate((tid) => {
  const head = document.querySelector(`[data-testid="block-table-section-${tid}"]`);
  const row = document.querySelector(`[data-testid="block-table-headerrow-${tid}"]`);
  const colr = document.querySelector(`[data-testid="block-table-headercol-${tid}"]`);
  const align = document.querySelector(`[data-testid="block-table-align-${tid}"]`);
  const sw = (el) => {
    if (!el) return null;
    const pill = [...el.querySelectorAll("span")].find((s) => Math.abs(s.getBoundingClientRect().width - 30) < 3);
    const knob = pill?.firstElementChild;
    const pb = pill?.getBoundingClientRect(), kb = knob?.getBoundingClientRect();
    return pill ? { w: +pb.width.toFixed(1), h: +pb.height.toFixed(1), bg: getComputedStyle(pill).backgroundColor,
      radius: getComputedStyle(pill).borderTopLeftRadius, knob: kb ? { w: +kb.width.toFixed(1), h: +kb.height.toFixed(1) } : null,
      on: el.getAttribute("data-on") } : null;
  };
  const hs = head && getComputedStyle(head);
  return {
    head: head ? { txt: head.textContent.trim(), fs: hs.fontSize, fw: hs.fontWeight } : null,
    labels: [row, colr, align].map((e) => e?.textContent.trim().split("\n")[0] ?? null),
    order: [...document.querySelectorAll('[data-testid^="block-table-"], [data-testid^="block-delete-"]')].map((e) => e.getAttribute("data-testid").replace(/-[0-9a-f-]{36}$/, "")),
    switches: { row: sw(row), col: sw(colr) },
  };
}, tableId);
const look = () => page.evaluate((tid) => {
  const out = [];
  for (let r = 0; ; r++) {
    const row = [];
    for (let c = 0; ; c++) {
      const el = document.querySelector(`[data-testid="table-cell-${tid}-${r}-${c}"]`);
      if (!el) break;
      const w = el.parentElement, ws = getComputedStyle(w);
      const a = ws.textAlign;
      row.push((parseInt(ws.fontWeight, 10) >= 500 ? "B" : ".") + (ws.backgroundColor === "rgba(0, 0, 0, 0)" ? "." : "G") + "/" + (a === "start" ? "left" : a === "end" ? "right" : a));
    }
    if (!row.length) break;
    out.push(row.join(" "));
  }
  return out;
}, tableId);

// ── 1. Only table blocks get the `Table` group ────────────────────────────
{
  await openHandle(paraId);
  eq("paragraph ⠿ menu has no table group", (await section()).head, null);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  await openHandle(tableId);
  const s = await section();
  if (!s.head) fails.push("table block ⠿ menu has no table group"), checks++;
  else {
    eq("group header", s.head.txt, G.section.title);
    eq("header font size", s.head.fs, G.section.fontSize);
    eq("header weight", s.head.fw, G.section.weight);
  }
  eq("item labels", s.labels, [G.tableItems[2].label, G.ours.headerColLabel.split(" —")[0], G.ours.extraItems[0]]);
  eq("table group on top (before the regular items)", s.order[0], "block-table-section");
  eq("switch size", `${s.switches.row.w}x${s.switches.row.h}`, `${G.switch.w}x${G.switch.h}`);
  eq("switch radius", s.switches.row.radius, `${G.switch.radius}px`);
  eq("switch knob", `${s.switches.row.knob.w}x${s.switches.row.knob.h}`, `${G.switch.knob}x${G.switch.knob}`);
  eq("switch off color", s.switches.row.bg, G.switch.off);
  eq("both off at first", [s.switches.row.on, s.switches.col.on], ["0", "0"]);
}

// ── 2. Header row / Header column each turn on their own axis ───────────────────
{
  await page.locator(`[data-testid="block-table-headerrow-${tableId}"]`).click();
  await page.waitForTimeout(400);
  let s = await section();
  eq("header row: switch on", s.switches.row.on, "1");
  eq("header row: switch blue", s.switches.row.bg, G.switch.on);
  eq("header row: menu stays open", !!s.head, true);
  eq("header row: first row is header", (await look())[0].split(" ").every((x) => x.startsWith("BG")), true);
  eq("header row: other rows unchanged", (await look())[1].split(" ")[1].startsWith(".."), true);

  await page.locator(`[data-testid="block-table-headercol-${tableId}"]`).click();
  await page.waitForTimeout(400);
  s = await section();
  eq("header col: switch on", s.switches.col.on, "1");
  const l = await look();
  eq("header col: first col is header", l.every((row) => row.split(" ")[0].startsWith("BG")), true);
  eq("header col: middle cell is plain", l[1].split(" ")[1].startsWith(".."), true);

 // press again to turn off
  await page.locator(`[data-testid="block-table-headerrow-${tableId}"]`).click();
  await page.waitForTimeout(300);
  await page.locator(`[data-testid="block-table-headercol-${tableId}"]`).click();
  await page.waitForTimeout(400);
  eq("both off → plain table", (await look()).join(" ").includes("G"), false);
}

// ── 3. Align (ours) — whole table ─────────────────────────────────
{
  const A = G.ours.alignSubmenu;
  await page.locator(`[data-testid="block-table-align-${tableId}"]`).click();
  await page.waitForTimeout(300);
  const rows = await page.evaluate((tid) => {
    const m = document.querySelector(`[data-testid="block-table-align-menu-${tid}"]`);
    if (!m) return null;
    return [...m.querySelectorAll("button")].map((b) => ({ txt: b.textContent.trim(), on: b.getAttribute("data-on") }));
  }, tableId);
 // Being in the DOM is not enough — the menu box is a scroll box, so absolutely positioning
 // inside it got clipped and was invisible. Also check that it is actually visible on screen (the topmost
 // element at that spot is inside the submenu).
  const visible = await page.evaluate((tid) => {
    const m = document.querySelector(`[data-testid="block-table-align-menu-${tid}"]`);
    if (!m) return { none: true };
    const b = m.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { inWindow: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
      onTop: !!hit && m.contains(hit), w: +b.width.toFixed(1) };
  }, tableId);
  eq("Align submenu is inside the window", visible.inWindow, true);
  eq("Align submenu is not covered", visible.onTop, true);
  if (!rows) fails.push("Align submenu does not open"), checks++;
  else {
    eq("Align items", rows.map((r) => r.txt), A.options);
    eq("default is checked", rows.find((r) => r.on === "1")?.txt, A.default);
  }
  await page.locator(`[data-testid="block-table-align-${tableId}-center"]`).click();
  await page.waitForTimeout(500);
  eq("center: whole table centered", (await look()).every((row) => row.split(" ").every((x) => x.endsWith("/center"))), true);

 // survives a reload (give autosave time to finish)
  await page.waitForTimeout(1800);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-testid="table-cell-${tableId}-0-0"]`);
  await page.waitForTimeout(600);
  eq("still centered after reload", (await look())[1].split(" ")[1].endsWith("/center"), true);

 // the check mark follows the current value
  await openHandle(tableId);
  await page.locator(`[data-testid="block-table-align-${tableId}"]`).click();
  await page.waitForTimeout(300);
  eq("current value (center) checked", await page.evaluate((tid) => document.querySelector(`[data-testid="block-table-align-${tid}-center"]`)?.getAttribute("data-on"), tableId), "1");
  await page.locator(`[data-testid="block-table-align-${tableId}-right"]`).click();
  await page.waitForTimeout(500);
  eq("can change to right too", (await look()).every((row) => row.split(" ").every((x) => x.endsWith("/right"))), true);
  await openHandle(tableId);
  await page.locator(`[data-testid="block-table-align-${tableId}"]`).click();
  await page.waitForTimeout(300);
  await page.locator(`[data-testid="block-table-align-${tableId}-left"]`).click();
  await page.waitForTimeout(500);
  eq("reverted to left", (await look()).every((row) => row.split(" ").every((x) => x.endsWith("/left"))), true);
}

await browser.close();
await fetch(`${BASE}/api/pages/${pageId}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});

if (fails.length) {
  console.log(`  ┌─ table block ⠿ menu differs from what is expected (${fails.length}/${checks}) ─────`);
  for (const f of fails.slice(0, 40)) console.log(`  │ ${f}`);
  console.log("  └──────────────────────────────────────────────");
  process.exit(1);
}
console.log(`table block ⠿ menu (table group · header row/col switches · Align) — ${checks} checks`);
