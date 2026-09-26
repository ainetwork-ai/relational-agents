// Markdown indentation (nesting) round trip — does our app read and write it the same as the original.
//
// The expected values were measured directly on app.notion.com on 2026-09-10 (docs/notion-indent.md §6):
//   Coming in (paste): one level is an indent "as wide as the parent marker" — `- ` is 2 spaces, `1. ` is 3,
//     a tab is one level. A **plain line indented deeper than a list item becomes that item's child block**.
//   Going out (export): 4 spaces per level, todos as `- [ ]  ` (two spaces after the box), toggles as bullets.
//   And pasting back the markdown the original exported gives the **same tree** (round trip).
//
//   [BASE_URL=http://localhost:3110] node e2e/markdown-nesting.check.mjs
//
// Looks at all three paths: editor paste (parseMarkdown), the `.md` export route, the md-mirror file.
import fs from "node:fs";
import path from "node:path";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85"; // hyeonjj
const MIRROR_ROOT = process.env.MD_MIRROR_ROOT ?? path.join(process.cwd(), "..", "md-mirror");

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

const createdPages = [];
async function newPage(title, seed = []) {
  const res = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title }) }).then((r) => r.json());
  const pageId = res.page?.id ?? res.id;
  if (!pageId) throw new Error(`page create failed: ${JSON.stringify(res).slice(0, 160)}`);
  createdPages.push(pageId);
  const existing = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { headers: H }).then((r) => r.json()).catch(() => ({}));
  const stale = (existing.blocks ?? []).map((b) => b.id);
  const ids = {};
  const nth = new Map();
  const blocks = seed.map((sd) => {
    const id = uuid();
    ids[sd.k] = id;
    const parentBlockId = sd.parent ? ids[sd.parent] : null;
    const bucket = parentBlockId ?? "root";
    const position = (nth.get(bucket) ?? 0) + 1;
    nth.set(bucket, position);
    const type = sd.type ?? "paragraph";
    const content = sd.content ?? (
      type === "todo" ? { text: sd.text ?? sd.k, checked: !!sd.checked }
      : type === "toggle" ? { text: sd.text ?? sd.k, expanded: true }
      : { text: sd.text ?? sd.k });
    return { id, type, content, parentBlockId, position };
  });
  const put = await fetch(`${BASE}/api/pages/${pageId}/blocks`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ blocks, deletedIds: stale, newIds: blocks.map((b) => b.id) }),
  });
  if (!put.ok) throw new Error(`seed failed ${put.status}`);
  return { pageId, ids };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const tab = await ctx.newPage();
const pageErrors = [];
tab.on("pageerror", (e) => pageErrors.push(String(e)));

const domTree = () =>
  tab.evaluate(() => {
    const root = document.querySelector('[data-testid="editor-root"]');
    if (!root) return [];
    const own = (row, sel) => [...row.querySelectorAll(sel)].find((e) => e.closest("[data-block-type]") === row) ?? null;
    return [...root.querySelectorAll("[data-block-type]")].map((row) => {
      let depth = 0;
      for (let p = row.parentElement; p && p !== root; p = p.parentElement) if (p.matches("[data-block-type]")) depth++;
      const ce = own(row, "[contenteditable]");
      return { type: row.getAttribute("data-block-type"), depth, text: (ce?.innerText ?? "").replace(/\s+/g, " ").trim() };
    });
  });
const shape = (t) => t.map((b) => `${b.type}:${b.text || ""}@${b.depth}`).join(" ");

/** Paste markdown and read the tree — the same way the original was measured (synthetic paste event) */
async function pasteInto(md, label) {
 // an empty page (0 blocks) draws only the getting-started UI, so there is nowhere to paste — put one empty paragraph
  const { pageId } = await newPage(`markdown-nesting ${label}`, [{ k: "p0", text: "" }]);
  await tab.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await tab.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 90_000 });
  await tab.waitForTimeout(500);
  const ok = await tab.evaluate((text) => {
    const el = document.querySelector('[data-testid="editor-root"] [contenteditable]');
    if (!el) return false;
    el.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  }, md);
  if (!ok) return { tree: [], pageId };
  await tab.waitForTimeout(900);
  return { tree: await domTree(), pageId };
}

