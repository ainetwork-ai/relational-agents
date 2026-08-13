// The 속성 편집 sidebar (Status 메뉴의 푸터가 여는 것), measured against the
// original's numbers in `fixtures/notion-status-edit-property.json`.
//
// The original is NOT a popover: it docks under the view toolbar, 387px left
// of the toolbar's right edge, down to the bottom of the window. This script
// walks ours the same way the original was read (2026-08-10):
//
//   1. panel geometry — dock offsets, header, name row, 유형 row, the three
//      groups with their + buttons, option rows (⠿/chip/기본/›), fixed footer
//   2. an option's menu — 220 wide at pointer-x, flipping UP when the space
//      below runs out; 삭제/기본으로 설정/그룹화, then 기본+9 colour swatches
//      with ✓ on the option's own colour
//   3. 그룹화 → the 250-wide group list, ✓ on the current group
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

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.PAGE_ID ?? "af7fc488-3666-4935-9eb9-92d23ebe8238"; // Projects
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";
const PROP_ID = process.env.PROP_ID ?? "18a19305-1988-4ea4-815f-266855ac997f"; // Status

const G = JSON.parse(
  fs.readFileSync(new URL("./fixtures/notion-status-edit-property.json", import.meta.url), "utf8"),
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
  if (String(got) !== String(want)) diffs.push(`${what}: 우리 ${got} / 노션 ${want}`);
};
const near = (what, got, want, tol = 1) => {
  if (got == null || Math.abs(Number(got) - Number(want)) > tol)
    diffs.push(`${what}: 우리 ${got} / 노션 ${want}`);
};
const parseColor = (v) => {
  const n = String(v).match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
  if (String(v).startsWith("color(")) return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1];
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
};
const sameColor = (what, got, want) => {
  const a = parseColor(got), b = parseColor(want);
  const off = a.slice(0, 3).some((v, i) => Math.abs(v - b[i]) > 1) || Math.abs(a[3] - b[3]) > 0.01;
  if (off) diffs.push(`${what}: 우리 ${got} / 노션 ${want}`);
};

// ---- open: status cell → its menu's 속성 편집 footer ------------------------
const cellSel = `[data-testid^='db-cell-'][data-testid$='-${PROP_ID}']`;
await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center", inline: "start" }), cellSel);
await page.waitForTimeout(400);
await page.locator(cellSel).first().click();
await page.waitForTimeout(400);
await page.locator(`[data-testid^='db-status-edit-property-']`).click();
await page.waitForTimeout(500);

const panelSel = `[data-testid^='db-prop-edit-panel-']`;
if (!(await page.locator(panelSel).count())) {
  console.error("속성 편집 패널이 열리지 않았습니다");
  await browser.close();
  process.exit(1);
}

