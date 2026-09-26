// Measures, scenario by scenario, how our app's "indent" **currently** behaves.
// The goal is to be able to state the same table as Notion (T1~T22) on our side,
// and to keep only measured values, not judgements — scenarios that could not be measured go to failures.
//
// Why measure this way
//  - Keys are really pressed (Tab / Shift+Tab / Enter / Backspace / typing). Calling indent()
//    directly misses entirely the cases where a key handler blocks it (Tab in a code block, Tab in
//    selection mode).
//  - Looking only at the DOM is not enough. The editor saves separately through a transaction queue, so
//    "indented on screen but not saved" is a real possible state. So after a keystroke we also record
//    the parentBlockId from GET /api/pages/<id>/blocks.
//  - A new page per scenario. Continuing on one page lets the parent/sibling relations an earlier
//    scenario made contaminate the next result. All pages made are archived at the end.
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] [ONLY=T4_enter_after_indented,T6_shift_tab]
//   node e2e/indent.measure.mjs
//
// Uses the dev server already running on 3110 (CLAUDE.md). dev data is disposable.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj
const ONLY = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = new URL("./out-indent.json", import.meta.url);

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };
const uuid = () => crypto.randomUUID();

// 1x1 png — an image block needs a real URL for rendering to finish (no network involved)
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
// content shape per type — same rules as block-spacing.check.mjs
const contentOf = (type, text) =>
  type === "todo" ? { text, checked: false }
  : type === "toggle" ? { text, expanded: true }
  : type === "code" ? { text: text || "code()", language: "plain" }
  : type === "callout" ? { text, icon: "💡" }
  : type === "divider" ? {}
  : type === "image" ? { url: PNG }
  : { text };

// ── Making pages ────────────────────────────────────────────────────────────
const createdPages = [];
/** seed: [{ k, type, text?, parent? }] — parent points to an earlier k */
async function build(name, seed) {
  const res = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: `indent.measure ${name}` }) }).then((r) => r.json());
  const pageId = res.page?.id ?? res.id;
  if (!pageId) throw new Error(`page create failed: ${JSON.stringify(res).slice(0, 200)}`);
  createdPages.push(pageId);
  // A new page holds one bootstrap empty paragraph (block-editor.tsx bootstrapParagraph).
  // Left in place, an unidentified empty paragraph gets mixed into the tree and position 1 collides, blurring the order.
  const existing = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { headers: H }).then((r) => r.json()).catch(() => ({}));
  const stale = (existing.blocks ?? []).map((b) => b.id);
  const ids = {};
  const nth = new Map();
  const blocks = seed.map((s) => {
    const id = uuid();
    ids[s.k] = id;
    const parentBlockId = s.parent ? ids[s.parent] : null;
    const bucket = parentBlockId ?? "root";
    const position = (nth.get(bucket) ?? 0) + 1;
    nth.set(bucket, position);
    return { id, type: s.type, content: contentOf(s.type, s.text ?? s.k), parentBlockId, position };
  });
  const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({ blocks, deletedIds: stale, newIds: blocks.map((b) => b.id) }) });
  if (!put.ok) throw new Error(`seed failed ${put.status}: ${(await put.text()).slice(0, 200)}`);
  const key = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v.slice(0, 8), k]));
  const p = { pageId, ids, key, name };
  await openPage(p);
  return p;
}

// ── Browser ─────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const tab = await ctx.newPage();
const pageErrors = [];
tab.on("pageerror", (e) => pageErrors.push(String(e)));
// Count save transactions: "pressed Tab and 0 save requests" is itself evidence
let saveStarted = 0, saveDone = 0;
tab.on("request", (r) => { if (r.url().includes("/api/saveTransactions")) saveStarted++; });
tab.on("requestfinished", (r) => { if (r.url().includes("/api/saveTransactions")) saveDone++; });
tab.on("requestfailed", (r) => { if (r.url().includes("/api/saveTransactions")) saveDone++; });

