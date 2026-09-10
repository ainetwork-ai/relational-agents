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
    const content =
      type === "todo" ? { text: sd.text ?? sd.k, checked: !!sd.checked }
      : type === "toggle" ? { text: sd.text ?? sd.k, expanded: true }
      : { text: sd.text ?? sd.k };
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
const body = md.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("# markdown-nesting"));
check("한 단은 4칸", body.join("\n") === [
  "- b1",
  "    - b2",
  "        - b3",
  "        pchild",
  "- [ ]  t1",
  "    - [ ]  t2",
  "- T",
  "    tkid",
].join("\n"), JSON.stringify(body));
{
 // 왕복: 우리가 쓴 마크다운을 우리가 다시 읽으면 같은 트리
  const { tree } = await pasteInto(md.replace(/^# .*\n/, ""), "roundtrip-ours");
  check("우리 마크다운도 같은 트리로 되돌아온다", shape(tree) === NOTION_TREE, shape(tree));
}

// ── 4. md-mirror 파일에 자식이 실리나 ──────────────────────────────────────
{
 // 미러는 500ms 디바운스 뒤 워크스페이스를 통째로 다시 쓴다. 기다리는 대신
 // /api/workspace/export 를 한 번 부른다 — 그 라우트가 mirrorWorkspace 를 직접 await 한다.
  await fetch(`${BASE}/api/workspace/export`, { headers: H }).then((r) => r.arrayBuffer()).catch(() => null);
  const wanted = ["- b1", "    - b2", "        - b3", "        pchild", "- [ ]  t1", "    - [ ]  t2", "- T", "    tkid"];
  const hits = [];
  const stack = [MIRROR_ROOT];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p2 = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.includes(".tmp-")) stack.push(p2); }
 // 미러 파일 이름은 제목을 슬러그로 바꾼 것 + id 6자리
      else if (e.isFile() && /^markdown-nesting-export-/.test(e.name)) hits.push(p2);
    }
  }
  const txt = hits.length ? fs.readFileSync(hits[0], "utf8") : null;
  const missing = txt ? wanted.filter((w) => !txt.includes(w)) : wanted;
  check("미러 파일에 중첩이 4칸으로 실린다", !!txt && missing.length === 0,
    txt ? `${hits[0]}${missing.length ? " — 없는 줄 " + JSON.stringify(missing) : ""}` : `${MIRROR_ROOT} 에서 파일을 못 찾음`);
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