/** Run the mirror once and find the file. The mirror rewrites a whole workspace at a time
 *  (the file can vanish in between if another check creates or archives pages), so try a few times. */
async function mirrorFile(re, want) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await fetch(`${BASE}/api/workspace/export`, { headers: H }).then((r) => r.arrayBuffer()).catch(() => null);
    const stack = [MIRROR_ROOT];
    let hit = null;
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const p2 = path.join(dir, e.name);
        if (e.isDirectory()) { if (!e.name.includes(".tmp-")) stack.push(p2); }
        else if (e.isFile() && re.test(e.name)) hit = { path: p2, text: fs.readFileSync(p2, "utf8") };
      }
    }
    if (hit && want.every((w) => hit.text.includes(w))) return hit;
    if (attempt === 4) return hit;
    await tab.waitForTimeout(800);
  }
  return null;
}

// ── 1. Coming in: the space-count rules ────────────────────────────────────
{
  const { tree } = await pasteInto("- a\n  - b\n    - c", "bullet-2sp");
  check("a bullet goes one level in with 2 spaces", shape(tree) === "bulleted_list:a@0 bulleted_list:b@1 bulleted_list:c@2", shape(tree));
}
{
  const { tree } = await pasteInto("- a\n\t- b", "bullet-tab");
  check("a tab is one level too", shape(tree) === "bulleted_list:a@0 bulleted_list:b@1", shape(tree));
}
{
 // original: the content of `1. ` starts at column 3, so 2 spaces are not enough (M2c measurement)
  const { tree } = await pasteInto("1. a\n  1. b", "number-2sp");
  check("a numbered list does not go in with 2 spaces", shape(tree) === "numbered_list:a@0 numbered_list:b@0", shape(tree));
}
{
  const { tree } = await pasteInto("1. a\n   1. b\n      1. c", "number-3sp");
  check("a numbered list goes one level in with 3 spaces", shape(tree) === "numbered_list:a@0 numbered_list:b@1 numbered_list:c@2", shape(tree));
}
{
  const { tree } = await pasteInto("- [ ] a\n  - [ ] b\n    - [ ] c", "todo");
  check("a todo also goes one level in with 2 spaces", shape(tree) === "todo:a@0 todo:b@1 todo:c@2", shape(tree));
}
{
 // a plain line deeper than a list item is that item's **child block** (the original writes its own markdown that way)
  const { tree } = await pasteInto("- a\n    - b\n\n        deep\n", "child-paragraph");
  check("a paragraph indented under a list is that item's child", shape(tree) === "bulleted_list:a@0 bulleted_list:b@1 paragraph:deep@2", shape(tree));
}

// ── 2. Paste the markdown the original exported, as-is (half of the round trip) ──
const NOTION_OUT = "- b1\n    - b2\n        - b3\n        \n        pchild\n        \n- [ ]  t1\n    - [ ]  t2\n- T\n    \n    tkid";
const NOTION_TREE = "bulleted_list:b1@0 bulleted_list:b2@1 bulleted_list:b3@2 paragraph:pchild@2 todo:t1@0 todo:t2@1 bulleted_list:T@0 paragraph:tkid@1";
{
  const { tree } = await pasteInto(NOTION_OUT, "notion-output");
  check("markdown written by the original comes in as the same tree as the original", shape(tree) === NOTION_TREE, shape(tree));
}

// ── 3. Going out: `.md` export ──────────────────────────────────────────────
const nested = await newPage("markdown-nesting export", [
  { k: "b1", type: "bulleted_list" },
  { k: "b2", type: "bulleted_list", parent: "b1" },
  { k: "b3", type: "bulleted_list", parent: "b2" },
  { k: "pchild", parent: "b2" },
  { k: "t1", type: "todo" },
  { k: "t2", type: "todo", parent: "t1" },
  { k: "T", type: "toggle" },
  { k: "tkid", parent: "T" },
]);
const md = await fetch(`${BASE}/api/pages/${nested.pageId}/export`, { headers: H }).then((r) => r.text());
 // exactly the markdown the original produces when copying the same structure — down to the blank lines (M3 measurement)