// ---- 1. the panel -----------------------------------------------------------
const P = await page.evaluate(() => {
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
  const title = [...panel.querySelectorAll("span")].find((s) => s.textContent === "속성 편집");
  const close = panel.querySelector("[data-testid='db-prop-edit-close']");
  const nameInput = panel.querySelector("[data-testid^='db-prop-edit-name-']");
  const nameBox = nameInput.parentElement;
  const iconBtn = nameBox.parentElement.firstElementChild;
  const typeLeaf = [...panel.querySelectorAll("span")].find((s) => s.textContent === "유형");
  const typeRow = typeLeaf?.parentElement;
  const typeVal = [...(typeRow?.querySelectorAll("span") ?? [])].find((s) => s.textContent === "상태");
  const groups = [...panel.querySelectorAll("[data-testid^='db-prop-edit-group-']")];
  const labels = groups.map((g) => g.querySelector("span"));
  const pluses = [...panel.querySelectorAll("[data-testid^='db-prop-edit-add-option-']")];
  const rows = [...panel.querySelectorAll("[data-optrow]")];
  const chip = rows[0]?.querySelector("[data-chip]");
  // the innermost span only: its wrapper (tag + chevron) reads "기본" too
  const tag = [...rows[0].querySelectorAll("span")].find(
    (s) => !s.children.length && s.textContent === "기본",
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
});

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
near("유형 row x", P.typeRow?.x, G.panel.typeRow.x);
near("유형 row y", P.typeRow?.y, G.panel.typeRow.y);
near("유형 row w", P.typeRow?.w, G.panel.typeRow.w);
sameColor("유형 값 색", P.typeVal?.color, G.panel.typeRow.valueColor);

eq("그룹 라벨 수", P.labels.length, G.panel.groupLabel.ys.length);
P.labels.forEach((l, i) => {
  near(`그룹 라벨 #${i} x`, l.x, G.panel.groupLabel.x);
  near(`그룹 라벨 #${i} y`, l.y, G.panel.groupLabel.ys[i]);
  eq(`그룹 라벨 #${i} fs`, l.fs, G.panel.groupLabel.fs);
  eq(`그룹 라벨 #${i} fw`, l.fw, G.panel.groupLabel.fw);
  sameColor(`그룹 라벨 #${i} color`, l.color, G.panel.groupLabel.color);
  eq(`그룹 라벨 #${i} text`, l.t, G.panel.groupLabel.texts[i]);
});
P.pluses.forEach((p, i) => {
  near(`옵션 추가 버튼 #${i} x`, p.x, G.panel.plusBtn.x);
  near(`옵션 추가 버튼 #${i} size`, p.w, G.panel.plusBtn.size);
});
eq("옵션 행 수", P.rows.length, G.panel.optionRow.ys.length);
P.rows.forEach((r, i) => {
  near(`옵션 행 #${i} x`, r.x, G.panel.optionRow.x);
  near(`옵션 행 #${i} y`, r.y, G.panel.optionRow.ys[i]);
  near(`옵션 행 #${i} w`, r.w, G.panel.optionRow.w);
  near(`옵션 행 #${i} h`, r.h, G.panel.optionRow.h);
});
near("칩 x", P.chip?.x, G.panel.chip.x);
near("칩 h", P.chip?.h, G.panel.chip.h);
// 오른쪽 끝으로 잰다: 태그는 chevron에 오른쪽 기준으로 붙고, x는 글리프 폭
// (헤드리스에는 한글 폰트가 없다)에 끌려다닌다
near("기본 태그 right", (P.tag?.x ?? 0) + (P.tag?.w ?? 0), G.panel.defaultTag.right);
eq("기본 태그 fs", P.tag?.fs, G.panel.defaultTag.fs);
eq("기본 태그 fw", P.tag?.fw, G.panel.defaultTag.fw);
sameColor("기본 태그 color", P.tag?.color, G.panel.defaultTag.color);
near("행 chevron x", P.chevron?.x, G.panel.chevron.x);
near("푸터 구분선 x", P.divider.x, G.panel.footer.divider.x);
near("푸터 구분선 w", P.divider.w, G.panel.footer.divider.w);
near("푸터 구분선 y(바닥 기준)", P.divider.y, G.panel.footer.divider.yFromBottom);
sameColor("푸터 구분선 색", P.divider.color, G.panel.footer.divider.color);
eq("푸터 행 수", P.footerRows.length, G.panel.footer.rows.ysFromBottom.length);
P.footerRows.forEach((r, i) => {
  near(`푸터 행 #${i} x`, r.x, G.panel.footer.rows.x);
  near(`푸터 행 #${i} y(바닥 기준)`, r.y, G.panel.footer.rows.ysFromBottom[i]);
  near(`푸터 행 #${i} w`, r.w, G.panel.footer.rows.w);
  near(`푸터 행 #${i} h`, r.h, G.panel.footer.rows.h);
});
near("스위치 x", P.switch?.x, G.panel.footer.switch.x);
near("스위치 w", P.switch?.w, G.panel.footer.switch.w);
near("스위치 h", P.switch?.h, G.panel.footer.switch.h);
eq("읽히는 순서", JSON.stringify(P.text), JSON.stringify(G.panel.order));

// hover: an option row highlights like the original's
const row0 = page.locator("[data-optrow]").first();
await row0.hover();
await page.waitForTimeout(150);
const hoverBg = await row0.evaluate((el) => getComputedStyle(el).backgroundColor);
sameColor("옵션 행 hover bg", hoverBg, G.panel.optionRow.hoverBg);

// ---- 2. the option menu (In progress) --------------------------------------
const ipRow = page.locator("[data-optrow]").nth(1);
const ipBox = await ipRow.boundingBox();
const clickX = ipBox.x + 40;
await ipRow.click({ position: { x: 40, y: ipBox.height / 2 } });
await page.waitForTimeout(300);

const M = await page.evaluate(() => {
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
  const colorLabel = [...box.querySelectorAll("span")].find((x) => x.textContent === "색");
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
});
if (!M) {
  diffs.push("옵션 메뉴가 열리지 않았습니다");
} else {
  near("메뉴 w", M.box.w, G.optionMenu.box.w);
  near("메뉴 h", M.box.h, G.optionMenu.box.h, 2);
  eq("메뉴 radius", M.box.radius, G.optionMenu.box.radius);
  sameColor("메뉴 bg", M.box.bg, G.optionMenu.box.bg);
  eq("메뉴 shadow", M.box.shadow, G.optionMenu.box.shadow);
  near("메뉴 x − 클릭 x", M.box.x - clickX, G.optionMenu.anchor.dxFromClick);
  near("메뉴 bottom == 행 top (위로 펼침)", M.box.bottom, Math.round(ipBox.y), 1);
  near("메뉴 이름 박스 x", M.nameBox.x, G.optionMenu.nameBox.x);
  near("메뉴 이름 박스 y", M.nameBox.y, G.optionMenu.nameBox.y);
  near("메뉴 이름 박스 w", M.nameBox.w, G.optionMenu.nameBox.w);
  near("메뉴 이름 박스 h", M.nameBox.h, G.optionMenu.nameBox.h);
  sameColor("메뉴 이름 박스 bg", M.nameBox.bg, G.optionMenu.nameBox.bg);
  eq("메뉴 이름 전체선택", M.nameSelected, true);
  eq("메뉴 이름 값", M.nameValue, "In progress");
  eq("메뉴 아이템 수", M.items.length, G.optionMenu.item.ys.length);
  M.items.forEach((it, i) => {
    near(`메뉴 아이템 #${i} x`, it.x, G.optionMenu.item.x);
    near(`메뉴 아이템 #${i} y`, it.y, G.optionMenu.item.ys[i]);
    near(`메뉴 아이템 #${i} w`, it.w, G.optionMenu.item.w);
    near(`메뉴 아이템 #${i} icon x`, it.iconX, G.optionMenu.item.iconX);
    near(`메뉴 아이템 #${i} text x`, it.textX, G.optionMenu.item.textX);
  });
  near("메뉴 구분선 x", M.divider?.x, G.optionMenu.divider.x);
  near("메뉴 구분선 y", M.divider?.y, G.optionMenu.divider.y);
  near("메뉴 구분선 w", M.divider?.w, G.optionMenu.divider.w);
  near("색 라벨 x", M.colorLabel?.x, G.optionMenu.colorLabel.x);
  near("색 라벨 y", M.colorLabel?.y, G.optionMenu.colorLabel.y);
  eq("색 라벨 fs", M.colorLabel?.fs, G.optionMenu.colorLabel.fs);
  eq("색 행 수", M.colorRows.length, G.optionMenu.colorRow.count);
  M.colorRows.forEach((r, i) => {
    near(`색 행 #${i} y`, r.y, G.optionMenu.colorRow.firstY + i * G.optionMenu.colorRow.step);
    near(`색 스와치 #${i} x`, r.swatch.x, G.optionMenu.swatch.x);
    near(`색 스와치 #${i} size`, r.swatch.w, G.optionMenu.swatch.size);
    eq(`색 스와치 #${i} radius`, r.swatch.radius, G.optionMenu.swatch.radius);
    const want = G.optionMenu.swatchColors[r.label];
    if (want) sameColor(`색 스와치 ${r.label}`, r.swatch.bg, want);
  });
  eq("체크된 색 수", M.checkedColors.length, 1);
  eq("체크된 색", M.checkedColors[0]?.label, G.optionMenu.check.onColorForInProgress);
  near("체크 x", M.checkedColors[0]?.checkX, G.optionMenu.check.x);
  eq("메뉴 읽히는 순서", JSON.stringify(M.text), JSON.stringify(G.optionMenu.order));
}

// ---- 3. 그룹화 → the group list ---------------------------------------------
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
  diffs.push("그룹화 서브메뉴가 열리지 않았습니다");
} else {
  near("그룹 메뉴 w", GM.box.w, G.groupMenu.box.w);
  near("그룹 메뉴 h", GM.box.h, G.groupMenu.box.h);
  eq("그룹 메뉴 radius", GM.box.radius, G.groupMenu.box.radius);
  near("그룹 메뉴 top == 그룹화 행 bottom", GM.box.y, Math.round(grBox.y + grBox.height), 1);
  near("그룹 메뉴 right == 그룹화 행 right", GM.box.right, Math.round(grBox.x + grBox.width), 1);
  eq("그룹 행 수", GM.rows.length, G.groupMenu.row.ys.length);
  GM.rows.forEach((r, i) => {
    near(`그룹 행 #${i} x`, r.x, G.groupMenu.row.x);
    near(`그룹 행 #${i} y`, r.y, G.groupMenu.row.ys[i]);
    near(`그룹 행 #${i} w`, r.w, G.groupMenu.row.w);
    near(`그룹 행 #${i} text x`, r.textX, G.groupMenu.row.textX);
    eq(`그룹 행 #${i} text`, r.t, G.groupMenu.order[i]);
  });
  eq("체크된 그룹", GM.checked[0]?.t, G.groupMenu.check.on);
  near("그룹 체크 x", GM.checked[0]?.checkX, G.groupMenu.check.x);
}

