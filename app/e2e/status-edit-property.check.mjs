// The Edit property sidebar (the one the Status menu's footer opens), measured against the
// original's numbers in `src/i18n/content/e2e-fixtures/notion-status-edit-property.json`.
//
// The original is NOT a popover: it docks under the view toolbar with the
// 290px menu column right-aligned to the toolbar's controls (the original's
// raw -387 includes Notion's 96px page margin baked into its toolbar node —
// see the fixture's dock note), down to the bottom of the window. This script
// walks ours the same way the original was read (2026-08-10):
//
//   1. panel geometry — dock offsets, header, name row, Type row, the three
//      groups with their + buttons, option rows (⠿/chip/Default/›), fixed footer
//   2. an option's menu — 220 wide at pointer-x, flipping UP when the space
//      below runs out; Delete/Set as default/Group, then Default+9 colour swatches
//      with ✓ on the option's own colour
//   3. Group → the 250-wide group list, ✓ on the current group
//   4. Escape peels one layer at a time; the + input appears and cancels
//
//   [BASE_URL=http://localhost:3110] [PAGE_ID=…] [USER_ID=…] [PROP_ID=…] \
//     node e2e/status-edit-property.check.mjs
//
// Read-only: menus are opened and measured, nothing is picked — no option is
// created, recoloured, regrouped or deleted, and no row's value changes.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { ko } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238"; // Projects
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const PROP_ID = process.env.PROP_ID ?? "18a19305-1988-4ea4-815f-266855ac997f"; // Status