const NOTION_MD = "- b1\n    - b2\n        - b3\n        \n        pchild\n        \n- [ ]  t1\n    - [ ]  t2\n- T\n    \n    tkid";
const body = md.replace(/^# .*\n\n/, "").replace(/\n$/, "");
check("exported markdown matches the original character for character", body === NOTION_MD, JSON.stringify(body));

{
 // round trip: when we read back the markdown we wrote, we get the same tree
  const { tree } = await pasteInto(md.replace(/^# .*\n/, ""), "roundtrip-ours");
  check("our markdown also comes back as the same tree", shape(tree) === NOTION_TREE, shape(tree));
}

// ── 4. Do children make it into the md-mirror file ─────────────────────────
{
  const wanted = ["- b1", "    - b2", "        - b3", "        pchild", "- [ ]  t1", "    - [ ]  t2", "- T", "    tkid"];
  const hit = await mirrorFile(/^markdown-nesting-export-/, wanted);
  const missing = hit ? wanted.filter((w) => !hit.text.includes(w)) : wanted;
  check("the mirror file carries nesting with 4 spaces", !!hit && missing.length === 0,
    hit ? `${hit.path}${missing.length ? " — missing lines " + JSON.stringify(missing) : ""}` : `no file found in ${MIRROR_ROOT}`);
}

// ── 5. Paste does not lose the first line (the text CRDT builds char ops from the html) ──
{
  const { tree } = await pasteInto("A\n\nB", "first-line");
  check("pasting into an empty block keeps the first line", shape(tree) === "paragraph:A@0 paragraph:B@0", shape(tree));
}
{
  const { tree } = await pasteInto("**bold** text\n\nsecond", "inline-marks");
  check("a first line with inline formatting is kept too", shape(tree) === "paragraph:bold text@0 paragraph:second@0", shape(tree));
}

// ── 6. Continuation lines are one block (original M2d_indented_paragraphs) ──
{
  const { tree } = await pasteInto("- x\n\npara-A\n    para-B\n        para-C", "continuation");
  const last = tree[tree.length - 1];
  check("lines continuing without a blank line fold into one block",
    tree.length === 2 && last.type === "paragraph" && last.text.replace(/\s+/g, " ") === "para-A para-B para-C",
    shape(tree));
}

// ── 7. Code fences · dividers · empty items ────────────────────────────────
{
  const { tree, pageId } = await pasteInto("- a\n    ```js\n    const x = 1;\n    ```", "nested-code");
  check("a code fence under a list comes in as a child with its body de-indented",
    shape(tree) === "bulleted_list:a@0 code:const x = 1;@1", shape(tree));
  const md2 = await fetch(`${BASE}/api/pages/${pageId}/export`, { headers: H }).then((r) => r.text());
  check("that code goes back out with 4 spaces", md2.includes("    ```js") && md2.includes("    const x = 1;"), JSON.stringify(md2.slice(-80)));
}
{
  const { tree } = await pasteInto("---\n- a\n  - b\n---\n- c", "leading-hr");
  check("content does not vanish when it starts with `---`",
    shape(tree) === "divider:@0 bulleted_list:a@0 bulleted_list:b@1 divider:@0 bulleted_list:c@0", shape(tree));
}
{
  const { tree } = await pasteInto("- \n\n    - b", "empty-item");
  check("an empty bullet stays a bullet and takes children", shape(tree) === "bulleted_list:@0 bulleted_list:b@1", shape(tree));
}

// ── 8. Blocks whose parent is gone still make it into the file (mirror gap found in review) ──
{
  const ghost = uuid();
  const orphan = await newPage("markdown-nesting orphan", [{ k: "A", text: "A" }, { k: "B", text: "B", parent: "A" }]);
  const lone = uuid();
  const cur = await fetch(`${BASE}/api/pages/${orphan.pageId}/blocks`, { headers: H }).then((r) => r.json());
  await fetch(`${BASE}/api/pages/${orphan.pageId}/blocks`, {
    method: "PUT", headers: H,
    body: JSON.stringify({
      blocks: [...(cur.blocks ?? []), { id: lone, type: "paragraph", content: { text: "LOST" }, parentBlockId: ghost, position: 9 }],
      deletedIds: [], newIds: [lone],
    }),
  });
  const md3 = await fetch(`${BASE}/api/pages/${orphan.pageId}/export`, { headers: H }).then((r) => r.text());
  check(".md export keeps blocks without a parent", md3.includes("LOST"), JSON.stringify(md3.slice(-60)));
  const hitO = await mirrorFile(/^markdown-nesting-orphan-/, ["LOST"]);
  const hit = hitO?.text ?? null;
  check("the mirror keeps blocks without a parent too", !!hit && hit.includes("LOST"), hit ? JSON.stringify(hit.slice(-80)) : "no file");
}

// ── 9. Children of a non-list parent — written flat like the original, indentation read as code ──
{
 // the original (M6 measurement) exports a paragraph's child paragraph as `PA⏎⏎PB`, without indentation.
  const flat = await newPage("markdown-nesting flat-parent", [
    { k: "PA", text: "PA" }, { k: "PB", text: "PB", parent: "PA" },
  ]);
  const md4 = await fetch(`${BASE}/api/pages/${flat.pageId}/export`, { headers: H }).then((r) => r.text());
  const body4 = md4.replace(/^# .*\n\n/, "").replace(/\n$/, "");
  check("a paragraph's children are exported without indentation", body4 === "PA\n\nPB", JSON.stringify(body4));
}
{
 // the original (M5 measurement) reads a line indented 4 spaces after a blank line as a **code block**
  const { tree } = await pasteInto("AAA\n\n    BBB", "indented-code");
  check("an indented line after a blank line is a code block", shape(tree) === "paragraph:AAA@0 code:BBB@0", shape(tree));
}


// ── 7. Does content survive the round trip (2026-09-10 round 3, findings from the audit) ──
/** blocks → exported markdown → pasted back → saved blocks */
async function roundTrip(label, seed) {
  const src = await newPage(`markdown-nesting ${label}`, seed);
  const md = await fetch(`${BASE}/api/pages/${src.pageId}/export`, { headers: H }).then((r) => r.text());
  const body = md.replace(/^# .*\n\n/, "");
  const { pageId } = await pasteInto(body, `${label}-back`);
 // saving goes out separately through the transaction queue — wait until the same answer comes twice in a row
  let rows = { blocks: [] }, prevSnap = null;
  for (let k = 0; k < 12; k++) {
    await tab.waitForTimeout(350);
    rows = await fetch(`${BASE}/api/pages/${pageId}/blocks`, { headers: H }).then((r) => r.json()).catch(() => ({ blocks: [] }));
    const snap = JSON.stringify(rows.blocks ?? []);
    if (snap === prevSnap && (rows.blocks ?? []).length) break;
    prevSnap = snap;
  }
  const byId = new Map((rows.blocks ?? []).map((b) => [b.id, b]));
  const depthOf = (b) => { let d = 0, q = b.parentBlockId; while (q && byId.has(q) && d < 40) { d++; q = byId.get(q).parentBlockId; } return d; };
  const kids = new Map();
  for (const b of rows.blocks ?? []) { const k = b.parentBlockId ?? null; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(b); }
  for (const l of kids.values()) l.sort((a, b) => a.position - b.position);
  const out = [];
  const walk = (parent) => { for (const b of kids.get(parent) ?? []) { out.push({ ...b, depth: depthOf(b) }); walk(b.id); } };
  walk(null);
  return { md: body, blocks: out };
}

{
 // original M2c: plain lines right under a list item fold into that item (lazy continuation)
  const { tree } = await pasteInto("1. num-B\npara-A\npara-B", "lazy-continuation");
  check("plain lines under a list item fold into that item",
    shape(tree) === "numbered_list:num-B para-A para-B@0", shape(tree));
}
{
 // a line break inside an item must not collapse the nesting below it
  const r = await roundTrip("soft-break-nesting", [
    { k: "A", type: "bulleted_list", text: "a1\na2" },
    { k: "B", type: "bulleted_list", text: "b", parent: "A" },
  ]);
  check("a line break inside an item does not break the nesting below it",
    r.blocks.map((b) => `${b.type}@${b.depth}`).join(" ") === "bulleted_list@0 bulleted_list@1",
    JSON.stringify(r.md) + " → " + r.blocks.map((b) => `${b.type}@${b.depth}:${JSON.stringify(b.content.text)}`).join(" "));
  check("that line break survives the round trip", (r.blocks[0]?.content?.text ?? "") === "a1\na2",
    JSON.stringify(r.blocks[0]?.content?.text));
}
{
 // a paragraph that looks like a marker must not come back as another type
  const r = await roundTrip("marker-looking-text", [
    { k: "A", text: "- not a bullet" }, { k: "B", text: "# not a heading" },
    { k: "C", text: "---" }, { k: "D", text: "1. not numbered" }, { k: "E", text: "| not a table |" },
  ]);
  check("paragraphs that look like markers come back as paragraphs",
    r.blocks.every((b) => b.type === "paragraph") && r.blocks.length === 5,
    r.blocks.map((b) => `${b.type}:${JSON.stringify(b.content.text)}`).join(" "));
  check("with the same text", r.blocks.map((b) => b.content.text).join("|") === "- not a bullet|# not a heading|---|1. not numbered|| not a table |",
    JSON.stringify(r.blocks.map((b) => b.content.text)));
}
{
 // a ``` inside the code body used to cut it early and drop the rest
  const body = "before\n```\ninner fence\n```\nafter";
  const r = await roundTrip("code-with-fence", [
    { k: "C", type: "code", content: { text: body, language: "plain" } },
    { k: "Z", text: "tail" },
  ]);
  check("a ``` inside code does not cut the block", (r.blocks[0]?.content?.text ?? "") === body,
    JSON.stringify(r.md));
  check("the block after the code survives", r.blocks.some((b) => b.content.text === "tail"),
    r.blocks.map((b) => b.type).join(" "));
}
{
 // tables: pipes and line breaks inside cells, and an all-empty row
  const cells = [["h1", "h2"], ["a|b", "line1\nline2"], ["", ""], ["z", "w"]];
  const r = await roundTrip("table-cells", [
    { k: "T", type: "table", content: { table: { cells, headerRow: true } } },
  ]);
  const got = r.blocks[0]?.content?.table?.cells;
  check("table cell pipes · line breaks · empty rows survive the round trip",
    JSON.stringify(got) === JSON.stringify(cells), JSON.stringify(got) + " / " + JSON.stringify(r.md));
}

{
 // table column alignment goes out to .md and comes back
  const cells = [["L", "C", "R"], ["1", "2", "3"]];
  const align = [["default", "center", "right"], ["default", "center", "right"]];
  const r = await roundTrip("table-align", [
    { k: "T", type: "table", content: { table: { cells, headerRow: true, align } } },
  ]);
  check("table column alignment survives the round trip",
    /\|\s*---\s*\|\s*:---:\s*\|\s*---:\s*\|/.test(r.md) &&
      JSON.stringify(r.blocks[0]?.content?.table?.align?.[0]) === JSON.stringify(["default", "center", "right"]),
    JSON.stringify(r.md) + " / " + JSON.stringify(r.blocks[0]?.content?.table?.align));
}
{
 // the mirror file follows the same rules — children of a `100. ` item at 5 spaces, callout icon, equation, subpage link
  const { pageId } = await newPage("markdown-nesting mirror-extras", [
    { k: "N", type: "numbered_list", text: "n", content: { text: "n" } },
    { k: "K", type: "bulleted_list", text: "kid", parent: "N" },
    { k: "C", type: "callout", content: { text: "warn", icon: "⚠️" } },
    { k: "E", type: "equation", content: { text: "a^2 + b^2" } },
    { k: "M", content: { text: "bold start", html: "<b>bold</b> start" } },
  ]);
  await fetch(`${BASE}/api/pages/${pageId}/export`, { headers: H });
  await fetch(`${BASE}/api/workspace/export`, { headers: H }).catch(() => {});
  const dir = fs.existsSync(MIRROR_ROOT) ? fs.readdirSync(MIRROR_ROOT).filter((d) => fs.statSync(path.join(MIRROR_ROOT, d)).isDirectory()) : [];
  let file = null;
  for (const d of dir) {
    const hit = fs.readdirSync(path.join(MIRROR_ROOT, d)).find((f) => f.includes("mirror-extras"));
    if (hit) { file = path.join(MIRROR_ROOT, d, hit); break; }
  }
  const md = file ? fs.readFileSync(file, "utf8") : "";
  check("the mirror writes the callout icon as-is", md.includes("> ⚠️ warn"), JSON.stringify(md.slice(-220)));
 // marker escaping must not eat inline markdown — the mirror writes `**bold**`
  check("bold in the mirror is not escaped", md.includes("**bold** start") && !md.includes("\\**"),
    JSON.stringify(md.slice(-260)));
  check("the mirror wraps equations in $$", /\$\$\na\^2 \+ b\^2\n\$\$/.test(md), JSON.stringify(md.slice(-220)));
}

// ── 8. Where the paste lands (2026-09-10 round 3) ───────────────────────────
{
 // pasting at the **very start** of a block with text must not leave an empty block
  const { pageId } = await newPage("markdown-nesting paste-at-start", [{ k: "T", text: "TAIL" }]);
  await tab.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await tab.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 90_000 });
  await tab.waitForTimeout(500);
  await tab.evaluate((text) => {
    const el = document.querySelector('[data-testid="editor-root"] [contenteditable]');
    el.focus();
    const node = el.firstChild ?? el;
    const r = document.createRange();
    r.setStart(node, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, "- X\n- Y");
  await tab.waitForTimeout(900);
  const t = await domTree();
  check("pasting at the very start leaves no empty block",
    shape(t) === "bulleted_list:X@0 bulleted_list:Y@0 paragraph:TAIL@0", shape(t));
}
{
 // pasting in the **middle** of a block must keep the formatting of the tail piece
  const { pageId } = await newPage("markdown-nesting paste-mid-marks", [
    { k: "B", content: { text: "boldtail", html: "<b>boldtail</b>" } },
  ]);
  await tab.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await tab.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 90_000 });
  await tab.waitForTimeout(500);
  await tab.evaluate((text) => {
    const el = document.querySelector('[data-testid="editor-root"] [contenteditable]');
    el.focus();
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walk.nextNode() ?? el;
    const r = document.createRange();
    r.setStart(node, 4); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, "- X\n- Y");
  await tab.waitForTimeout(900);
  const htmls = await tab.evaluate(() => {
    const root = document.querySelector('[data-testid="editor-root"]');
    return [...root.querySelectorAll("[data-block-type]")].map((row) => {
      const ce = [...row.querySelectorAll("[contenteditable]")].find((e) => e.closest("[data-block-type]") === row);
      return { type: row.getAttribute("data-block-type"), html: (ce?.innerHTML ?? "").trim() };
    });
  });
  check("paste in the middle: the head piece keeps its formatting", /<b>bold<\/b>/.test(htmls[0]?.html ?? ""), JSON.stringify(htmls));
  const tail = htmls[htmls.length - 1];
  check("paste in the middle: the tail piece keeps its formatting too", /<b>tail<\/b>/.test(tail?.html ?? ""), JSON.stringify(htmls));
}
{
 // pasting into an empty **bullet** makes that bullet the first block (no empty line left)
  const { pageId } = await newPage("markdown-nesting paste-empty-bullet", [
    { k: "B", type: "bulleted_list", text: "" },
  ]);
  await tab.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await tab.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 90_000 });
  await tab.waitForTimeout(500);
  await tab.evaluate((text) => {
    const el = document.querySelector('[data-testid="editor-root"] [contenteditable]');
    el.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, "# H\n\nbody");
  await tab.waitForTimeout(900);
  const t = await domTree();
  check("pasting into an empty bullet leaves no empty line",
    shape(t) === "heading1:H@0 paragraph:body@0", shape(t));
}

if (pageErrors.length) check(`${pageErrors.length} console errors`, false, pageErrors.slice(0, 2).join(" / ").slice(0, 200));
await browser.close();
for (const id of createdPages) {
  await fetch(`${BASE}/api/pages/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});
}
if (fails) {
  console.error(`\n  ┌─ Markdown nesting differs from the original (${fails}) ─────────`);
  console.error("  │ expected values from: docs/notion-indent.md §6 (measured 2026-09-10)");
  console.error("  └──────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("\nMarkdown nesting — reading · writing · round trip · mirror all match the original.");
