// 마크다운의 들여쓰기(중첩) 왕복 — 우리 앱이 원본과 같게 읽고 같게 쓰는지.
//
// 기대값은 2026-09-10 에 app.notion.com 에서 직접 잰 것이다(docs/notion-indent.md §6):
//   들어갈 때(붙여넣기): 한 단은 "부모 마커 폭만큼" 들여쓴 것 — `- ` 는 2칸, `1. ` 는 3칸,
//     탭은 한 단. 리스트 항목보다 깊게 들여쓴 **일반 줄은 그 항목의 자식 블록**이 된다.
//   나올 때(내보내기): 한 단 4칸, 할 일은 `- [ ]  `(상자 뒤 두 칸), 토글은 글머리로.
//   그리고 원본이 내보낸 마크다운을 다시 붙여넣으면 **같은 트리**가 된다(왕복).
//
//   [BASE_URL=http://localhost:3110] node e2e/markdown-nesting.check.mjs
//
// 세 경로를 다 본다: 에디터 붙여넣기(parseMarkdown), `.md` 내보내기 라우트, md-mirror 파일.
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

/** 마크다운을 붙여넣고 트리를 읽는다 — 원본을 잴 때와 같은 방식(합성 paste 이벤트) */
async function pasteInto(md, label) {
 // 빈 페이지(블록 0개)는 시작 안내 UI만 그려서 붙여넣을 자리가 없다 — 빈 문단 하나를 둔다
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

/** 미러를 한 번 돌리고 파일을 찾는다. 미러는 워크스페이스 단위로 통째로 다시 쓰이므로
 *  (다른 검사가 페이지를 만들거나 보관하면 그 사이에 파일이 사라질 수 있다) 몇 번 시도한다. */
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

// ── 1. 들어갈 때: 칸 수 규칙 ───────────────────────────────────────────────
{
  const { tree } = await pasteInto("- a\n  - b\n    - c", "bullet-2sp");
  check("글머리는 2칸이면 한 단 들어간다", shape(tree) === "bulleted_list:a@0 bulleted_list:b@1 bulleted_list:c@2", shape(tree));
}
{
  const { tree } = await pasteInto("- a\n\t- b", "bullet-tab");
  check("탭도 한 단", shape(tree) === "bulleted_list:a@0 bulleted_list:b@1", shape(tree));
}
{
 // 원본: `1. ` 의 내용은 3칸에서 시작하므로 2칸은 부족하다 (M2c 실측)
  const { tree } = await pasteInto("1. a\n  1. b", "number-2sp");
  check("번호 목록은 2칸으로는 들어가지 않는다", shape(tree) === "numbered_list:a@0 numbered_list:b@0", shape(tree));
}
{
  const { tree } = await pasteInto("1. a\n   1. b\n      1. c", "number-3sp");
  check("번호 목록은 3칸이면 한 단", shape(tree) === "numbered_list:a@0 numbered_list:b@1 numbered_list:c@2", shape(tree));
}
{
  const { tree } = await pasteInto("- [ ] a\n  - [ ] b\n    - [ ] c", "todo");
  check("할 일도 2칸이면 한 단", shape(tree) === "todo:a@0 todo:b@1 todo:c@2", shape(tree));
}
{
 // 리스트 항목보다 깊은 일반 줄은 그 항목의 **자식 블록** (원본이 자기 마크다운을 그렇게 쓴다)
  const { tree } = await pasteInto("- a\n    - b\n\n        deep\n", "child-paragraph");
  check("리스트 밑으로 들여쓴 문단은 그 항목의 자식", shape(tree) === "bulleted_list:a@0 bulleted_list:b@1 paragraph:deep@2", shape(tree));
}

// ── 2. 원본이 내보낸 마크다운을 그대로 붙여넣기 (왕복의 절반) ──────────────
const NOTION_OUT = "- b1\n    - b2\n        - b3\n        \n        pchild\n        \n- [ ]  t1\n    - [ ]  t2\n- T\n    \n    tkid";
const NOTION_TREE = "bulleted_list:b1@0 bulleted_list:b2@1 bulleted_list:b3@2 paragraph:pchild@2 todo:t1@0 todo:t2@1 bulleted_list:T@0 paragraph:tkid@1";
{
  const { tree } = await pasteInto(NOTION_OUT, "notion-output");
  check("원본이 쓴 마크다운이 원본과 같은 트리로 들어온다", shape(tree) === NOTION_TREE, shape(tree));
}

// ── 3. 나올 때: `.md` 내보내기 ─────────────────────────────────────────────
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
 // 원본이 같은 구조를 복사할 때 내놓는 마크다운 그대로 — 빈 줄 자리까지 (M3 실측)
const NOTION_MD = "- b1\n    - b2\n        - b3\n        \n        pchild\n        \n- [ ]  t1\n    - [ ]  t2\n- T\n    \n    tkid";
const body = md.replace(/^# .*\n\n/, "").replace(/\n$/, "");
check("내보낸 마크다운이 원본과 글자 하나까지 같다", body === NOTION_MD, JSON.stringify(body));

{
 // 왕복: 우리가 쓴 마크다운을 우리가 다시 읽으면 같은 트리
  const { tree } = await pasteInto(md.replace(/^# .*\n/, ""), "roundtrip-ours");
  check("우리 마크다운도 같은 트리로 되돌아온다", shape(tree) === NOTION_TREE, shape(tree));
}

// ── 4. md-mirror 파일에 자식이 실리나 ──────────────────────────────────────
{
  const wanted = ["- b1", "    - b2", "        - b3", "        pchild", "- [ ]  t1", "    - [ ]  t2", "- T", "    tkid"];
  const hit = await mirrorFile(/^markdown-nesting-export-/, wanted);
  const missing = hit ? wanted.filter((w) => !hit.text.includes(w)) : wanted;
  check("미러 파일에 중첩이 4칸으로 실린다", !!hit && missing.length === 0,
    hit ? `${hit.path}${missing.length ? " — 없는 줄 " + JSON.stringify(missing) : ""}` : `${MIRROR_ROOT} 에서 파일을 못 찾음`);
}

// ── 5. 붙여넣기가 첫 줄을 잃지 않는다 (텍스트 CRDT 가 html 로 문자 연산을 만든다) ──
{
  const { tree } = await pasteInto("A\n\nB", "first-line");
  check("빈 블록에 붙여넣어도 첫 줄이 남는다", shape(tree) === "paragraph:A@0 paragraph:B@0", shape(tree));
}
{
  const { tree } = await pasteInto("**bold** text\n\nsecond", "inline-marks");
  check("인라인 서식이 있는 첫 줄도 남는다", shape(tree) === "paragraph:bold text@0 paragraph:second@0", shape(tree));
}

// ── 6. 이어지는 줄은 한 블록 (원본 M2d_indented_paragraphs) ────────────────
{
  const { tree } = await pasteInto("- x\n\npara-A\n    para-B\n        para-C", "continuation");
  const last = tree[tree.length - 1];
  check("빈 줄 없이 이어진 줄은 한 블록으로 접힌다",
    tree.length === 2 && last.type === "paragraph" && last.text.replace(/\s+/g, " ") === "para-A para-B para-C",
    shape(tree));
}

// ── 7. 코드 펜스·구분선·빈 항목 ────────────────────────────────────────────
{
  const { tree, pageId } = await pasteInto("- a\n    ```js\n    const x = 1;\n    ```", "nested-code");
  check("리스트 밑 코드 펜스가 자식으로 들어오고 본문은 들여쓰기가 벗겨진다",
    shape(tree) === "bulleted_list:a@0 code:const x = 1;@1", shape(tree));
  const md2 = await fetch(`${BASE}/api/pages/${pageId}/export`, { headers: H }).then((r) => r.text());
  check("그 코드가 다시 4칸으로 나간다", md2.includes("    ```js") && md2.includes("    const x = 1;"), JSON.stringify(md2.slice(-80)));
}
{
  const { tree } = await pasteInto("---\n- a\n  - b\n---\n- c", "leading-hr");
  check("`---` 로 시작해도 내용이 사라지지 않는다",
    shape(tree) === "divider:@0 bulleted_list:a@0 bulleted_list:b@1 divider:@0 bulleted_list:c@0", shape(tree));
}
{
  const { tree } = await pasteInto("- \n\n    - b", "empty-item");
  check("빈 글머리도 글머리로 남고 자식이 붙는다", shape(tree) === "bulleted_list:@0 bulleted_list:b@1", shape(tree));
}

// ── 8. 부모가 사라진 블록도 파일에 남는다 (리뷰에서 확인된 미러 누락) ──────
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
  check(".md 내보내기가 부모 없는 블록을 살린다", md3.includes("LOST"), JSON.stringify(md3.slice(-60)));
  const hitO = await mirrorFile(/^markdown-nesting-orphan-/, ["LOST"]);
  const hit = hitO?.text ?? null;
  check("미러도 부모 없는 블록을 살린다", !!hit && hit.includes("LOST"), hit ? JSON.stringify(hit.slice(-80)) : "파일 없음");
}

// ── 9. 리스트가 아닌 부모의 자식 — 원본처럼 평평하게 쓰고, 들여쓰기는 코드로 읽는다 ──
{
 // 원본(M6 실측)은 문단의 자식 문단을 `PA⏎⏎PB` 로, 들여쓰기 없이 내보낸다.
  const flat = await newPage("markdown-nesting flat-parent", [
    { k: "PA", text: "PA" }, { k: "PB", text: "PB", parent: "PA" },
  ]);
  const md4 = await fetch(`${BASE}/api/pages/${flat.pageId}/export`, { headers: H }).then((r) => r.text());
  const body4 = md4.replace(/^# .*\n\n/, "").replace(/\n$/, "");
  check("문단의 자식은 들여쓰지 않고 내보낸다", body4 === "PA\n\nPB", JSON.stringify(body4));
}
{
 // 원본(M5 실측)은 빈 줄 뒤 4칸 들여쓴 줄을 **코드 블록**으로 읽는다
  const { tree } = await pasteInto("AAA\n\n    BBB", "indented-code");
  check("빈 줄 뒤 들여쓴 줄은 코드 블록", shape(tree) === "paragraph:AAA@0 code:BBB@0", shape(tree));
}


// ── 7. 왕복에서 내용이 상하지 않는가 (2026-09-10 3차, 감사에서 나온 것들) ────
/** 블록 → 내보낸 마크다운 → 다시 붙여넣기 → 저장된 블록 */
async function roundTrip(label, seed) {
  const src = await newPage(`markdown-nesting ${label}`, seed);
  const md = await fetch(`${BASE}/api/pages/${src.pageId}/export`, { headers: H }).then((r) => r.text());
  const body = md.replace(/^# .*\n\n/, "");
  const { pageId } = await pasteInto(body, `${label}-back`);
 // 저장은 트랜잭션 큐로 따로 나간다 — 같은 답이 두 번 연속 나올 때까지 기다린다
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
 // 원본 M2c: 리스트 항목 바로 밑의 평문 줄은 그 항목 안으로 접힌다(게으른 이어짐)
  const { tree } = await pasteInto("1. num-B\npara-A\npara-B", "lazy-continuation");
  check("리스트 항목 밑의 평문 줄은 그 항목으로 접힌다",
    shape(tree) === "numbered_list:num-B para-A para-B@0", shape(tree));
}
{
 // 항목 안의 줄바꿈이 그 밑의 중첩을 무너뜨리면 안 된다
  const r = await roundTrip("soft-break-nesting", [
    { k: "A", type: "bulleted_list", text: "a1\na2" },
    { k: "B", type: "bulleted_list", text: "b", parent: "A" },
  ]);
  check("항목 안 줄바꿈이 그 밑의 중첩을 깨지 않는다",
    r.blocks.map((b) => `${b.type}@${b.depth}`).join(" ") === "bulleted_list@0 bulleted_list@1",
    JSON.stringify(r.md) + " → " + r.blocks.map((b) => `${b.type}@${b.depth}:${JSON.stringify(b.content.text)}`).join(" "));
  check("그 줄바꿈이 왕복에서 살아남는다", (r.blocks[0]?.content?.text ?? "") === "a1\na2",
    JSON.stringify(r.blocks[0]?.content?.text));
}
{
 // 마커처럼 생긴 문단이 다른 타입으로 돌아오면 안 된다
  const r = await roundTrip("marker-looking-text", [
    { k: "A", text: "- not a bullet" }, { k: "B", text: "# not a heading" },
    { k: "C", text: "---" }, { k: "D", text: "1. not numbered" }, { k: "E", text: "| not a table |" },
  ]);
  check("마커처럼 생긴 문단은 문단으로 돌아온다",
    r.blocks.every((b) => b.type === "paragraph") && r.blocks.length === 5,
    r.blocks.map((b) => `${b.type}:${JSON.stringify(b.content.text)}`).join(" "));
  check("그 글자도 그대로", r.blocks.map((b) => b.content.text).join("|") === "- not a bullet|# not a heading|---|1. not numbered|| not a table |",
    JSON.stringify(r.blocks.map((b) => b.content.text)));
}
{
 // 코드 본문에 ``` 이 있으면 앞에서 끊겨 나머지가 날아갔다
  const body = "before\n```\ninner fence\n```\nafter";
  const r = await roundTrip("code-with-fence", [
    { k: "C", type: "code", content: { text: body, language: "plain" } },
    { k: "Z", text: "tail" },
  ]);
  check("코드 안의 ``` 이 블록을 끊지 않는다", (r.blocks[0]?.content?.text ?? "") === body,
    JSON.stringify(r.md));
  check("코드 뒤 블록이 살아 있다", r.blocks.some((b) => b.content.text === "tail"),
    r.blocks.map((b) => b.type).join(" "));
}
{
 // 표: 셀 안의 파이프와 줄바꿈, 그리고 전부 빈 행
  const cells = [["h1", "h2"], ["a|b", "line1\nline2"], ["", ""], ["z", "w"]];
  const r = await roundTrip("table-cells", [
    { k: "T", type: "table", content: { table: { cells, headerRow: true } } },
  ]);
  const got = r.blocks[0]?.content?.table?.cells;
  check("표 셀의 파이프·줄바꿈·빈 행이 왕복에서 살아남는다",
    JSON.stringify(got) === JSON.stringify(cells), JSON.stringify(got) + " / " + JSON.stringify(r.md));
}

{
 // 표의 열 정렬이 .md 로 나갔다가 돌아온다
  const cells = [["L", "C", "R"], ["1", "2", "3"]];
  const align = [["default", "center", "right"], ["default", "center", "right"]];
  const r = await roundTrip("table-align", [
    { k: "T", type: "table", content: { table: { cells, headerRow: true, align } } },
  ]);
  check("표의 열 정렬이 왕복에서 살아남는다",
    /\|\s*---\s*\|\s*:---:\s*\|\s*---:\s*\|/.test(r.md) &&
      JSON.stringify(r.blocks[0]?.content?.table?.align?.[0]) === JSON.stringify(["default", "center", "right"]),
    JSON.stringify(r.md) + " / " + JSON.stringify(r.blocks[0]?.content?.table?.align));
}
{
 // 미러 파일도 같은 규칙 — `100. ` 항목의 자식은 5칸, 콜아웃 아이콘, 수식, 하위 페이지 링크
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
  check("미러가 콜아웃 아이콘을 그대로 쓴다", md.includes("> ⚠️ warn"), JSON.stringify(md.slice(-220)));
 // 마커 이스케이프가 인라인 마크다운까지 먹으면 안 된다 — 미러는 `**굵게**` 를 쓴다
  check("미러의 굵게가 이스케이프되지 않는다", md.includes("**bold** start") && !md.includes("\\**"),
    JSON.stringify(md.slice(-260)));
  check("미러가 수식을 $$ 로 감싼다", /\$\$\na\^2 \+ b\^2\n\$\$/.test(md), JSON.stringify(md.slice(-220)));
}

// ── 8. 붙여넣는 자리 (2026-09-10 3차) ──────────────────────────────────────
{
 // 글자가 있는 블록의 **맨 앞**에 붙여넣으면 빈 블록이 남으면 안 된다
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
  check("맨 앞에 붙여넣으면 빈 블록이 남지 않는다",
    shape(t) === "bulleted_list:X@0 bulleted_list:Y@0 paragraph:TAIL@0", shape(t));
}
{
 // 블록 **가운데**에 붙여넣으면 뒤쪽 조각의 서식이 살아 있어야 한다
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
  check("가운데 붙여넣기: 앞 조각의 서식이 남는다", /<b>bold<\/b>/.test(htmls[0]?.html ?? ""), JSON.stringify(htmls));
  const tail = htmls[htmls.length - 1];
  check("가운데 붙여넣기: 뒤 조각의 서식도 남는다", /<b>tail<\/b>/.test(tail?.html ?? ""), JSON.stringify(htmls));
}
{
 // 빈 **글머리**에 붙여넣으면 그 글머리가 첫 블록이 된다(빈 줄이 남지 않는다)
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
  check("빈 글머리에 붙여넣으면 빈 줄이 남지 않는다",
    shape(t) === "heading1:H@0 paragraph:body@0", shape(t));
}

if (pageErrors.length) check(`콘솔 에러 ${pageErrors.length}건`, false, pageErrors.slice(0, 2).join(" / ").slice(0, 200));
await browser.close();
for (const id of createdPages) {
  await fetch(`${BASE}/api/pages/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});
}
if (fails) {
  console.error(`\n  ┌─ 마크다운 중첩이 원본과 다릅니다 (${fails}건) ─────────`);
  console.error("  │ 기대값 출처: docs/notion-indent.md §6 (2026-09-10 실측)");
  console.error("  └──────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("\n마크다운 중첩 — 읽기·쓰기·왕복·미러 모두 원본과 같습니다.");