const G = JSON.parse(
  fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-status-edit-property.json", import.meta.url), "utf8"),
);
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 } });
await ctx.addCookies([
  { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-cellnav]", { timeout: 60_000 });
await page.waitForTimeout(1200);

const diffs = [];
const eq = (what, got, want) => {
  if (String(got) !== String(want)) diffs.push(`${what}: ours ${got} / Notion ${want}`);
};
const near = (what, got, want, tol = 1) => {
  if (got == null || Math.abs(Number(got) - Number(want)) > tol)
    diffs.push(`${what}: ours ${got} / Notion ${want}`);
};
const parseColor = (v) => {
  const n = String(v).match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
  if (String(v).startsWith("color(")) return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1];
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
};
const sameColor = (what, got, want) => {
  const a = parseColor(got), b = parseColor(want);
  const off = a.slice(0, 3).some((v, i) => Math.abs(v - b[i]) > 1) || Math.abs(a[3] - b[3]) > 0.01;
  if (off) diffs.push(`${what}: ours ${got} / Notion ${want}`);
};

// ---- open: status cell → its menu's Edit property footer -------------------
const cellSel = `[data-testid^='db-cell-'][data-testid$='-${PROP_ID}']`;
await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center", inline: "start" }), cellSel);
await page.waitForTimeout(400);
await page.locator(cellSel).first().click();
await page.waitForTimeout(400);
await page.locator(`[data-testid^='db-status-edit-property-']`).click();
await page.waitForTimeout(500);

const panelSel = `[data-testid^='db-prop-edit-panel-']`;
if (!(await page.locator(panelSel).count())) {
  console.error("the Edit property panel did not open");
  await browser.close();
  process.exit(1);
}

// ---- 1. the panel -----------------------------------------------------------
const P = await page.evaluate((L) => {
  const panel = document.querySelector("[data-testid^='db-prop-edit-panel-']");
  const bar = document.querySelector("[data-testid='db-view-bar']");
  const pb = panel.getBoundingClientRect();
  const bb = bar.getBoundingClientRect();
  const rel = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x - pb.x), y: Math.round(r.y - pb.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const relB = (el) => {
    // footer geometry is pinned to the panel's BOTTOM edge
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x - pb.x), y: Math.round(r.y - pb.bottom), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const ps = getComputedStyle(panel);
  const back = panel.querySelector("[data-testid='db-prop-edit-back']");
  const title = [...panel.querySelectorAll("span")].find((s) => s.textContent === L.title);
  const close = panel.querySelector("[data-testid='db-prop-edit-close']");
  const nameInput = panel.querySelector("[data-testid^='db-prop-edit-name-']");
  const nameBox = nameInput.parentElement;
  const iconBtn = nameBox.parentElement.firstElementChild;
  const typeLeaf = [...panel.querySelectorAll("span")].find((s) => s.textContent === L.type);
  const typeRow = typeLeaf?.parentElement;
  const typeVal = [...(typeRow?.querySelectorAll("span") ?? [])].find((s) => s.textContent === L.status);
  const groups = [...panel.querySelectorAll("[data-testid^='db-prop-edit-group-']")];
  const labels = groups.map((g) => g.querySelector("span"));
  const pluses = [...panel.querySelectorAll("[data-testid^='db-prop-edit-add-option-']")];
  const rows = [...panel.querySelectorAll("[data-optrow]")];
  const chip = rows[0]?.querySelector("[data-chip]");
  // the innermost span only: its wrapper (tag + chevron) reads "Default" too
  const tag = [...rows[0].querySelectorAll("span")].find(
    (s) => !s.children.length && s.textContent === L.defaultTag,
  );
  const chevron = rows[0]?.querySelector("svg:last-of-type") && [...rows[0].querySelectorAll("svg")].at(-1);
  const del = panel.querySelector("[data-testid^='db-prop-edit-delete-']");
  const footer = del.parentElement.parentElement;
  const divider = footer.firstElementChild;
  const footerRows = [...footer.lastElementChild.children];
  const sw = panel.querySelector("[data-testid^='db-prop-edit-wrap-']");
  return {
    dockLeft: Math.round(pb.x - bb.right),
    dockTop: Math.round(pb.y - bb.bottom),
    bottomGap: Math.round(window.innerHeight - pb.bottom),
    rightGap: Math.round(window.innerWidth - pb.right),
    bg: ps.backgroundColor,
    borderLeft: ps.borderLeftColor,
    borderLeftW: ps.borderLeftWidth,
    back: rel(back),
    title: { ...rel(title), fs: getComputedStyle(title).fontSize, fw: getComputedStyle(title).fontWeight },
    close: { ...rel(close), bg: getComputedStyle(close).backgroundColor, radius: getComputedStyle(close).borderRadius },
    iconBtn: { ...rel(iconBtn), border: getComputedStyle(iconBtn).borderColor, radius: getComputedStyle(iconBtn).borderRadius },
    nameBox: { ...rel(nameBox), bg: getComputedStyle(nameBox).backgroundColor, shadow: getComputedStyle(nameBox).boxShadow, radius: getComputedStyle(nameBox).borderRadius },
    nameInputFs: getComputedStyle(nameInput).fontSize,
    typeRow: typeRow ? rel(typeRow) : null,
    typeVal: typeVal ? { color: getComputedStyle(typeVal).color } : null,
    labels: labels.map((l) => ({ ...rel(l), fs: getComputedStyle(l).fontSize, fw: getComputedStyle(l).fontWeight, color: getComputedStyle(l).color, t: l.textContent })),
    pluses: pluses.map(rel),
    rows: rows.map(rel),
    chip: chip ? rel(chip) : null,
    tag: tag ? { ...rel(tag), fs: getComputedStyle(tag).fontSize, fw: getComputedStyle(tag).fontWeight, color: getComputedStyle(tag).color } : null,
    chevron: chevron ? rel(chevron) : null,
    divider: { ...relB(divider), color: getComputedStyle(divider).backgroundColor },
    footerRows: footerRows.map(relB),
    switch: sw ? rel(sw) : null,
    text: panel.innerText.split("\n").map((s) => s.trim()).filter(Boolean),
  };
}, { title: ko("Edit property"), type: ko("Type"), status: ko("Status"), defaultTag: ko("Default") });

near("panel.left − bar.right", P.dockLeft, G.panel.dock.leftFromBarRight);
near("panel.top − bar.bottom", P.dockTop, G.panel.dock.topFromBarBottom);
near("panel bottom → window bottom", P.bottomGap, 0);
near("panel right → window right", P.rightGap, 0);
sameColor("panel.bg", P.bg, G.panel.bg);
eq("panel border-left width", P.borderLeftW, "1px");
sameColor("panel border-left", P.borderLeft, G.panel.borderLeft);
near("back x", P.back.x, G.panel.header.back.x);
near("title x", P.title.x, G.panel.header.title.x);
eq("title fs", P.title.fs, G.panel.header.title.fs);
eq("title fw", P.title.fw, G.panel.header.title.fw);
near("close x", P.close.x, G.panel.header.close.x);
near("close size", P.close.w, G.panel.header.close.size);
sameColor("close bg", P.close.bg, G.panel.header.close.bg);
near("name icon x", P.iconBtn.x, G.panel.nameRow.iconBtn.x);
near("name icon y", P.iconBtn.y, G.panel.nameRow.iconBtn.y);
near("name icon size", P.iconBtn.w, G.panel.nameRow.iconBtn.size);
sameColor("name icon border", P.iconBtn.border, G.panel.nameRow.iconBtn.border);
near("name box x", P.nameBox.x, G.panel.nameRow.box.x);
near("name box y", P.nameBox.y, G.panel.nameRow.box.y);
near("name box w", P.nameBox.w, G.panel.nameRow.box.w);
near("name box h", P.nameBox.h, G.panel.nameRow.box.h);
sameColor("name box bg", P.nameBox.bg, G.panel.nameRow.box.bg);
eq("name box radius", P.nameBox.radius, G.panel.nameRow.box.radius);
eq("name input fs", P.nameInputFs, G.panel.nameRow.inputFs);
near("Type row x", P.typeRow?.x, G.panel.typeRow.x);
near("Type row y", P.typeRow?.y, G.panel.typeRow.y);
near("Type row w", P.typeRow?.w, G.panel.typeRow.w);
sameColor("Type value colour", P.typeVal?.color, G.panel.typeRow.valueColor);

eq("group label count", P.labels.length, G.panel.groupLabel.ys.length);
P.labels.forEach((l, i) => {
  near(`group label #${i} x`, l.x, G.panel.groupLabel.x);
  near(`group label #${i} y`, l.y, G.panel.groupLabel.ys[i]);
  eq(`group label #${i} fs`, l.fs, G.panel.groupLabel.fs);
  eq(`group label #${i} fw`, l.fw, G.panel.groupLabel.fw);
  sameColor(`group label #${i} color`, l.color, G.panel.groupLabel.color);
  eq(`group label #${i} text`, l.t, G.panel.groupLabel.texts[i]);
});
P.pluses.forEach((p, i) => {
  near(`add option button #${i} x`, p.x, G.panel.plusBtn.x);
  near(`add option button #${i} size`, p.w, G.panel.plusBtn.size);
});
eq("option row count", P.rows.length, G.panel.optionRow.ys.length);
P.rows.forEach((r, i) => {
  near(`option row #${i} x`, r.x, G.panel.optionRow.x);
  near(`option row #${i} y`, r.y, G.panel.optionRow.ys[i]);
  near(`option row #${i} w`, r.w, G.panel.optionRow.w);
  near(`option row #${i} h`, r.h, G.panel.optionRow.h);
});
near("chip x", P.chip?.x, G.panel.chip.x);
near("chip h", P.chip?.h, G.panel.chip.h);
// measured at the right edge: the tag is attached right-aligned to the chevron, and x is dragged
// around by the glyph width (headless has no Hangul font)
near("Default tag right", (P.tag?.x ?? 0) + (P.tag?.w ?? 0), G.panel.defaultTag.right);
eq("Default tag fs", P.tag?.fs, G.panel.defaultTag.fs);
eq("Default tag fw", P.tag?.fw, G.panel.defaultTag.fw);
sameColor("Default tag color", P.tag?.color, G.panel.defaultTag.color);
near("row chevron x", P.chevron?.x, G.panel.chevron.x);
near("footer divider x", P.divider.x, G.panel.footer.divider.x);
near("footer divider w", P.divider.w, G.panel.footer.divider.w);
near("footer divider y (from bottom)", P.divider.y, G.panel.footer.divider.yFromBottom);
sameColor("footer divider colour", P.divider.color, G.panel.footer.divider.color);
eq("footer row count", P.footerRows.length, G.panel.footer.rows.ysFromBottom.length);
P.footerRows.forEach((r, i) => {
  near(`footer row #${i} x`, r.x, G.panel.footer.rows.x);
  near(`footer row #${i} y (from bottom)`, r.y, G.panel.footer.rows.ysFromBottom[i]);
  near(`footer row #${i} w`, r.w, G.panel.footer.rows.w);
  near(`footer row #${i} h`, r.h, G.panel.footer.rows.h);
});
near("switch x", P.switch?.x, G.panel.footer.switch.x);
near("switch w", P.switch?.w, G.panel.footer.switch.w);
near("switch h", P.switch?.h, G.panel.footer.switch.h);
eq("reading order", JSON.stringify(P.text), JSON.stringify(G.panel.order));

// hover: an option row highlights like the original's
const row0 = page.locator("[data-optrow]").first();
await row0.hover();
await page.waitForTimeout(150);
const hoverBg = await row0.evaluate((el) => getComputedStyle(el).backgroundColor);
sameColor("option row hover bg", hoverBg, G.panel.optionRow.hoverBg);

// ---- 2. the option menu (In progress) --------------------------------------
const ipRow = page.locator("[data-optrow]").nth(1);
const ipBox = await ipRow.boundingBox();
const clickX = ipBox.x + 40;
await ipRow.click({ position: { x: 40, y: ipBox.height / 2 } });
await page.waitForTimeout(300);

const M = await page.evaluate((colorText) => {
  const box = document.querySelector("[data-testid^='db-option-menu-']");
  if (!box) return null;
  const rb = box.getBoundingClientRect();
  const rel = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x - rb.x), y: Math.round(r.y - rb.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const s = getComputedStyle(box);
  const nameInput = box.querySelector("input");
  const nameBox = nameInput.parentElement;
  const items = [...box.querySelectorAll("[data-testid*='-delete-'],[data-testid*='-default-'],[data-testid*='-group-']")];
  const divider = [...box.querySelectorAll("div")].find((d) => Math.round(d.getBoundingClientRect().height) === 1);
  const colorLabel = [...box.querySelectorAll("span")].find((x) => x.textContent === colorText);
  const colorRows = [...box.querySelectorAll("[data-testid^='db-option-menu-color-']")];
  const checked = colorRows.filter((r) => r.querySelector("svg"));
  return {
    box: { x: Math.round(rb.x), y: Math.round(rb.y), bottom: Math.round(rb.bottom), w: Math.round(rb.width), h: Math.round(rb.height), radius: s.borderRadius, bg: s.backgroundColor, shadow: s.boxShadow },
    nameBox: { ...rel(nameBox), bg: getComputedStyle(nameBox).backgroundColor },
    nameSelected: nameInput.selectionEnd - nameInput.selectionStart === nameInput.value.length && nameInput.value.length > 0,
    nameValue: nameInput.value,
    items: items.map((it) => ({
      ...rel(it),
      iconX: rel(it.querySelector("svg")).x,
      textX: rel([...it.querySelectorAll("span")][0]).x,
    })),
    divider: divider ? rel(divider) : null,
    colorLabel: colorLabel ? { ...rel(colorLabel), fs: getComputedStyle(colorLabel).fontSize, fw: getComputedStyle(colorLabel).fontWeight } : null,
    colorRows: colorRows.map((r) => ({
      ...rel(r),
      swatch: { ...rel(r.firstElementChild), bg: getComputedStyle(r.firstElementChild).backgroundColor, radius: getComputedStyle(r.firstElementChild).borderRadius },
      label: [...r.querySelectorAll("span")][1].textContent,
    })),
    checkedColors: checked.map((r) => ({ label: [...r.querySelectorAll("span")][1].textContent, checkX: rel(r.querySelector("svg")).x })),
    text: box.innerText.split("\n").map((x) => x.trim()).filter(Boolean),
  };
}, ko("Color"));
if (!M) {
  diffs.push("the option menu did not open");
} else {
  near("menu w", M.box.w, G.optionMenu.box.w);
  near("menu h", M.box.h, G.optionMenu.box.h, 2);
  eq("menu radius", M.box.radius, G.optionMenu.box.radius);
  sameColor("menu bg", M.box.bg, G.optionMenu.box.bg);
  eq("menu shadow", M.box.shadow, G.optionMenu.box.shadow);
  near("menu x − click x", M.box.x - clickX, G.optionMenu.anchor.dxFromClick);
  near("menu bottom == row top (opens upward)", M.box.bottom, Math.round(ipBox.y), 1);
  near("menu name box x", M.nameBox.x, G.optionMenu.nameBox.x);
  near("menu name box y", M.nameBox.y, G.optionMenu.nameBox.y);
  near("menu name box w", M.nameBox.w, G.optionMenu.nameBox.w);
  near("menu name box h", M.nameBox.h, G.optionMenu.nameBox.h);
  sameColor("menu name box bg", M.nameBox.bg, G.optionMenu.nameBox.bg);
  eq("menu name fully selected", M.nameSelected, true);
  eq("menu name value", M.nameValue, "In progress");
  eq("menu item count", M.items.length, G.optionMenu.item.ys.length);
  M.items.forEach((it, i) => {
    near(`menu item #${i} x`, it.x, G.optionMenu.item.x);
    near(`menu item #${i} y`, it.y, G.optionMenu.item.ys[i]);
    near(`menu item #${i} w`, it.w, G.optionMenu.item.w);
    near(`menu item #${i} icon x`, it.iconX, G.optionMenu.item.iconX);
    near(`menu item #${i} text x`, it.textX, G.optionMenu.item.textX);
  });
  near("menu divider x", M.divider?.x, G.optionMenu.divider.x);
  near("menu divider y", M.divider?.y, G.optionMenu.divider.y);
  near("menu divider w", M.divider?.w, G.optionMenu.divider.w);
  near("colour label x", M.colorLabel?.x, G.optionMenu.colorLabel.x);
  near("colour label y", M.colorLabel?.y, G.optionMenu.colorLabel.y);
  eq("colour label fs", M.colorLabel?.fs, G.optionMenu.colorLabel.fs);
  eq("colour row count", M.colorRows.length, G.optionMenu.colorRow.count);
  M.colorRows.forEach((r, i) => {
    near(`colour row #${i} y`, r.y, G.optionMenu.colorRow.firstY + i * G.optionMenu.colorRow.step);
    near(`colour swatch #${i} x`, r.swatch.x, G.optionMenu.swatch.x);
    near(`colour swatch #${i} size`, r.swatch.w, G.optionMenu.swatch.size);
    eq(`colour swatch #${i} radius`, r.swatch.radius, G.optionMenu.swatch.radius);
    const want = G.optionMenu.swatchColors[r.label];
    if (want) sameColor(`colour swatch ${r.label}`, r.swatch.bg, want);
  });
  eq("checked colour count", M.checkedColors.length, 1);
  eq("checked colour", M.checkedColors[0]?.label, G.optionMenu.check.onColorForInProgress);
  near("check x", M.checkedColors[0]?.checkX, G.optionMenu.check.x);
  eq("menu reading order", JSON.stringify(M.text), JSON.stringify(G.optionMenu.order));
}

// ---- 3. Group → the group list ------------------------------------------------
const groupRow = page.locator("[data-testid^='db-option-menu-group-']");
const grBox = await groupRow.boundingBox();
await groupRow.click();
await page.waitForTimeout(300);
const GM = await page.evaluate(() => {
  const box = document.querySelector("[data-testid^='db-option-menu-groups-']");
  if (!box) return null;
  const rb = box.getBoundingClientRect();
  const rel = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x - rb.x), y: Math.round(r.y - rb.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const s = getComputedStyle(box);
  const rows = [...box.querySelectorAll("button")];
  const checked = rows.filter((r) => r.querySelector("svg"));
  return {
    box: { x: Math.round(rb.x), y: Math.round(rb.y), right: Math.round(rb.right), w: Math.round(rb.width), h: Math.round(rb.height), radius: s.borderRadius, bg: s.backgroundColor },
    rows: rows.map((r) => ({ ...rel(r), textX: rel(r.querySelector("span")).x, t: r.querySelector("span").textContent })),
    checked: checked.map((r) => ({ t: r.querySelector("span").textContent, checkX: rel(r.querySelector("svg")).x })),
  };
});
if (!GM) {
  diffs.push("the Group submenu did not open");
} else {
  near("group menu w", GM.box.w, G.groupMenu.box.w);
  near("group menu h", GM.box.h, G.groupMenu.box.h);
  eq("group menu radius", GM.box.radius, G.groupMenu.box.radius);
  near("group menu top == Group row bottom", GM.box.y, Math.round(grBox.y + grBox.height), 1);
  near("group menu right == Group row right", GM.box.right, Math.round(grBox.x + grBox.width), 1);
  eq("group row count", GM.rows.length, G.groupMenu.row.ys.length);
  GM.rows.forEach((r, i) => {
    near(`group row #${i} x`, r.x, G.groupMenu.row.x);
    near(`group row #${i} y`, r.y, G.groupMenu.row.ys[i]);
    near(`group row #${i} w`, r.w, G.groupMenu.row.w);
    near(`group row #${i} text x`, r.textX, G.groupMenu.row.textX);
    eq(`group row #${i} text`, r.t, G.groupMenu.order[i]);
  });
  eq("checked group", GM.checked[0]?.t, G.groupMenu.check.on);
  near("group check x", GM.checked[0]?.checkX, G.groupMenu.check.x);
}

// ---- 4. Escape peels one layer; + shows the inline input --------------------
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
eq("Esc ×1 — group menu closed", await page.locator("[data-testid^='db-option-menu-groups-']").count(), 0);
eq("Esc ×1 — option menu stays", await page.locator("[data-testid^='db-option-menu-']").count() > 0, true);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
eq("Esc ×2 — option menu closed", await page.locator("[data-testid^='db-option-menu-']").count(), 0);
eq("Esc ×2 — panel stays", await page.locator(panelSel).count(), 1);

await page.locator("[data-testid^='db-prop-edit-add-option-']").nth(2).click();
await page.waitForTimeout(200);
const addInput = page.locator("[data-testid^='db-prop-edit-add-input-']");
eq("+ → inline input", await addInput.count(), 1);
eq("+ input placeholder", await addInput.getAttribute("placeholder"), ko("Type a new option"));
eq("+ input focus", await addInput.evaluate((el) => document.activeElement === el), true);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
eq("Esc — input closed", await addInput.count(), 0);
eq("Esc — panel stays", await page.locator(panelSel).count(), 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
eq("Esc — panel closed", await page.locator(panelSel).count(), 0);

await browser.close();

if (diffs.length) {
  console.error(`\n  ┌─ Edit property differs from the original (${diffs.length}) ─────────────`);
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ reference: src/i18n/content/e2e-fixtures/notion-status-edit-property.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  "Edit property matches the original — panel (dock/header/name/type/3 groups/6 options/footer), option menu (10 colours·check), group menu, Esc steps·+ input",
);
