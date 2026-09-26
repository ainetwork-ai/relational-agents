// Indentation (nesting) parity — does our app behave the same as the original.
//
// Every expected value was measured directly on app.notion.com on 2026-09-10, and the scenario names
// match the table in docs/notion-indent.md (raw data: scratchpad/nind-*.jsonl).
// The evidence for "fixed" is this script's exit 0.
//
//   [BASE_URL=http://localhost:3110] [ONLY=enter_with_children,shift_tab_middle]
//   node e2e/indent.check.mjs
//
// Why look at the DOM and the save together: "indented on screen but not saved" is a real
// possible state (the editor saves separately through a transaction queue). So after a keypress we look at the DOM tree
// and at the parentBlockId·position from GET /api/pages/<id>/blocks together.
//
// A new page per scenario, all archived at the end (dev data is disposable).
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj
const ONLY = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}`, "content-type": "application/json" };
const uuid = () => crypto.randomUUID();

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

const contentOf = (type, text) =>
  type === "todo" ? { text, checked: false }
  : type === "toggle" ? { text, expanded: true }
  : type === "code" ? { text: text || "code()", language: "plain" }
  : type === "callout" ? { text, icon: "💡" }
  : type === "divider" ? {}
  : { text };

const createdPages = [];
/** seed: [{ k, type?, text?, parent? }] — parent is an earlier k */
async function build(name, seed) {
  const res = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: `indent.check ${name}` }) }).then((r) => r.json());
  const pageId = res.page?.id ?? res.id;
  if (!pageId) throw new Error(`page create failed: ${JSON.stringify(res).slice(0, 160)}`);
  createdPages.push(pageId);
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
    return { id, type: s.type ?? "paragraph", content: { ...contentOf(s.type ?? "paragraph", s.text ?? s.k), ...(s.content ?? {}) }, parentBlockId, position };
  });
  const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { method: "PUT", headers: H, body: JSON.stringify({ blocks, deletedIds: stale, newIds: blocks.map((b) => b.id) }) });
  if (!put.ok) throw new Error(`seed failed ${put.status}`);
  const key = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v.slice(0, 8), k]));
  const p = { pageId, ids, key, name };
  await open(p);
  return p;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const tab = await ctx.newPage();
const pageErrors = [];
tab.on("pageerror", (e) => pageErrors.push(String(e)));

async function open(p) {
  await tab.goto(`${BASE}/p/${p.pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await tab.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 90_000 });
  await tab.waitForTimeout(600);
}

/** Place the caret — exactly, with a Range, so line wrapping does not shake it */
const caret = (id, where) =>
  tab.evaluate(([id, where]) => {
    const el = document.querySelector(`[data-testid="block-editable-${id}"]`);
    if (!el) return { placed: false };
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
    return { placed: document.activeElement === el, offset: off, len };
  }, [id, where]);

/** Place the caret, but **after the text is in the DOM**. Placing it while the block is still empty
 *  makes `where: "end"` offset 0 (there are no child nodes) and the scenario measures the wrong thing
 *  entirely — e.g. Enter splits at the very start and leaves an empty line in front. */
const caretReady = async (id, where, minLen = 1) => {
  let c = await caret(id, where);
  for (let k = 0; k < 15 && (!c.placed || (c.len ?? 0) < minLen); k++) {
    await tab.waitForTimeout(200);
    c = await caret(id, where);
  }
  return c;
};

const caretNow = () =>
  tab.evaluate(() => {
    const s = getSelection();
    if (!s || !s.rangeCount) return { none: true };
    const n = s.anchorNode;
    const el = n && (n.nodeType === 3 ? n.parentElement : n);
    const host = el?.closest?.("[contenteditable]");
    let off = s.anchorOffset;
    if (host) {
      const r = document.createRange();
      r.selectNodeContents(host);
      r.setEnd(s.anchorNode, s.anchorOffset);
      off = r.toString().length;
    }
    return {
      block: el?.closest?.("[data-block-type]")?.getAttribute("data-testid")?.slice(6, 14) ?? null,
      offset: off,
      selLen: s.toString().length,
      inEditable: !!document.activeElement?.isContentEditable,
    };
  });

/** The on-screen tree: depth·indent px·marker·text */
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
      return {
        id: id.slice(0, 8),
        type: row.getAttribute("data-block-type"),
        depth,
        padLeft: row.firstElementChild ? parseFloat(getComputedStyle(row.firstElementChild).paddingLeft) : null,
        selected: !!own(row, "[data-selected]"),
        text: (ce?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 22),
      };
    });
  });

/** The saved raw blocks as-is (for checks that need to look at content) */
async function blocksOf(p) {
  const r = await fetch(`${BASE}/api/pages/${p.pageId}/blocks`, { headers: H }).then((x) => x.json()).catch(() => ({}));
  return r.blocks ?? [];
}