async function openPage(p) {
  await tab.goto(`${BASE}/p/${p.pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await tab.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 90_000 });
  await tab.waitForTimeout(700);
}

// ── Measuring tools ─────────────────────────────────────────────────────────
/** Place the caret. Keys are really pressed, but positions like "mid-sentence" have to be set exactly
 *  with a Range to reproduce T2/T14. A click makes the offset wobble on wrapped lines. */
const caret = (id, where) =>
  tab.evaluate(([id, where]) => {
    const el = document.querySelector(`[data-testid="block-editable-${id}"]`);
    if (!el) return { placed: false, why: "no editable" };
    el.focus();
    const t = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : el;
    const len = t.nodeType === 3 ? t.textContent.length : t.childNodes.length;
    const off = where === "end" ? len : where === "mid" ? Math.floor(len / 2) : Math.min(Number(where) || 0, len);
    const r = document.createRange();
    r.setStart(t, off);
    r.collapse(true);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return { placed: document.activeElement === el, offset: off, len, text: (el.innerText ?? "").slice(0, 24) };
  }, [id, where]);

/** Where the caret is after a keystroke — the table also needs whether indenting loses the caret */
const caretNow = () =>
  tab.evaluate(() => {
    const s = getSelection();
    if (!s || !s.rangeCount) return { none: true, active: document.activeElement?.tagName ?? null };
    const n = s.anchorNode;
    const el = n && (n.nodeType === 3 ? n.parentElement : n);
    return {
      block: el?.closest?.("[data-block-type]")?.getAttribute("data-testid")?.slice(6, 14) ?? null,
      offset: s.anchorOffset,
      collapsed: s.isCollapsed,
      inEditable: !!document.activeElement?.isContentEditable,
    };
  });

/** The block tree on screen: id·type·nesting depth (number of [data-block-type] ancestors inside editor-root)·
 *  indent px (the row's padding-left)·editable left x·list marker text */
const domTree = () =>
  tab.evaluate(() => {
    const root = document.querySelector('[data-testid="editor-root"]');
    if (!root) return [];
    const own = (row, sel) => [...row.querySelectorAll(sel)].find((e) => e.closest("[data-block-type]") === row) ?? null;
    return [...root.querySelectorAll("[data-block-type]")].map((row) => {
      const id = (row.getAttribute("data-testid") ?? "").slice("block-".length);
      let depth = 0;
      for (let p = row.parentElement; p && p !== root; p = p.parentElement) if (p.matches("[data-block-type]")) depth++;
      const ce = own(row, "[contenteditable]");
      const pad = row.firstElementChild ? parseFloat(getComputedStyle(row.firstElementChild).paddingLeft) : null;
      const sib = ce?.previousElementSibling;
      const toggleBtn = own(row, '[data-testid^="toggle-expand-"]');
      const todoBox = own(row, '[data-testid^="todo-checkbox-"]');
      const marker =
        sib && sib.tagName === "SPAN" ? (sib.textContent ?? "").trim()
        : toggleBtn ? ((toggleBtn.textContent ?? "").trim() || "▸")
        : todoBox ? "checkbox"
        : null;
      return {
        id: id.slice(0, 8),
        type: row.getAttribute("data-block-type"),
        domDepth: depth,
        padLeft: pad,
        ceLeft: ce ? +ce.getBoundingClientRect().left.toFixed(1) : null,
        marker,
        text: (ce?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 22),
      };
    });
  });

/** Whether saving is done: until at least one transaction request has gone out and none are in flight (max ms).
 *  The baseline (base) is the count **before** the keystroke — the queue flushes synchronously when idle, so
 *  starting the count right after the keypress records an already-finished save as "0".
 *  With no change no save request goes out at all, so move on without waiting long. */
let pressBaseline = null;
async function waitSaves(ms = 3500) {
  const base = pressBaseline ?? saveStarted;
  pressBaseline = null;
  for (let i = 0; i < Math.ceil(ms / 200); i++) {
    await tab.waitForTimeout(200);
    if (saveStarted > base && saveDone >= saveStarted) return { requests: saveStarted - base, settled: true };
  }
  return { requests: saveStarted - base, settled: saveDone >= saveStarted };
}

/** The saved truth: read until the API gives the same answer twice in a row (parent/position/depth) */
async function readPersisted(p) {
  const saves = await waitSaves();
  let prev = null, rows = [];
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${BASE}/api/pages/${p.pageId}/blocks`, { headers: H }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    const raw = r.blocks ?? [];
    const byId = new Map(raw.map((b) => [b.id, b]));
    const depthOf = (b) => { let d = 0, q = b.parentBlockId; while (q && byId.has(q) && d < 40) { d++; q = byId.get(q).parentBlockId; } return d; };
    rows = raw.map((b) => ({
      id: b.id.slice(0, 8),
      key: p.key[b.id.slice(0, 8)] ?? "NEW",
      type: b.type,
      parentBlockId: b.parentBlockId ? b.parentBlockId.slice(0, 8) : null,
      parentKey: b.parentBlockId ? (p.key[b.parentBlockId.slice(0, 8)] ?? "NEW") : null,
      depth: depthOf(b),
      position: b.position,
      text: String(b.content?.text ?? "").replace(/\s+/g, " ").slice(0, 22),
    }));
    const snap = JSON.stringify(rows);
    if (snap === prev) return { rows, stable: true, saves };
    prev = snap;
    await tab.waitForTimeout(420);
  }
  return { rows, stable: false, saves };
}

