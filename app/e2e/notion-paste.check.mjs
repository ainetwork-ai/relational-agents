// Compares Notion "copy all → paste into our editor" against the original.
//
// The input is a real clipboard payload: the 4 MIME types (text/plain·text/html·text/_notion-blocks-v3-production…)
// captured from Cmd+A×2, Cmd+C on the original (the consultation/monitoring FLOW page) are synthesized
// as-is into a ClipboardEvent. The reference is expected-tree.json in the same folder
// (a tree already checked against the original's live DOM catalogue).
//
//   [BASE_URL=http://localhost:3110] node e2e/notion-paste.check.mjs
//
// What it looks at:
//  1) right after pasting: block type·depth·text match the expected tree 1:1 (children of collapsed toggles excluded)
//  2) callouts: blue/gray backgrounds, 💬 icon, callouts without an icon, children inside the box
//  3) toggles: pasted collapsed, children appear when expanded (the original is collapsed too)
//  4) no literal '**' or '<aside>' anywhere
//  5) 1) still holds after a reload (the save path passes too)
//
// Without the payload (captures are not committed) it cannot measure and exits 1 — it does not fill
// the gap with guesses. To capture again: open the original with the docs/notion-golden-set.md procedure and run
//   node scratchpad/capture-clipboard.mjs docs/notion-clip-flow-page   # capture of the Cmd+A×2 copy
//   node scratchpad/probe-paste-types.mjs docs/notion-clip-flow-page   # the 4 MIME types of the paste event
// or have a person copy and fill it in.

import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { content } from "./i18n.mjs";

const C = content.NOTION_PASTE;

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
// the dev DB was reseeded before 2026-08-27 — the old default id gives 401 (docs/notion-golden-set.md)
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj
const DIR = new URL("../../docs/notion-clip-flow-page/", import.meta.url);