/** The saved truth — until the same answer comes twice in a row.
 *  But **the first two do not count even if equal**: saves go out in 500ms batches, so while the
 *  transaction of the key just pressed is still queued, the "previous state" reads the same twice in a row (halo_tab
 *  read the indented tree from before Shift+Tab as the save result and failed). */
async function persisted(p) {
  let prev = null, rows = [];
  for (let i = 0; i < 20; i++) {
    await tab.waitForTimeout(400);
    const r = await fetch(`${BASE}/api/pages/${p.pageId}/blocks`, { headers: H }).then((x) => x.json()).catch(() => ({}));
    const raw = r.blocks ?? [];
    const byId = new Map(raw.map((b) => [b.id, b]));
    const depthOf = (b) => { let d = 0, q = b.parentBlockId; while (q && byId.has(q) && d < 40) { d++; q = byId.get(q).parentBlockId; } return d; };
    rows = raw.map((b) => ({
      id: b.id.slice(0, 8),
      key: p.key[b.id.slice(0, 8)] ?? "NEW",
      type: b.type,
      parentKey: b.parentBlockId ? (p.key[b.parentBlockId.slice(0, 8)] ?? "NEW") : null,
      depth: depthOf(b),
      position: b.position,
      text: String(b.content?.text ?? "").replace(/\s+/g, " ").slice(0, 22),
    }));
    const snap = JSON.stringify(rows);
    if (snap === prev && i >= 2) return rows;
    prev = snap;
  }
  return rows;
}

/** The on-screen shape as one line — "A@0 B@1" (the text if any, otherwise the type) */
const shape = (tree) => tree.map((b) => `${b.text || b.type}@${b.depth}`).join(" ");
/** The saved tree in document order — position is 1..n only within a sibling list, so
 *  the order the API gives (a flat sort) mixes parents and children */
const pshape = (rows) => {
  const kids = new Map();
  for (const r of rows) {
    const k = r.parentKey ?? null;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(r);
  }
  for (const list of kids.values()) list.sort((a, b) => a.position - b.position);
  const out = [];
  const walk = (parent) => {
    for (const r of kids.get(parent) ?? []) {
      out.push(`${r.text || r.type}@${r.depth}`);
      walk(r.key);
    }
  };
  walk(null);
  return out.join(" ");
};
const dump = (tree) => tree.map((b) => `${b.type}@d${b.depth} pad${b.padLeft} ${JSON.stringify(b.text)}`).join(" | ");

const scenarios = {};
const scenario = (name, fn) => { scenarios[name] = fn; };