// ---- 4. Escape peels one layer; + shows the inline input --------------------
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
eq("Esc ×1 — 그룹 메뉴 닫힘", await page.locator("[data-testid^='db-option-menu-groups-']").count(), 0);
eq("Esc ×1 — 옵션 메뉴 유지", await page.locator("[data-testid^='db-option-menu-']").count() > 0, true);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
eq("Esc ×2 — 옵션 메뉴 닫힘", await page.locator("[data-testid^='db-option-menu-']").count(), 0);
eq("Esc ×2 — 패널 유지", await page.locator(panelSel).count(), 1);

await page.locator("[data-testid^='db-prop-edit-add-option-']").nth(2).click();
await page.waitForTimeout(200);
const addInput = page.locator("[data-testid^='db-prop-edit-add-input-']");
eq("+ → 인라인 인풋", await addInput.count(), 1);
eq("+ 인풋 placeholder", await addInput.getAttribute("placeholder"), "새 옵션을 입력하세요");
eq("+ 인풋 포커스", await addInput.evaluate((el) => document.activeElement === el), true);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
eq("Esc — 인풋 닫힘", await addInput.count(), 0);
eq("Esc — 패널 유지", await page.locator(panelSel).count(), 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
eq("Esc — 패널 닫힘", await page.locator(panelSel).count(), 0);

await browser.close();

if (diffs.length) {
  console.error(`\n  ┌─ 속성 편집이 원본과 다릅니다 (${diffs.length}건) ─────────────`);
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ 기준: e2e/fixtures/notion-status-edit-property.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  "속성 편집 원본과 일치 — 패널(도킹/헤더/이름/유형/그룹 3/옵션 6/푸터), 옵션 메뉴(색 10·체크), 그룹 메뉴, Esc 단계·+ 인풋",
);