/** A block's box — for computing marquee/text-drag coordinates (same method as deselect.check.mjs) */
const rect = (id) =>
  tab.evaluate((id) => {
    const b = document.querySelector(`[data-testid="block-${id}"]`);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const ce = b.querySelector("[contenteditable]") || b;
    const c = ce.getBoundingClientRect();
    return { x: c.left, y: c.top, w: c.width, h: c.height, bx: r.left, by: r.top, bw: r.width, bh: r.height };
  }, id);
const drag = async (x1, y1, x2, y2, steps = 10) => {
  await tab.mouse.move(x1, y1);
  await tab.mouse.down();
  for (let i = 1; i <= steps; i++) { await tab.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await tab.waitForTimeout(18); }
  await tab.waitForTimeout(90);
  await tab.mouse.up();
  await tab.waitForTimeout(320);
};
/** The halo (block selection) list */
const halos = () =>
  tab.evaluate(() =>
    [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')]
      .filter((r) => r.querySelector(':scope > div > [data-selected]'))
      .map((r) => r.getAttribute("data-testid").slice(6, 14))
  );

// ── Scenario runner ─────────────────────────────────────────────────────────
const results = {};
const failures = [];
async function scenario(key, why, fn) {
  if (ONLY.length && !ONLY.includes(key)) return;
  let out;
  try {
    out = { key, why, ...(await fn()) };
  } catch (e) {
    out = { key, why, error: String(e?.message ?? e) };
    failures.push(`${key}: ${String(e?.message ?? e)}`);
  }
  results[key] = out;
  console.log(JSON.stringify(out));
  return out;
}
/** What most scenarios do at the end: the screen + the saved tree */
const snapshot = async (p, extra = {}) => {
  const per = await readPersisted(p);
  return { pageId: p.pageId, ...extra, caretAfter: await caretNow(), dom: await domTree(), persisted: per.rows, persistStable: per.stable, saveRequests: per.saves.requests };
};
const press = async (k, n = 1, wait = 320) => {
  pressBaseline ??= saveStarted; // the moment of this scenario's first keystroke is the baseline for the save count
  for (let i = 0; i < n; i++) { await tab.keyboard.press(k); await tab.waitForTimeout(wait); }
};

const TYPES = ["paragraph", "heading1", "heading2", "heading3", "bulleted_list", "numbered_list", "todo", "toggle", "quote", "callout", "code", "divider"];

// ── T1~T3: does the caret position change the Tab result ────────────────────
// Notion indents the whole block regardless of the caret position. Split into three to confirm we
// don't behave differently only at offset 0 / only at the end.
for (const [key, where] of [["T1_tab_at_start", 0], ["T2_tab_mid", "mid"], ["T3_tab_end", "end"]]) {
  await scenario(key, `Tab with the caret at ${where} in a paragraph whose previous sibling is a paragraph`, async () => {
    const p = await build(key, [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBBBBBB" }]);
    const before = await caret(p.ids.B, where);
    await press("Tab");
    return snapshot(p, { caretBefore: before });
  });
}

// ── T4: the exact spot the user found annoying ──────────────────────────────
// B is indented under A and Enter at the end of B — the new block C must be at the same depth as B (Notion).
await scenario("T4_enter_after_indented", "Enter at the end of B indented under A — depth of the new block", async () => {
  const p = await build("T4", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBB", parent: "A" }, { k: "Z", type: "paragraph", text: "ZZZZ" }]);
  const before = await caret(p.ids.B, "end");
  await press("Enter");
  await tab.keyboard.type("CCC", { delay: 60 }); // type text so the new block can be identified
  await tab.waitForTimeout(300);
  return snapshot(p, { caretBefore: before });
});

// ── T5: Enter in an empty indented block ────────────────────────────────────
// In Notion, Enter in an empty list item/paragraph is used as outdent (or conversion to paragraph).
await scenario("T5_enter_empty_indented", "Enter in an empty B indented under A — outdent/stay/convert", async () => {
  const p = await build("T5", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "", parent: "A" }]);
  const before = await caret(p.ids.B, 0);
  await press("Enter");
  return snapshot(p, { caretBefore: before });
});
// the list version of the same question — empty list items have their own rule in Notion
await scenario("T5b_enter_empty_indented_list", "Enter in an empty bullet item indented under A", async () => {
  const p = await build("T5b", [{ k: "A", type: "bulleted_list", text: "AAAA" }, { k: "B", type: "bulleted_list", text: "", parent: "A" }]);
  const before = await caret(p.ids.B, 0);
  await press("Enter");
  return snapshot(p, { caretBefore: before });
});

// ── T6: Shift+Tab ───────────────────────────────────────────────────────────
// We need to see both where the outdented block lands in the sibling order (right after the parent, or at the end)
// and whether its children follow, so put one more D next to A ⊃ B ⊃ C.
await scenario("T6_shift_tab", "A ⊃ B ⊃ C, then top-level D. Shift+Tab in B", async () => {
  const p = await build("T6", [
    { k: "A", type: "paragraph", text: "AAAA" },
    { k: "B", type: "paragraph", text: "BBBB", parent: "A" },
    { k: "C", type: "paragraph", text: "CCCC", parent: "B" },
    { k: "D", type: "paragraph", text: "DDDD" },
  ]);
  const before = await caret(p.ids.B, "end");
  await press("Shift+Tab");
  return snapshot(p, { caretBefore: before });
});

// ── T7: Backspace at the very start of an indented block ────────────────────
// Notion first consumes one outdent, then merges with the previous block on the next Backspace.
await scenario("T7_backspace_at_start_indented", "Backspace at offset 0 of BBBB indented under A", async () => {
  const p = await build("T7", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBB", parent: "A" }]);
  const before = await caret(p.ids.B, 0);
  await press("Backspace");
  const first = await snapshot(p, { caretBefore: before });
  // only the second Backspace tells "outdent first" from "merge right away"
  const stillThere = await tab.$(`[data-testid="block-editable-${p.ids.B}"]`);
  let second = null;
  if (stillThere) { await caret(p.ids.B, 0); await press("Backspace"); second = await snapshot(p, {}); }
  return { ...first, secondBackspace: second };
});

// Control: Backspace at the start of a paragraph that is not indented. If T7 comes out as "nothing happens"
// we have to tell whether that is due to the indent, or whether Backspace at the start never merges anyway.
await scenario("T7b_backspace_at_start_flat", "control: Backspace at offset 0 of a non-indented BBBB", async () => {
  const p = await build("T7b", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBB" }]);
  const before = await caret(p.ids.B, 0);
  await press("Backspace");
  return snapshot(p, { caretBefore: before });
});

// ── T8: Tab on the first block of the page (no previous sibling) ────────────
await scenario("T8_tab_first_block", "Tab on the first block of the page — with no previous sibling", async () => {
  const p = await build("T8", [{ k: "F", type: "paragraph", text: "FIRST" }, { k: "G", type: "paragraph", text: "GGGG" }]);
  const before = await caret(p.ids.F, "end");
  await press("Tab");
  return snapshot(p, { caretBefore: before });
});

// ── T9: when the previous sibling is a heading ──────────────────────────────
// In Notion headings take children (indenting works even if it is not a toggle heading). Our code has
// a NO_CHILDREN list, so this is likely where we diverge — measure each of the three headings.
await scenario("T9_parent_is_heading", "Tab in a paragraph after heading1/2/3", async () => {
  const p = await build("T9", [
    { k: "H1", type: "heading1", text: "H1" }, { k: "P1", type: "paragraph", text: "under h1" },
    { k: "H2", type: "heading2", text: "H2" }, { k: "P2", type: "paragraph", text: "under h2" },
    { k: "H3", type: "heading3", text: "H3" }, { k: "P3", type: "paragraph", text: "under h3" },
  ]);
  const per = {};
  for (const [h, k] of [["heading1", "P1"], ["heading2", "P2"], ["heading3", "P3"]]) {
    await caret(p.ids[k], "end");
    await press("Tab");
    const row = (await domTree()).find((r) => r.id === p.ids[k].slice(0, 8));
    per[h] = { paragraph: k, domDepth: row?.domDepth ?? null, padLeft: row?.padLeft ?? null, ceLeft: row?.ceLeft ?? null };
  }
  return snapshot(p, { perHeading: per });
});

// ── T10: when the previous sibling is a divider / code / image ──────────────
await scenario("T10_parent_is_atomic", "Tab in a paragraph after divider·code·image", async () => {
  const p = await build("T10", [
    { k: "DV", type: "divider" }, { k: "PD", type: "paragraph", text: "after divider" },
    { k: "CD", type: "code", text: "print(1)" }, { k: "PC", type: "paragraph", text: "after code" },
    { k: "IM", type: "image" }, { k: "PI", type: "paragraph", text: "after image" },
  ]);
  const per = {};
  for (const [t, k] of [["divider", "PD"], ["code", "PC"], ["image", "PI"]]) {
    await caret(p.ids[k], "end");
    await press("Tab");
    const row = (await domTree()).find((r) => r.id === p.ids[k].slice(0, 8));
    per[t] = { paragraph: k, domDepth: row?.domDepth ?? null, padLeft: row?.padLeft ?? null };
  }
  return snapshot(p, { perPrevType: per });
});

// ── T11 / T12: indent/outdent a block that has children ─────────────────────
await scenario("T11_indent_with_children", "Tab on B that already has children (C,D) — do the children follow, keeping their relative depth", async () => {
  const p = await build("T11", [
    { k: "A", type: "paragraph", text: "AAAA" },
    { k: "B", type: "paragraph", text: "BBBB" },
    { k: "C", type: "paragraph", text: "CCCC", parent: "B" },
    { k: "D", type: "paragraph", text: "DDDD", parent: "B" },
  ]);
  const before = await caret(p.ids.B, "end");
  await press("Tab");
  return snapshot(p, { caretBefore: before });
});
await scenario("T12_outdent_with_children", "Shift+Tab on B with a child (C) — does the child stay under B", async () => {
  const p = await build("T12", [
    { k: "A", type: "paragraph", text: "AAAA" },
    { k: "B", type: "paragraph", text: "BBBB", parent: "A" },
    { k: "C", type: "paragraph", text: "CCCC", parent: "B" },
  ]);
  const before = await caret(p.ids.B, "end");
  await press("Shift+Tab");
  return snapshot(p, { caretBefore: before });
});

// ── T13: Enter at the end of a block with children ──────────────────────────
// Notion inserts the new block as the "first child" (when the block has children). And ours?
await scenario("T13_enter_end_with_children", "Enter at the end of A with child B — after the sibling, or first child", async () => {
  const p = await build("T13", [
    { k: "A", type: "paragraph", text: "AAAA" },
    { k: "B", type: "paragraph", text: "BBBB", parent: "A" },
    { k: "Z", type: "paragraph", text: "ZZZZ" },
  ]);
  const before = await caret(p.ids.A, "end");
  await press("Enter");
  await tab.keyboard.type("NEW", { delay: 60 });
  await tab.waitForTimeout(300);
  return snapshot(p, { caretBefore: before });
});

// ── T14: Enter in the middle of an indented block ───────────────────────────
await scenario("T14_split_mid_indented", "Enter in the middle of B (BBBBBBBB) indented under A — depth of the two pieces", async () => {
  const p = await build("T14", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBBBBBB", parent: "A" }]);
  const before = await caret(p.ids.B, "mid");
  await press("Enter");
  return snapshot(p, { caretBefore: before });
});

// ── T15: block (halo) multi-selection + Tab ─────────────────────────────────
// In selection mode with no caret, keys go to the window handler — whether Tab is handled there
// is the result as-is. Selection by marquee drag in the left margin (same method as deselect.check.mjs).
await scenario("T15_multiselect_tab", "Tab after selecting B·C as blocks (halo)", async () => {
  const p = await build("T15", [
    { k: "A", type: "paragraph", text: "AAAA" },
    { k: "B", type: "paragraph", text: "BBBB" },
    { k: "C", type: "paragraph", text: "CCCC" },
  ]);
  const rb = await rect(p.ids.B), rc = await rect(p.ids.C);
  await drag(rb.bx - 110, rb.by + 3, rb.bx + rb.bw / 2, rc.by + rc.bh - 4, 14);
  const before = await halos();
  await press("Tab");
  const after = await halos();
  return snapshot(p, { halosBefore: before, halosAfter: after, expectHalos: [p.ids.B.slice(0, 8), p.ids.C.slice(0, 8)] });
});

// ── T16: text selection across two blocks + Tab ─────────────────────────────
await scenario("T16_textsel_across_tab", "Tab with a text selection spanning B→C", async () => {
  const p = await build("T16", [
    { k: "A", type: "paragraph", text: "AAAA" },
    { k: "B", type: "paragraph", text: "BBBBBBBB" },
    { k: "C", type: "paragraph", text: "CCCCCCCC" },
  ]);
  const rb = await rect(p.ids.B), rc = await rect(p.ids.C);
  const line1 = (r) => r.y + Math.min(14, r.h / 2);
  await drag(rb.x + 20, line1(rb), rc.x + 60, line1(rc), 10);
  const before = await tab.evaluate(() => {
    const s = getSelection();
    const blk = (n) => n && ((n.nodeType === 3 ? n.parentElement : n)).closest?.("[data-block-type]")?.getAttribute("data-testid")?.slice(6, 14);
    return { text: s.toString().slice(0, 40), anchorBlock: blk(s.anchorNode), focusBlock: blk(s.focusNode), collapsed: s.isCollapsed };
  });
  await press("Tab");
  return snapshot(p, { selectionBefore: before });
});

// ── T17: px per depth level, and the maximum depth ──────────────────────────
// Build the staircase with Tab directly: also measures whether pressing Tab i times in Pi gives depth i.
await scenario("T17_depth_geometry", "stack a staircase with Tab to measure px per level and the cap", async () => {
  const N = 8;
  const seed = Array.from({ length: N }, (_, i) => ({ k: `P${i}`, type: "paragraph", text: `P${i}` }));
  const p = await build("T17", seed);
  for (let i = 1; i < N; i++) { await caret(p.ids[`P${i}`], "end"); await press("Tab", i, 220); }
  const stair = (await domTree()).map((r) => ({ text: r.text, domDepth: r.domDepth, padLeft: r.padLeft, ceLeft: r.ceLeft }));
  const byDepth = {};
  for (const r of stair) if (byDepth[r.domDepth] === undefined) byDepth[r.domDepth] = r.ceLeft;
  const stepPx = Object.keys(byDepth).sort((a, b) => a - b).slice(1).map((d) => +(byDepth[d] - byDepth[d - 1]).toFixed(1));
  // Cap: put a sibling at the end of an already deep chain and Tab there — the staircase end has no sibling
  // so it cannot go further down; the cap alone is checked this way.
  const D = 14;
  const chain = Array.from({ length: D }, (_, i) => ({ k: `L${i}`, type: "paragraph", text: `L${i}`, ...(i ? { parent: `L${i - 1}` } : {}) }));
  chain.push({ k: "S", type: "paragraph", text: "SIB", parent: `L${D - 2}` }); // sibling of L(D-1)
  const q = await build("T17-deep", chain);
  const beforeDeep = (await domTree()).find((r) => r.id === q.ids.S.slice(0, 8));
  await caret(q.ids.S, "end");
  await press("Tab", 3, 260); // once under L(D-1), after that there is no sibling so it must not move
  const afterDeep = (await domTree()).find((r) => r.id === q.ids.S.slice(0, 8));
  const deepPer = await readPersisted(q);
  return {
    ...(await (async () => ({ stairPage: p.pageId, stair, ceLeftByDepth: byDepth, stepPx }))()),
    tabsPressedPerBlock: "P1:1 … P7:7",
    maxDepthProbe: { seededChainDepth: D - 1, sibBefore: beforeDeep, sibAfterThreeTabs: afterDeep, persistedDeepest: Math.max(...deepPer.rows.map((r) => r.depth)), page: q.pageId },
    dom: stair,
    persisted: (await readPersisted(p)).rows,
  };
});

// ── T18: list markers per depth ─────────────────────────────────────────────
// In Notion the bullet glyph (• ◦ ▪) and numbering scheme (1. a. i.) change with depth.
// With a single item per depth the number always comes out "1." and says nothing about the scheme,
// so make two items per depth (the second item's label reveals the scheme).
await scenario("T18_list_markers", "bulleted·numbered list markers at depth 0~3 (two items per depth)", async () => {
  const TABS = [0, 0, 1, 1, 2, 2, 3, 3]; // Tabs to press on item i → depth 0,0,1,1,2,2,3,3
  const p = await build("T18", [
    ...Array.from({ length: 8 }, (_, i) => ({ k: `B${i}`, type: "bulleted_list", text: `bul ${i}` })),
    ...Array.from({ length: 8 }, (_, i) => ({ k: `N${i}`, type: "numbered_list", text: `num ${i}` })),
  ]);
  for (const pre of ["B", "N"])
    for (let i = 0; i < 8; i++) {
      if (!TABS[i]) continue;
      await caret(p.ids[`${pre}${i}`], "end");
      await press("Tab", TABS[i], 220);
    }
  const rows = await domTree();
  const pick = (pre) => rows.filter((r) => r.text.startsWith(pre)).map((r) => ({ depth: r.domDepth, marker: r.marker, ceLeft: r.ceLeft, text: r.text }));
  return snapshot(p, { bulleted: pick("bul"), numbered: pick("num") });
});

// ── T19 / T20: Tab inside containers (callout·toggle) ───────────────────────
// Callout/toggle children have depth reset to 0 in the render tree (block-row.tsx) —
// so domDepth alone is not enough; record the editable x too.
await scenario("T19_tab_inside_callout", "Tab in the second child paragraph inside a callout", async () => {
  const p = await build("T19", [
    { k: "CA", type: "callout", text: "callout" },
    { k: "c1", type: "paragraph", text: "inside one", parent: "CA" },
    { k: "c2", type: "paragraph", text: "inside two", parent: "CA" },
  ]);
  const beforeRow = (await domTree()).find((r) => r.id === p.ids.c2.slice(0, 8));
  const before = await caret(p.ids.c2, "end");
  await press("Tab");
  const firstChildTab = await (async () => { // the first child has no previous sibling — check it too
    await caret(p.ids.c1, "end"); await press("Tab");
    return (await domTree()).find((r) => r.id === p.ids.c1.slice(0, 8));
  })();
  return snapshot(p, { caretBefore: before, c2Before: beforeRow, c1AfterTab: firstChildTab });
});
await scenario("T20_tab_inside_toggle", "Tab in the second child paragraph inside an expanded toggle", async () => {
  const p = await build("T20", [
    { k: "TG", type: "toggle", text: "toggle" },
    { k: "t1", type: "paragraph", text: "inside one", parent: "TG" },
    { k: "t2", type: "paragraph", text: "inside two", parent: "TG" },
  ]);
  const beforeRow = (await domTree()).find((r) => r.id === p.ids.t2.slice(0, 8));
  const before = await caret(p.ids.t2, "end");
  await press("Tab");
  const firstChildTab = await (async () => {
    await caret(p.ids.t1, "end"); await press("Tab");
    return (await domTree()).find((r) => r.id === p.ids.t1.slice(0, 8));
  })();
  return snapshot(p, { caretBefore: before, t2Before: beforeRow, t1AfterTab: firstChildTab });
});

// ── T21: per type, "can it be indented under a paragraph" ───────────────────
// Lay out [paragraph host, target type] pairs on one page and press Tab only on the target.
// A divider has no editable so the caret cannot be placed — select it with a 6-dot click (halo) and Tab.
await scenario("T21_can_indent_type", "Tab each type's block under the preceding paragraph", async () => {
  const seed = [];
  for (const t of TYPES) { seed.push({ k: `h_${t}`, type: "paragraph", text: `host ${t}` }); seed.push({ k: `x_${t}`, type: t, text: `x ${t}` }); }
  const p = await build("T21", seed);
  const per = {};
  for (const t of TYPES) {
    const id = p.ids[`x_${t}`];
    const c = await caret(id, "end");
    let drivenBy = "caret";
    if (!c.placed) { // types without an editable: select the block by clicking the 6-dot handle, then Tab
      drivenBy = "halo";
      await tab.locator(`[data-testid="block-${id}"]`).hover({ position: { x: 80, y: 6 } }).catch(() => {});
      await tab.waitForTimeout(120);
      await tab.locator(`[data-testid="block-handle-${id}"]`).click({ timeout: 3000 }).catch(() => {});
      await tab.waitForTimeout(200);
    }
    const textBefore = (await domTree()).find((r) => r.id === id.slice(0, 8))?.text ?? null;
    const halosAtPress = drivenBy === "halo" ? await halos() : null;
    await press("Tab");
    await tab.keyboard.press("Escape").catch(() => {});
    await tab.waitForTimeout(150);
    const row = (await domTree()).find((r) => r.id === id.slice(0, 8));
    per[t] = { drivenBy, caret: c, halosAtPress, domDepth: row?.domDepth ?? null, padLeft: row?.padLeft ?? null, ceLeft: row?.ceLeft ?? null, textBefore, textAfter: row?.text ?? null };
  }
  const pers = await readPersisted(p);
  for (const t of TYPES) {
    const r = pers.rows.find((r) => r.id === p.ids[`x_${t}`].slice(0, 8));
    per[t].persistedParentKey = r?.parentKey ?? null;
    per[t].persistedParentBlockId = r?.parentBlockId ?? null;
    per[t].persistedDepth = r?.depth ?? null;
    per[t].indented = r?.parentKey === `h_${t}`;
  }
  return { pageId: p.pageId, perType: per, persistStable: pers.stable, saveRequests: pers.saves.requests };
});

// ── T22: per type, "can it take children" ───────────────────────────────────
// [target type X, paragraph P] pairs. Press Tab in P and see whether it goes under X.
await scenario("T22_can_accept_children", "Tab in the paragraph after each type — does that type take children", async () => {
  const seed = [];
  for (const t of TYPES) { seed.push({ k: `x_${t}`, type: t, text: `x ${t}` }); seed.push({ k: `p_${t}`, type: "paragraph", text: `child of ${t}` }); }
  const p = await build("T22", seed);
  const per = {};
  for (const t of TYPES) {
    const id = p.ids[`p_${t}`];
    const c = await caret(id, "end");
    await press("Tab");
    const row = (await domTree()).find((r) => r.id === id.slice(0, 8));
    per[t] = { caretPlaced: c.placed, domDepth: row?.domDepth ?? null, padLeft: row?.padLeft ?? null, ceLeft: row?.ceLeft ?? null };
  }
  const pers = await readPersisted(p);
  for (const t of TYPES) {
    const r = pers.rows.find((r) => r.id === p.ids[`p_${t}`].slice(0, 8));
    per[t].persistedParentKey = r?.parentKey ?? null;
    per[t].persistedDepth = r?.depth ?? null;
    per[t].accepted = r?.parentKey === `x_${t}`;
  }
  return { pageId: p.pageId, perType: per, persistStable: pers.stable, saveRequests: pers.saves.requests };
});

// ── Cleanup ─────────────────────────────────────────────────────────────────
await browser.close();
const archived = [];
for (const id of createdPages) {
  const r = await fetch(`${BASE}/api/pages/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch((e) => ({ ok: false, status: String(e) }));
  archived.push({ id, ok: !!r.ok, status: r.status ?? null });
  if (!r.ok) failures.push(`archive failed for page ${id} (${r.status})`);
}
const summary = { pagesCreated: createdPages.length, archived, pageErrors, failures };
console.log(JSON.stringify({ key: "_summary", ...summary }));
fs.writeFileSync(OUT, JSON.stringify({ results, summary }, null, 1));
console.log(`\n→ ${OUT.pathname}  (${Object.keys(results).length} scenarios, ${failures.length} failures)`);