// ── 1. Tab indents the block regardless of the caret position, and the caret stays put ──
scenario("tab_caret", async () => {
  const p = await build("tab_caret", [{ k: "A" }, { k: "B", text: "BBBBBB" }]);
  const before = await caret(p.ids.B, 3);
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(400);
  const t = await domTree();
  const c = await caretNow();
  check("Tab: the block goes in one level", shape(t) === "A@0 BBBBBB@1", dump(t));
  check("Tab: the caret stays on the same character", c.offset === before.offset && c.inEditable, `ours ${c.offset} / Notion ${before.offset}`);
  const rows = await persisted(p);
  check("Tab: the parent is saved too", rows.find((r) => r.key === "B")?.parentKey === "A", JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

// ── 2. Enter after indenting — the same depth continues below ────────────────
scenario("enter_keeps_depth", async () => {
  const p = await build("enter_keeps_depth", [{ k: "A" }, { k: "B" }]);
  await caret(p.ids.B, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(300);
  await tab.keyboard.press("Enter");
  await tab.keyboard.type("C", { delay: 40 });
  await tab.keyboard.press("Enter");
  await tab.keyboard.type("D", { delay: 40 });
  await tab.waitForTimeout(400);
  const t = await domTree();
  check("Enter: below an indented block stays at the same depth", shape(t) === "A@0 B@1 C@1 D@1", dump(t));
  const rows = await persisted(p);
  check("Enter: saved with the same parent too", pshape(rows) === "A@0 B@1 C@1 D@1", pshape(rows));
});

// ── 3. Enter in an indented empty paragraph — does not outdent (same as the original) ──
scenario("enter_empty_paragraph", async () => {
  const p = await build("enter_empty_paragraph", [{ k: "A" }, { k: "B" }]);
  await caret(p.ids.B, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(250);
  await tab.keyboard.press("Enter");
  await tab.waitForTimeout(250);
  await tab.keyboard.press("Enter");
  await tab.waitForTimeout(400);
  const t = await domTree();
  check("empty paragraph Enter: one more empty line at the same depth", shape(t) === "A@0 B@1 paragraph@1 paragraph@1", dump(t));
});

// ── 4. Enter in an indented empty list item — goes out one level and stays a list ──
scenario("enter_empty_list", async () => {
  const p = await build("enter_empty_list", [
    { k: "A", type: "bulleted_list", text: "a" },
    { k: "B", type: "bulleted_list", text: "b" },
  ]);
  await caret(p.ids.B, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(250);
  await tab.keyboard.press("Enter"); // an empty item at the same depth
  await tab.waitForTimeout(300);
  const mid = await domTree();
  check("an empty item appears at the same depth", shape(mid) === "a@0 b@1 bulleted_list@1", dump(mid));
  await tab.keyboard.press("Enter"); // empty item → out one level
  await tab.waitForTimeout(400);
  const t = await domTree();
  const empty = t.find((b) => b.text === "");
  check("empty item Enter: goes out one level", empty?.depth === 0, dump(t));
  check("empty item Enter: stays a list", empty?.type === "bulleted_list", empty?.type ?? "?");
});

// ── 5. Enter at the end of a block with children — new block right below, children go to the new block ──
scenario("enter_with_children", async () => {
  const p = await build("enter_with_children", [{ k: "A" }, { k: "K", parent: "A" }, { k: "Z" }]);
  await caret(p.ids.A, "end");
  await tab.keyboard.press("Enter");
  await tab.keyboard.type("X", { delay: 40 });
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("Enter on a block with children: new line right below, children under it", shape(t) === "A@0 X@0 K@1 Z@0", dump(t));
  const rows = await persisted(p);
  const k = rows.find((r) => r.key === "K");
  check("the children's parent is saved as the new block", k?.parentKey === "NEW", JSON.stringify(rows.map((r) => [r.key, r.parentKey])));
});

// ── 6. A split in the middle also sends the children to the back piece (the new block) ──
scenario("split_with_children", async () => {
  const p = await build("split_with_children", [{ k: "A", text: "AAAA" }, { k: "K", parent: "A" }]);
  await caret(p.ids.A, "mid");
  await tab.keyboard.press("Enter");
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("split in the middle: front·back at the same depth, children with the back", shape(t) === "AA@0 AA@0 K@1", dump(t));
});

// ── 7~9. Shift+Tab ─────────────────────────────────────────────────────────
scenario("shift_tab_leaf", async () => {
  const p = await build("shift_tab_leaf", [{ k: "A" }, { k: "B", parent: "A" }, { k: "C", parent: "B" }]);
  const before = await caret(p.ids.C, 1);
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(450);
  const t = await domTree();
  const c = await caretNow();
  check("Shift+Tab: goes out only one level and lands right after the parent", shape(t) === "A@0 B@1 C@1", dump(t));
  check("Shift+Tab: the caret stays on the same character", c.offset === before.offset, `ours ${c.offset} / Notion ${before.offset}`);
  const rows = await persisted(p);
  const positions = rows.filter((r) => r.parentKey === "A").map((r) => r.position);
  check("Shift+Tab: sibling positions do not collide", new Set(positions).size === positions.length, JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

scenario("shift_tab_middle_adopts", async () => {
  const p = await build("shift_tab_middle_adopts", [
    { k: "A" }, { k: "B1", parent: "A" }, { k: "B2", parent: "A" }, { k: "B3", parent: "A" },
  ]);
  await caret(p.ids.B2, "end");
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(500);
  const t = await domTree();
 // original (T6b): A > B1, and B2 comes out next to A taking B3 along as its child
  check("Shift+Tab (middle child): takes the siblings below as children", shape(t) === "A@0 B1@1 B2@0 B3@1", dump(t));
  const rows = await persisted(p);
  check("saved as the same tree too", rows.find((r) => r.key === "B3")?.parentKey === "B2", JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

scenario("shift_tab_with_children", async () => {
  const p = await build("shift_tab_with_children", [{ k: "A" }, { k: "B", parent: "A" }, { k: "C", parent: "B" }]);
  await caret(p.ids.B, "end");
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("Shift+Tab (with children): the children stay below", shape(t) === "A@0 B@0 C@1", dump(t));
  const rows = await persisted(p);
  const tops = rows.filter((r) => r.parentKey === null).map((r) => r.position);
  check("top-level positions do not collide", new Set(tops).size === tops.length, JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

// ── 10~12. Backspace at the very start ─────────────────────────────────────
scenario("backspace_indented_paragraph", async () => {
  const p = await build("backspace_indented_paragraph", [{ k: "A" }, { k: "B", parent: "A" }]);
  await caret(p.ids.B, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  const t1 = await domTree();
  check("Backspace at the start of an indented paragraph: first goes out one level", shape(t1) === "A@0 B@0", dump(t1));
  await caret(p.ids.B, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  const t2 = await domTree();
  check("at depth 0 it merges with the block above", shape(t2) === "AB@0", dump(t2));
});

scenario("backspace_indented_list", async () => {
  const p = await build("backspace_indented_list", [
    { k: "A", type: "bulleted_list", text: "a" },
    { k: "B", type: "bulleted_list", text: "bb", parent: "A" },
  ]);
  await caret(p.ids.B, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  const t1 = await domTree();
  const b1 = t1.find((x) => x.text === "bb");
  check("Backspace at the start of an indented list: first only the bullet drops", b1?.type === "paragraph" && b1?.depth === 1, dump(t1));
  await caret(p.ids.B, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  const t2 = await domTree();
  check("then goes out one level", t2.find((x) => x.text === "bb")?.depth === 0, dump(t2));
});

scenario("backspace_lifts_children", async () => {
  const p = await build("backspace_lifts_children", [{ k: "A" }, { k: "B" }, { k: "K", parent: "B" }, { k: "Z" }]);
  await caret(p.ids.B, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(500);
  const t = await domTree();
 // original (T28): merges into 'AB' and K rises to the top level, right after it
  check("children do not vanish on merge", shape(t) === "AB@0 K@0 Z@0", dump(t));
  const rows = await persisted(p);
  check("children are not left as orphans (invisible blocks)", rows.every((r) => r.parentKey === null), JSON.stringify(rows.map((r) => [r.key, r.parentKey])));
});

// ── 13. Rejected Tabs ───────────────────────────────────────────────────────
scenario("tab_refused", async () => {
  const p = await build("tab_refused", [
    { k: "A" }, { k: "B", parent: "A" },
    { k: "H", type: "heading2", text: "H" }, { k: "PH" },
    { k: "D", type: "divider" }, { k: "PD" },
    { k: "CD", type: "code", text: "x" }, { k: "PC" },
  ]);
  const first = await domTree();
  await caret(p.ids.A, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(300);
  check("Tab on the first block: nothing happens", shape(await domTree()) === shape(first), dump(await domTree()));
  await caret(p.ids.B, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(300);
  check("Tab on the first child: nothing happens", (await domTree()).find((x) => x.text === "B")?.depth === 1);
  for (const [who, label] of [["PH", "a heading"], ["PD", "a divider"], ["PC", "code"]]) {
    await caret(p.ids[who], "end");
    await tab.keyboard.press("Tab");
    await tab.waitForTimeout(300);
    check(`no indent when the previous sibling is ${label}`, (await domTree()).find((x) => x.text === who)?.depth === 0, dump(await domTree()));
  }
});

// ── 14. Tab in a code block is a tab character ─────────────────────────────
scenario("code_tab_inserts_tab", async () => {
  const p = await build("code_tab_inserts_tab", [{ k: "X" }, { k: "C", type: "code", text: "ab" }]);
  await caret(p.ids.C, 0);
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(450);
  const t = await domTree();
  const code = t.find((b) => b.type === "code");
  check("Tab in code: the block stays", code?.depth === 0, dump(t));
  const text = await tab.evaluate((id) => document.querySelector(`[data-testid="block-editable-${id}"]`)?.innerText ?? "", p.ids.C);
  check("Tab in code: a tab character is inserted", text.includes("\t"), JSON.stringify(text.slice(0, 12)));
});

// ── 15. Tab / Shift+Tab with a block (halo) selection — keeps the selection ──
scenario("halo_tab", async () => {
  const p = await build("halo_tab", [{ k: "H0" }, { k: "H1" }, { k: "H2" }]);
  await caret(p.ids.H1, "end");
  await tab.keyboard.press("Escape");
  await tab.waitForTimeout(200);
  await tab.keyboard.press("Shift+ArrowDown");
  await tab.waitForTimeout(250);
  const sel = (await domTree()).filter((b) => b.selected).map((b) => b.text);
  check("two blocks are selected", sel.join(",") === "H1,H2", JSON.stringify(sel));
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("block selection Tab: every selected block goes in one level", shape(t) === "H0@0 H1@1 H2@1", dump(t));
  check("block selection Tab: the selection is kept", t.filter((b) => b.selected).length === 2, JSON.stringify(t.filter((b) => b.selected).map((b) => b.text)));
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(500);
  const t2 = await domTree();
  check("block selection Shift+Tab: all come out one level", shape(t2) === "H0@0 H1@0 H2@0", dump(t2));
  const rows = await persisted(p);
  check("the save returns to top level too", rows.every((r) => r.parentKey === null), JSON.stringify(rows.map((r) => [r.key, r.parentKey])));
});

// ── 16. Text selection across two blocks + Tab — both, and the selection is kept ──
scenario("textsel_tab", async () => {
  const p = await build("textsel_tab", [{ k: "P0" }, { k: "P1" }, { k: "P2" }]);
 // build the range after both blocks' text is in the DOM — building it while there are no child nodes
 // makes `setEnd(el, 1)` die with IndexSizeError and the whole scenario fails
  await tab.waitForFunction(
    ([a, b]) =>
      [a, b].every((id) => {
        const el = document.querySelector(`[data-testid="block-editable-${id}"]`);
        return el && (el.textContent ?? "").length > 0;
      }),
    [p.ids.P1, p.ids.P2],
    { timeout: 20_000 }
  );
  await tab.evaluate(([a, b]) => {
    const ea = document.querySelector(`[data-testid="block-editable-${a}"]`);
    const eb = document.querySelector(`[data-testid="block-editable-${b}"]`);
    ea.focus();
    const r = document.createRange();
    r.setStart(ea.firstChild ?? ea, 0);
    r.setEnd(eb.firstChild ?? eb, 1);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, [p.ids.P1, p.ids.P2]);
  const before = await caretNow();
  check("a selection spanning two blocks was made", before.selLen > 0, JSON.stringify(before));
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(600);
  const t = await domTree();
  check("text selection Tab: every spanned block goes in", shape(t) === "P0@0 P1@1 P2@1", dump(t));
  const after = await caretNow();
  check("text selection Tab: the selection remains", after.selLen === before.selLen, `ours ${after.selLen} / Notion ${before.selLen}`);
});

// ── 17. Survives a reload ──────────────────────────────────────────────────
scenario("survives_reload", async () => {
  const p = await build("survives_reload", [{ k: "A" }, { k: "B" }, { k: "C" }]);
  await caret(p.ids.B, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(300);
  await caret(p.ids.C, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(300);
  const beforeShape = shape(await domTree());
  await persisted(p);
  await open(p);
  const t = await domTree();
  check("the same tree after a reload", shape(t) === beforeShape && shape(t) === "A@0 B@1 C@1", `${shape(t)} / before save ${beforeShape}`);
});

// ── 18. Geometry and markers — how far each depth goes in and how the marker changes ──
scenario("geometry_and_markers", async () => {
  const chain = (type, n, prefix) =>
    Array.from({ length: n }, (_, i) => ({ k: `${prefix}${i}`, type, parent: i ? `${prefix}${i - 1}` : undefined }));
  const boxes = () =>
    tab.evaluate(() => {
      const root = document.querySelector('[data-testid="editor-root"]');
      const own = (row, sel) => [...row.querySelectorAll(sel)].find((e) => e.closest("[data-block-type]") === row) ?? null;
      return [...root.querySelectorAll("[data-block-type]")].map((row) => {
        let d = 0;
        for (let q = row.parentElement; q && q !== root; q = q.parentElement) if (q.matches("[data-block-type]")) d++;
        const ce = own(row, "[contenteditable]");
        const box = row.firstElementChild;
        const marker = ce?.previousElementSibling?.tagName === "SPAN" ? (ce.previousElementSibling.textContent ?? "").trim() : null;
        return {
          type: row.getAttribute("data-block-type"), d,
          padL: box ? parseFloat(getComputedStyle(box).paddingLeft) : null,
          absL: box ? +(box.getBoundingClientRect().left + parseFloat(getComputedStyle(box).paddingLeft)).toFixed(1) : null,
          marker,
        };
      });
    });

 // paragraph chain — 30px per level (original 366→396→426…)
  await build("geo_paragraph", chain("paragraph", 4, "P"));
  let r = await boxes();
  check("paragraph under paragraph: 30px per level", r.map((x) => x.padL).join(",") === "0,30,60,90", JSON.stringify(r.map((x) => x.padL)));

 // bullet chain — 32px per level, markers • ◦ ▪ •
  await build("geo_bullet", chain("bulleted_list", 4, "B"));
  r = await boxes();
  check("bullet under bullet: 32px per level", r.map((x) => x.padL).join(",") === "0,32,64,96", JSON.stringify(r.map((x) => x.padL)));
  check("bullet markers change with depth (•◦▪•)", r.map((x) => x.marker).join("") === "•◦▪•", JSON.stringify(r.map((x) => x.marker)));

 // numbered chain — markers 1. a. i. 1.
  await build("geo_number", chain("numbered_list", 4, "N"));
  r = await boxes();
  check("number markers change with depth (1. a. i. 1.)", r.map((x) => x.marker).join(" ") === "1. a. i. 1.", JSON.stringify(r.map((x) => x.marker)));

 // a bullet under a paragraph is still • (the cycle counts ancestors of the same list kind — T21)
  await build("geo_bullet_under_paragraph", [{ k: "P" }, { k: "B", type: "bulleted_list", parent: "P" }]);
  r = await boxes();
  check("bullet marker under a paragraph is •", r[1].marker === "•", JSON.stringify(r.map((x) => [x.type, x.marker, x.padL])));
  check("a bullet under a paragraph is also 30px per level", r[1].padL === 30, JSON.stringify(r.map((x) => x.padL)));

 // a toggle child sits at the same x as the toggle text = 32px from the box, below that 30px again
  await build("geo_toggle", [{ k: "T", type: "toggle" }, { k: "C1", parent: "T" }, { k: "C2", parent: "C1" }]);
  r = await boxes();
  const d = (i) => +(r[i].absL - r[0].absL).toFixed(1);
  check("toggle child: 32px from the box", d(1) === 32, `${d(1)} (expected 32)`);
  check("toggle grandchild: another 30px from there", d(2) === 62, `${d(2)} (expected 62)`);
});

// ── 19. Backspace-at-start policy — the same order as the original ──────────
scenario("backspace_policy", async () => {
 // (a) a heading merges with the block above **in one go** without shedding its style (A_heading*)
  let p = await build("bs_heading", [{ k: "P", text: "PREV" }, { k: "H", type: "heading2", text: "XX" }]);
  await caret(p.ids.H, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  check("Backspace at the start of a heading: merges in one go", shape(await domTree()) === "PREVXX@0", dump(await domTree()));

 // (b) quote·bullet·number·todo·toggle first shed only the style (A_quote / A_bulleted_list …)
  for (const [type, label] of [["quote", "quote"], ["bulleted_list", "bullet"], ["numbered_list", "number"], ["todo", "todo"], ["toggle", "toggle"]]) {
    p = await build(`bs_${type}`, [{ k: "P", text: "PREV" }, { k: "B", type, text: "XX" }]);
    await caret(p.ids.B, 0);
    await tab.keyboard.press("Backspace");
    await tab.waitForTimeout(400);
    const t1 = await domTree();
    check(`${label} Backspace at start: first sheds only the style`, shape(t1) === "PREV@0 XX@0" && t1[1].type === "paragraph", dump(t1));
    await caret(p.ids.B, 0);
    await tab.keyboard.press("Backspace");
    await tab.waitForTimeout(400);
    check(`${label}: then merges`, shape(await domTree()) === "PREVXX@0", dump(await domTree()));
  }

 // (c) a code block: nothing happens (A_codetext)
  p = await build("bs_code", [{ k: "P", text: "PREV" }, { k: "C", type: "code", text: "QQ" }]);
  await caret(p.ids.C, 0);
 // a snapshot taken before the code block's body is drawn gives shape "code" (the type) and
 // before/after Backspace look different — wait until the body is visible
  let beforeCode = shape(await domTree());
  for (let k = 0; k < 10 && !beforeCode.includes("QQ"); k++) {
    await tab.waitForTimeout(200);
    beforeCode = shape(await domTree());
  }
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(400);
  check("Backspace at the start of code: nothing happens", shape(await domTree()) === beforeCode, dump(await domTree()));

 // (d) on the page's first block the text goes **into the title** (B_*: the block vanishes and the title grows)
  p = await build("bs_title", [{ k: "A", text: "ZZTOP" }, { k: "B", text: "keep" }]);
  const titleBefore = await tab.inputValue('[data-testid="page-title"]');
  await caret(p.ids.A, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(600);
  const t = await domTree();
  check("Backspace at the start of the first block: the block vanishes", shape(t) === "keep@0", dump(t));
  check("Backspace at the start of the first block: the text joins the title",
    (await tab.inputValue('[data-testid="page-title"]')) === titleBefore + "ZZTOP",
    `"${await tab.inputValue('[data-testid="page-title"]')}" (before "${titleBefore}")`);
  const rows = await persisted(p);
  check("the title merge is saved", rows.length === 1 && rows[0].key === "B", JSON.stringify(rows.map((r) => [r.key, r.text])));

 // (e) one ⌘Z restores the title and the block together (original M4 measurement)
  await tab.keyboard.press("Control+z");
  await tab.waitForTimeout(600);
  check("⌘Z: the block comes back", shape(await domTree()) === "ZZTOP@0 keep@0", dump(await domTree()));
  check("⌘Z: the title comes back with it",
    (await tab.inputValue('[data-testid="page-title"]')) === titleBefore,
    `"${await tab.inputValue('[data-testid="page-title"]')}" (expected "${titleBefore}")`);
});

// ── 20. The remaining Backspace-at-start cases ─────────────────────────────
scenario("backspace_edges", async () => {
 // a toggle's first child folds into the toggle title rather than outdenting (2026-08-26 toggle/enter_backspace)
  let p = await build("bs_toggle_kid", [
    { k: "T", type: "toggle", text: "TT" },
    { k: "K", parent: "T", text: "KK" },
  ]);
  await caret(p.ids.K, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  check("Backspace on a toggle's first child: folds into the title", shape(await domTree()) === "TTKK@0", dump(await domTree()));

 // an empty first block has nothing to move into the title — nothing should happen
  p = await build("bs_empty_first", [{ k: "A", text: "" }, { k: "B", text: "keep" }]);
  const titleBefore = await tab.inputValue('[data-testid="page-title"]');
  await caret(p.ids.A, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  check("empty first block: the title is unchanged", (await tab.inputValue('[data-testid="page-title"]')) === titleBefore,
    `"${await tab.inputValue('[data-testid="page-title"]')}"`);

 // if the first block has children, they move up into its place (the very start)
  p = await build("bs_first_kids", [{ k: "A", text: "AA" }, { k: "K", parent: "A", text: "KK" }, { k: "Z", text: "ZZ" }]);
  await caret(p.ids.A, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(600);
  check("the first block's children move up into its place", shape(await domTree()) === "KK@0 ZZ@0", dump(await domTree()));
});

// ── Collapsed toggles — 2026-09-10 round 3 measurements (scratchpad/nind-M7·M8·M10.jsonl) ──
// Four things measured on the original:
//  M7 S2  Tab when the previous sibling is a collapsed toggle → the toggle **expands** and it becomes the last child
//  M7 S1  Enter at the end of a collapsed toggle title → a **sibling toggle** appears and the hidden children stay
//  M10 D1 Enter in the middle of a collapsed toggle title → the toggle splits in two and the children stay with the **front**
//  M7 S3  Shift+Tab on a type that cannot take children (heading) → does **not take** the following siblings
//  M8 S5  Shift+Tab on a collapsed toggle → **takes** the following siblings (not visible, being collapsed)
scenario("tab_into_folded_toggle", async () => {
  const p = await build("tab_into_folded_toggle", [
    { k: "TG", type: "toggle", text: "TG", content: { expanded: false } },
    { k: "K", parent: "TG", text: "KK" },
    { k: "X", text: "XX" },
  ]);
  await caret(p.ids.X, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(550);
  const t = await domTree();
  check("Tab into a collapsed toggle: the toggle expands and it becomes the last child", shape(t) === "TG@0 KK@1 XX@1", dump(t));
  const c = await caretNow();
  check("Tab into a collapsed toggle: the caret survives", c && !c.none && c.offset === 2, JSON.stringify(c));
  const rows = await persisted(p);
  check("saved as the same tree too", pshape(rows) === "TG@0 KK@1 XX@1", JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
  const saved = await blocksOf(p);
  check("the saved toggle is expanded", saved.find((b) => b.id === p.ids.TG)?.content?.expanded === true,
    JSON.stringify(saved.find((b) => b.id === p.ids.TG)?.content));
});

scenario("enter_on_folded_toggle", async () => {
  const p = await build("enter_on_folded_toggle", [
    { k: "TG", type: "toggle", text: "TG", content: { expanded: false } },
    { k: "K", parent: "TG", text: "KK" },
  ]);
  await caret(p.ids.TG, "end");
  await tab.keyboard.press("Enter");
  await tab.waitForTimeout(400);
  await tab.keyboard.type("NN");
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("Enter on a collapsed toggle: hidden children do not leak out", shape(t) === "TG@0 NN@0", dump(t));
  check("Enter on a collapsed toggle: the new line is a toggle too", t.find((b) => b.text === "NN")?.type === "toggle", dump(t));
  const rows = await persisted(p);
  check("saved: the children stay inside the toggle", rows.find((r) => r.key === "K")?.parentKey === "TG",
    JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

scenario("shift_tab_heading_no_adopt", async () => {
  const p = await build("shift_tab_heading_no_adopt", [
    { k: "A", type: "bulleted_list", text: "AA" },
    { k: "H", type: "heading2", parent: "A", text: "HH" },
    { k: "B", parent: "A", text: "BB" },
  ]);
  await caret(p.ids.H, "end");
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(550);
  const t = await domTree();
  check("a heading does not take the following siblings", shape(t) === "AA@0 BB@1 HH@0", dump(t));
  const rows = await persisted(p);
  check("saved as the same tree too", pshape(rows) === "AA@0 BB@1 HH@0", JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

scenario("shift_tab_folded_toggle_adopts", async () => {
  const p = await build("shift_tab_folded_toggle_adopts", [
    { k: "A", type: "bulleted_list", text: "AA" },
    { k: "TG", type: "toggle", parent: "A", text: "TG", content: { expanded: false } },
    { k: "K", parent: "TG", text: "KK" },
    { k: "B", parent: "A", text: "BB" },
  ]);
  await caret(p.ids.TG, "end");
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(600);
  const t = await domTree();
  check("a collapsed toggle takes the following siblings and stays collapsed", shape(t) === "AA@0 TG@0", dump(t));
  const rows = await persisted(p);
  check("saved: the following sibling is the toggle's child", rows.find((r) => r.key === "B")?.parentKey === "TG",
    JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

// ── The rest from the audit (2026-09-10 round 3) ────────────────────────────
scenario("backspace_deletes_container_keeps_kids", async () => {
 // when the previous block is a container that holds no text, Backspace deletes it. Its children
 // must not vanish with it — a block without a parent is drawn nowhere, so it disappears from the
 // screen while staying in the save.
  const p = await build("bs_container_kids", [
    { k: "L", type: "column_list", text: "" },
    { k: "K1", parent: "L", text: "K1" },
    { k: "K2", parent: "L", text: "K2" },
    { k: "Z", text: "ZZ" },
  ]);
  await caret(p.ids.Z, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(600);
  const t = await domTree();
  check("deleting the container keeps its children", shape(t) === "K1@0 K2@0 ZZ@0", dump(t));
  const rows = await persisted(p);
  check("no orphans in the save either", rows.every((r) => r.parentKey === null) && rows.length === 3,
    JSON.stringify(rows.map((r) => [r.key, r.parentKey])));
});

scenario("undo_after_enter", async () => {
 // text typed right after Enter must not go into the same undo group as the Enter.
 // One ⌘Z undoes only the typed text, and the new line must stay.
  const p = await build("undo_after_enter", [{ k: "A", text: "AA" }]);
  await caretReady(p.ids.A, "end", 2);
  await tab.keyboard.press("Enter");
  await tab.waitForTimeout(350);
  await tab.keyboard.type("BB");
  await tab.waitForTimeout(400);
  check("Enter + typing", shape(await domTree()) === "AA@0 BB@0", dump(await domTree()));
  await tab.keyboard.press("ControlOrMeta+z");
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("one ⌘Z undoes only the typed text", t.length === 2 && t[0].text === "AA" && t[1].text === "", dump(t));
});

scenario("enter_many_positions_stay_distinct", async () => {
 // a new line's position takes the middle of the gap to the next sibling. Keep halving that gap and
 // the double runs out of room to divide (≈ the 53rd time) and two lines get the same value — from then on the order
 // is left to the sort's tie handling. Even after 60 presses every value must differ.
  const p = await build("enter_many", [{ k: "A", text: "A" }, { k: "Z", text: "Z" }]);
  await caretReady(p.ids.A, "end", 1);
  for (let i = 0; i < 60; i++) {
    await tab.keyboard.press("Enter");
    await tab.keyboard.type("x");
  }
  await tab.waitForTimeout(900);
  const t = await domTree();
  check("Enter ×60: the line count is right", t.length === 62, `${t.length}`);
  check("Enter ×60: Z is still last", t[t.length - 1]?.text === "Z", dump(t).slice(-120));
 // saving keeps flowing during the 60 presses, so persisted() may settle on an intermediate state —
 // wait a bit longer until all 62 have arrived before looking
  let rows = await persisted(p);
  for (let k = 0; k < 10 && rows.length < 62; k++) rows = await persisted(p);
  const tops = rows.filter((r) => r.parentKey === null).map((r) => r.position);
  check("Enter ×60: 62 lines in the save too", rows.length === 62, `${rows.length}`);
  check("Enter ×60: positions do not collide", new Set(tops).size === tops.length,
    `only ${new Set(tops).size} of ${tops.length} unique`);
});

// ── Run ─────────────────────────────────────────────────────────────────────
const names = Object.keys(scenarios).filter((n) => !ONLY.length || ONLY.includes(n));
for (const n of names) {
  console.log(`\n── ${n} ─────────────────────────────`);
  try {
    await scenarios[n]();
  } catch (e) {
    check(`${n}: the scenario did not run to the end`, false, String(e).slice(0, 200));
  }
}

if (pageErrors.length) check(`${pageErrors.length} console errors`, false, pageErrors.slice(0, 2).join(" / ").slice(0, 200));
await browser.close();
for (const id of createdPages) {
  await fetch(`${BASE}/api/pages/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});
}

if (fails) {
  console.error(`\n  ┌─ Indentation differs from the original (${fails}) ─────────────`);
  console.error("  │ expected values from: docs/notion-indent.md (measured 2026-09-10)");
  console.error("  └──────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`\nIndentation — same as the original (${names.length} scenarios).`);