const need = (f) => {
  const p = new URL(f, DIR);
  if (!fs.existsSync(p)) {
    console.error(`\n  capture missing: docs/notion-clip-flow-page/${f}`);
    console.error("  (original data that is not committed — capture it again with the procedure in the header comment)\n");
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

// With ENV_FILE/USER_ID it can target prod too (deploy verification). With ARCHIVE=1 the pages
// it makes are archived at the end — so it leaves no leftovers in the prod sidebar.
const envPath = process.env.ENV_FILE
  ? new URL(process.env.ENV_FILE, `file://${process.cwd()}/`)
  : new URL("../.env.local", import.meta.url);
const env = fs.readFileSync(envPath, "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

// ---- create the comparison page (dev DB — disposable) ------------------------
const madePages = [];
const createPage = async (label) => {
  const created = await fetch(`${BASE}/api/pages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `rm-session=${cookie}` },
    body: JSON.stringify({ title: `notion-paste.check ${label} ${new Date().toISOString().slice(0, 16)}` }),
  });
  if (created.status !== 201) {
    console.error("page creation failed:", created.status, await created.text());
    process.exit(1);
  }
  const id = (await created.json()).page.id;
  madePages.push(id);
  console.log(`comparison page (${label}): ${BASE}/p/${id}`);
  return id;
};
const pageId = await createPage("json");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([
  { name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" },
]);
const page = await ctx.newPage();
await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-block-type='paragraph'] [contenteditable]", { timeout: 60_000 });

// ---- synthesize the paste straight from the real clipboard -----------------
await page.evaluate((payload) => {
  const el = document.querySelector("[data-block-type='paragraph'] [contenteditable]");
  el.focus();
  const dt = new DataTransfer();
  for (const [type, data] of Object.entries(payload)) dt.setData(type, data);
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, PAYLOAD);
await page.waitForTimeout(1500);

// ---- editor DOM → {type, depth, text} tree ----------------------------------
const READ_TREE = () => {
  const rows = [...document.querySelectorAll("[data-testid^='block-'][data-block-type]")];
  return rows.map((row) => {
    let depth = 0;
    for (let p = row.parentElement; p; p = p.parentElement)
      if (p.matches?.("[data-testid^='block-'][data-block-type]")) depth++;
    const leaf = [...row.querySelectorAll("[contenteditable]")].find(
      (l) => l.closest("[data-testid^='block-'][data-block-type]") === row
    );
    // textContent swallows <br> whole — read it back as a newline
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
const TODO_LIT = /^\[( |x)\]\s/i;

// expected tree → the sequence that "should be on screen". Children of collapsed toggles are not visible.
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
  ok(got.length === want.length, `${label}: block count ${got.length} == ${want.length}`);
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
  ok(mismatch === 0, `${label}: type·depth·text·checked·color match (mismatches ${mismatch})`);
};

// ---- 1) right after pasting --------------------------------------------------
let got = await page.evaluate(READ_TREE);
compare(got, visibleExpected(EXPECTED), "right after paste (collapsed toggles excluded)");

// ---- 4) literal markdown leftovers ------------------------------------------
const litNow = got.filter((b) => b.text.includes("**") || b.text.includes("<aside>"));
ok(litNow.length === 0, `no literal '**'/'<aside>' (found ${litNow.length})`);

// ---- 2) callouts ------------------------------------------------------------
const blue = got.find((b) => b.type === "callout" && b.color === "blue");
ok(!!blue, "blue background callout exists");
const calloutProbe = await page.evaluate(() => {
  // The callout box is the only node with data-color — the callout-icon-/callout-color-
  // triggers share the prefix, so filter on that. The blue callout is a single line in the
  // original (Notion v2 rule: the first text child is absorbed into the body) — 0 children is right.
  const box = [...document.querySelectorAll("[data-testid^='callout-'][data-color]")][0];
  if (!box) return null;
  return {
    icon: box.querySelector("[data-testid^='callout-icon-']")?.textContent?.trim() ?? null,
    childCount: box.querySelectorAll("[data-block-type]").length,
  };
});
ok(calloutProbe?.icon === "💬", `callout icon 💬 (${calloutProbe?.icon})`);
ok(calloutProbe?.childCount === 0, `single-line callout absorbed into the body (children ${calloutProbe?.childCount})`);

// ---- 3) toggles: pasted collapsed, children when expanded --------------------
const togglesBefore = got.filter((b) => b.type === "toggle").length;
ok(togglesBefore === 2, `2 toggles (${togglesBefore})`);
// collapsed = child blocks not in the DOM (the visibleExpected comparison already saw it, but explicitly)
ok(!got.some((b) => b.text.startsWith(C.toggleChild)), "toggle pasted collapsed");

// expand all (there are no toggles inside toggles)
await page.evaluate(() => {
  for (const btn of document.querySelectorAll("[data-testid^='toggle-expand-']")) btn.click();
});
await page.waitForTimeout(600);
got = await page.evaluate(READ_TREE);
compare(got, EXPECTED, "after expanding all toggles (whole tree)");

const litAll = got.filter((b) => b.text.includes("**") || b.text.includes("<aside>"));
ok(litAll.length === 0, `still no literal '**'/'<aside>' after expanding (found ${litAll.length})`);

// gray callouts without an icon (the ones inside the toggles)
const gray = got.filter((b) => b.type === "callout" && b.color === "gray");
ok(gray.length === 2, `2 gray callouts (${gray.length})`);

// multi-block callout: the children must be drawn **inside** the colored box (Notion layout)
const multiProbe = await page.evaluate((heading) => {
  const boxes = [...document.querySelectorAll("[data-testid^='callout-'][data-color]")];
  const box = boxes.find((b) => b.textContent.includes(heading));
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
}, C.scenarioHeading);
ok(
  multiProbe?.childCount === 14 && multiProbe?.allInside === true,
  `multi-block callout has its 14 children inside the box (${multiProbe?.childCount}, inside=${multiProbe?.allInside})`
);
const noIcon = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("[data-testid^='callout-'][data-color]")];
  return boxes.filter((b) => !b.querySelector("[data-testid^='callout-icon-']")).length;
});
ok(noIcon === 2, `2 callouts without an icon (${noIcon})`);

// bold: Notion annotations as <b> (including bold on spaces and punctuation), without **
const boldPara = got.find((b) => b.text.includes(C.boldWord));
ok(!!boldPara && /<b>/.test(boldPara.html) && !boldPara.html.includes("**"),
  "the once-broken bold paragraph restored as <b>");

// ---- 5) survives a reload -----------------------------------------------------
// the toggles were expanded above and that state is saved — the reload reference is the whole tree.
await page.waitForTimeout(2500); // save flush
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-block-type]", { timeout: 60_000 });
await page.waitForTimeout(1200);
got = await page.evaluate(READ_TREE);
compare(got, EXPECTED, "after reload (expanded toggle state saved)");

// ---- 6) without the custom MIME (text/html + text/plain only) ----------------
// When the clipboard pipe is not Chromium-family (or on some copy paths) the custom formats
// do not come along — then Notion's markdown-round-trip HTML has to be restored. In this flavor
// the toggle collapse carries no information at all, so staying a bullet is a physical limit.
const pageId2 = await createPage("html-only");
await page.goto(`${BASE}/p/${pageId2}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-block-type='paragraph'] [contenteditable]", { timeout: 60_000 });
await page.evaluate((payload) => {
  const el = document.querySelector("[data-block-type='paragraph'] [contenteditable]");
  el.focus();
  const dt = new DataTransfer();
  dt.setData("text/plain", payload["text/plain"]);
  dt.setData("text/html", payload["text/html"]);
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, PAYLOAD);
await page.waitForTimeout(1500);
got = await page.evaluate(READ_TREE);

const count = (ty) => got.filter((b) => b.type === ty).length;
ok(count("heading3") === 4, `html-only: 4 heading3 (${count("heading3")})`);
ok(count("callout") === 3, `html-only: 3 callouts (${count("callout")})`);
ok(count("todo") === 15, `html-only: 15 todos (${count("todo")})`);
ok(count("file") === 3, `html-only: 3 files (${count("file")})`);
ok(count("numbered_list") === 2, `html-only: 2 numbered list items (${count("numbered_list")})`);
const checkedN = got.filter((b) => b.type === "todo" && b.checked).length;
ok(checkedN === 7, `html-only: 7 checked todos (${checkedN})`);
const junk = got.filter(
  (b) => b.text.includes("**") || b.text.includes("<aside>") || TODO_LIT.test(b.text)
);
ok(junk.length === 0, `html-only: no literal '**'/'<aside>'/'[x]' (found ${junk.length})`);
const bold2 = got.find((b) => b.text.includes(C.boldWord));
ok(!!bold2 && /<b>/.test(bold2.html) && !bold2.html.includes("**"), "html-only: bold restored as <b>");
const firstCallout = got.find((b) => b.type === "callout");
const cIcon = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("[data-testid^='callout-'][data-color]")];
  return boxes.map((b) => b.querySelector("[data-testid^='callout-icon-']")?.textContent?.trim() ?? null);
});
ok(!!firstCallout && cIcon[0] === "💬", `html-only: first callout icon 💬 (${cIcon[0]})`);
ok(cIcon.slice(1).every((i) => i === null), `html-only: other callouts have no icon (${JSON.stringify(cIcon.slice(1))})`);
const scenario = got.find((b) => b.type === "callout" && b.text.includes(C.scenarioHeading));
ok(!!scenario, `html-only: '${C.scenarioHeading}' absorbed into the callout body`);
const tl = got.find((b) => b.text.startsWith(C.timelineItem));
ok(tl?.type === "bulleted_list" && tl?.depth === 1, `html-only: the former toggle item becomes a bullet (limit, ${tl?.type}@${tl?.depth})`);

await browser.close();
if (process.env.ARCHIVE === "1") {
  for (const id of madePages) {
    const r = await fetch(`${BASE}/api/pages/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `rm-session=${cookie}` },
      body: JSON.stringify({ isArchived: true }),
    });
    console.log(`archived comparison page (${id.slice(0, 8)}): ${r.status}`);
  }
}
if (fails.length) {
  console.error(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nno difference from the original — exit 0");
