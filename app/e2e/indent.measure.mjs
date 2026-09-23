// 우리 앱의 "들여쓰기(indent)"가 **지금** 실제로 어떻게 동작하는지를 시나리오별로 잰다.
// 노션과 같은 표(T1~T22)를 우리 쪽에서도 말할 수 있게 만드는 것이 목적이고,
// 판단이 아니라 잰 값만 남긴다 — 못 잰 시나리오는 failures 로 나간다.
//
// 왜 이렇게 재는가
//  - 키는 진짜로 누른다(Tab / Shift+Tab / Enter / Backspace / 타이핑). indent()를
//    직접 부르면 키 핸들러가 막고 있는 경우(코드 블록의 Tab, 선택 모드의 Tab)를
//    통째로 놓친다.
//  - DOM 만 보면 안 된다. 에디터는 트랜잭션 큐로 따로 저장하므로,
//    "화면에서는 들여써졌는데 저장은 안 된" 상태가 실제로 가능하다. 그래서 키 입력 뒤
//    GET /api/pages/<id>/blocks 의 parentBlockId 까지 같이 찍는다.
//  - 시나리오마다 페이지를 새로 만든다. 한 페이지에서 이어서 하면 앞 시나리오가 만든
//    부모/형제 관계가 다음 결과를 오염시킨다. 만든 페이지는 끝에서 전부 보관함으로.
//
//   [BASE_URL=http://localhost:3110] [USER_ID=…] [ONLY=T4_enter_after_indented,T6_shift_tab]
//   node e2e/indent.measure.mjs
//
// dev 서버는 이미 떠 있는 3110 을 쓴다(CLAUDE.md). dev 데이터는 버려도 되는 데이터.
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

// 1x1 png — image 블록에 실제 URL 을 물려야 렌더가 끝난다(네트워크는 안 탄다)
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
// 타입별 content 모양 — block-spacing.check.mjs 와 같은 규칙
const contentOf = (type, text) =>
  type === "todo" ? { text, checked: false }
  : type === "toggle" ? { text, expanded: true }
  : type === "code" ? { text: text || "code()", language: "plain" }
  : type === "callout" ? { text, icon: "💡" }
  : type === "divider" ? {}
  : type === "image" ? { url: PNG }
  : { text };

// ── 페이지 만들기 ────────────────────────────────────────────────────────────
const createdPages = [];
/** seed: [{ k, type, text?, parent? }] — parent 는 앞에 나온 k 를 가리킨다 */
async function build(name, seed) {
  const res = await fetch(`${BASE}/api/pages`, { method: "POST", headers: H, body: JSON.stringify({ title: `indent.measure ${name}` }) }).then((r) => r.json());
  const pageId = res.page?.id ?? res.id;
  if (!pageId) throw new Error(`page create failed: ${JSON.stringify(res).slice(0, 200)}`);
  createdPages.push(pageId);
  // 새 페이지에는 부트스트랩 빈 문단이 하나 들어 있다(block-editor.tsx bootstrapParagraph).
  // 그걸 남겨두면 트리에 정체 불명의 빈 문단이 섞이고 position 1 이 겹쳐 순서가 흐려진다.
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

// ── 브라우저 ────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const tab = await ctx.newPage();
const pageErrors = [];
tab.on("pageerror", (e) => pageErrors.push(String(e)));
// 저장 트랜잭션을 세어 둔다: "Tab 을 눌렀는데 저장 요청이 0건" 자체가 증거다
let saveStarted = 0, saveDone = 0;
tab.on("request", (r) => { if (r.url().includes("/api/saveTransactions")) saveStarted++; });
tab.on("requestfinished", (r) => { if (r.url().includes("/api/saveTransactions")) saveDone++; });
tab.on("requestfailed", (r) => { if (r.url().includes("/api/saveTransactions")) saveDone++; });

async function openPage(p) {
  await tab.goto(`${BASE}/p/${p.pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await tab.waitForSelector('[data-testid="editor-root"] [data-block-type]', { timeout: 90_000 });
  await tab.waitForTimeout(700);
}

// ── 재는 도구 ───────────────────────────────────────────────────────────────
/** 캐럿 놓기. 키 입력은 진짜로 누르지만 "문장 중간" 같은 위치는 Range 로 정확히 잡아야
 *  T2/T14 가 재현된다. 클릭은 줄바꿈된 줄에서 오프셋이 흔들린다. */
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

/** 키 입력 뒤 캐럿이 어디 있는지 — 들여쓰기가 캐럿을 잃어버리는지도 표에 필요하다 */
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

/** 화면의 블록 트리: id·타입·중첩 깊이(editor-root 안의 [data-block-type] 조상 수)·
 *  들여쓰기 px(행의 padding-left)·편집영역 왼쪽 x·리스트 마커 글자 */
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

/** 저장이 끝났는지: 트랜잭션 요청이 하나라도 돌고 in-flight 가 없어질 때까지 (최대 ms).
 *  기준선(base)은 키 입력 **전**의 카운트다 — 큐는 한가할 때 동기로 flush 하므로
 *  키를 누른 직후에 세기 시작하면 이미 끝난 저장을 "0건"으로 잘못 적는다.
 *  변화가 없으면 저장 요청 자체가 안 뜨므로 오래 기다리지 않고 넘어간다. */
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

/** 저장된 진실: API 가 두 번 연속 같은 답을 줄 때까지 읽는다(부모/위치/깊이) */
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

/** 블록의 박스 — 마퀴/텍스트 드래그 좌표 계산용 (deselect.check.mjs 와 같은 방식) */
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
/** halo(블록 선택) 목록 */
const halos = () =>
  tab.evaluate(() =>
    [...document.querySelectorAll('[data-testid="editor-root"] [data-block-type]')]
      .filter((r) => r.querySelector(':scope > div > [data-selected]'))
      .map((r) => r.getAttribute("data-testid").slice(6, 14))
  );

// ── 시나리오 러너 ───────────────────────────────────────────────────────────
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
/** 대부분의 시나리오가 끝에 하는 일: 화면 + 저장된 트리 */
const snapshot = async (p, extra = {}) => {
  const per = await readPersisted(p);
  return { pageId: p.pageId, ...extra, caretAfter: await caretNow(), dom: await domTree(), persisted: per.rows, persistStable: per.stable, saveRequests: per.saves.requests };
};
const press = async (k, n = 1, wait = 320) => {
  pressBaseline ??= saveStarted; // 이 시나리오의 첫 키 입력 시점을 저장 카운트의 기준선으로
  for (let i = 0; i < n; i++) { await tab.keyboard.press(k); await tab.waitForTimeout(wait); }
};

const TYPES = ["paragraph", "heading1", "heading2", "heading3", "bulleted_list", "numbered_list", "todo", "toggle", "quote", "callout", "code", "divider"];

// ── T1~T3: 캐럿 위치가 Tab 결과를 바꾸는가 ──────────────────────────────────
// 노션은 캐럿 위치와 무관하게 블록 전체를 들여쓴다. 우리 쪽이 offset 0 에서만/끝에서만
// 다르게 굴지 않는지 확인하려고 세 개로 쪼갰다.
for (const [key, where] of [["T1_tab_at_start", 0], ["T2_tab_mid", "mid"], ["T3_tab_end", "end"]]) {
  await scenario(key, `앞 형제가 문단인 문단에서 캐럿 ${where} 위치로 Tab`, async () => {
    const p = await build(key, [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBBBBBB" }]);
    const before = await caret(p.ids.B, where);
    await press("Tab");
    return snapshot(p, { caretBefore: before });
  });
}

// ── T4: 사용자가 불편해한 그 지점 ───────────────────────────────────────────
// B 가 A 밑에 들여써져 있고 B 끝에서 Enter — 새 블록 C 는 B 와 같은 깊이여야 한다(노션).
await scenario("T4_enter_after_indented", "A 밑에 들여쓴 B 의 끝에서 Enter — 새 블록의 깊이", async () => {
  const p = await build("T4", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBB", parent: "A" }, { k: "Z", type: "paragraph", text: "ZZZZ" }]);
  const before = await caret(p.ids.B, "end");
  await press("Enter");
  await tab.keyboard.type("CCC", { delay: 60 }); // 새 블록을 식별할 수 있게 글자를 넣는다
  await tab.waitForTimeout(300);
  return snapshot(p, { caretBefore: before });
});

// ── T5: 빈 상태의 들여쓴 블록에서 Enter ─────────────────────────────────────
// 노션에서 리스트/문단이 비어 있으면 Enter 는 내어쓰기(또는 문단 변환)로 쓰인다.
await scenario("T5_enter_empty_indented", "A 밑에 들여쓴 빈 B 에서 Enter — 내어쓰기/유지/변환", async () => {
  const p = await build("T5", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "", parent: "A" }]);
  const before = await caret(p.ids.B, 0);
  await press("Enter");
  return snapshot(p, { caretBefore: before });
});
// 같은 질문의 리스트 판 — 빈 리스트 항목은 노션에서 따로 규칙이 있다
await scenario("T5b_enter_empty_indented_list", "A 밑에 들여쓴 빈 글머리 항목에서 Enter", async () => {
  const p = await build("T5b", [{ k: "A", type: "bulleted_list", text: "AAAA" }, { k: "B", type: "bulleted_list", text: "", parent: "A" }]);
  const before = await caret(p.ids.B, 0);
  await press("Enter");
  return snapshot(p, { caretBefore: before });
});

// ── T6: Shift+Tab ───────────────────────────────────────────────────────────
// 내어쓴 블록이 형제 순서에서 어디에 꽂히는지(부모 바로 뒤인지, 맨 끝인지)와
// 자식이 따라오는지를 같이 봐야 해서 A ⊃ B ⊃ C 옆에 D 를 하나 더 둔다.
await scenario("T6_shift_tab", "A ⊃ B ⊃ C, 그 뒤 top-level D. B 에서 Shift+Tab", async () => {
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

// ── T7: 들여쓴 블록의 맨 앞에서 Backspace ───────────────────────────────────
// 노션은 먼저 내어쓰기를 한 번 먹고, 그 다음 Backspace 에서 앞 블록과 합친다.
await scenario("T7_backspace_at_start_indented", "A 밑에 들여쓴 BBBB 의 offset 0 에서 Backspace", async () => {
  const p = await build("T7", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBB", parent: "A" }]);
  const before = await caret(p.ids.B, 0);
  await press("Backspace");
  const first = await snapshot(p, { caretBefore: before });
  // 두 번째 Backspace 까지 봐야 "내어쓰기 먼저"인지 "바로 합침"인지 구분된다
  const stillThere = await tab.$(`[data-testid="block-editable-${p.ids.B}"]`);
  let second = null;
  if (stillThere) { await caret(p.ids.B, 0); await press("Backspace"); second = await snapshot(p, {}); }
  return { ...first, secondBackspace: second };
});

// 대조군: 들여쓰기가 아닌 문단의 맨 앞 Backspace. T7 이 "아무 일도 없음"으로 나오면
// 그게 들여쓰기 때문인지, 맨 앞 Backspace 자체가 원래 합치지 않는 것인지 갈라야 한다.
await scenario("T7b_backspace_at_start_flat", "대조군: 들여쓰지 않은 BBBB 의 offset 0 에서 Backspace", async () => {
  const p = await build("T7b", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBB" }]);
  const before = await caret(p.ids.B, 0);
  await press("Backspace");
  return snapshot(p, { caretBefore: before });
});

// ── T8: 페이지 첫 블록의 Tab (앞 형제가 없다) ───────────────────────────────
await scenario("T8_tab_first_block", "페이지 첫 블록에서 Tab — 앞 형제가 없을 때", async () => {
  const p = await build("T8", [{ k: "F", type: "paragraph", text: "FIRST" }, { k: "G", type: "paragraph", text: "GGGG" }]);
  const before = await caret(p.ids.F, "end");
  await press("Tab");
  return snapshot(p, { caretBefore: before });
});

// ── T9: 앞 형제가 헤딩일 때 ─────────────────────────────────────────────────
// 노션에서 헤딩은 자식을 받는다(토글 헤딩이 아니어도 들여쓰기는 된다). 우리 쪽 코드에는
// NO_CHILDREN 목록이 있어서 여기서 갈릴 가능성이 크다 — 세 헤딩을 각각 잰다.
await scenario("T9_parent_is_heading", "heading1/2/3 뒤 문단에서 Tab", async () => {
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

// ── T10: 앞 형제가 divider / code / image 일 때 ─────────────────────────────
await scenario("T10_parent_is_atomic", "divider·code·image 뒤 문단에서 Tab", async () => {
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

// ── T11 / T12: 자식이 딸린 블록을 들여쓰기/내어쓰기 ─────────────────────────
await scenario("T11_indent_with_children", "이미 자식(C,D)이 있는 B 를 Tab — 자식이 상대 깊이를 유지하며 따라오나", async () => {
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
await scenario("T12_outdent_with_children", "자식(C)이 있는 B 를 Shift+Tab — 자식이 B 밑에 남나", async () => {
  const p = await build("T12", [
    { k: "A", type: "paragraph", text: "AAAA" },
    { k: "B", type: "paragraph", text: "BBBB", parent: "A" },
    { k: "C", type: "paragraph", text: "CCCC", parent: "B" },
  ]);
  const before = await caret(p.ids.B, "end");
  await press("Shift+Tab");
  return snapshot(p, { caretBefore: before });
});

// ── T13: 자식이 있는 블록의 끝에서 Enter ────────────────────────────────────
// 노션은 새 블록을 "첫 자식"으로 넣는다(자식이 있는 블록일 때). 우리 쪽은?
await scenario("T13_enter_end_with_children", "자식 B 가 있는 A 의 끝에서 Enter — 형제 뒤인가 첫 자식인가", async () => {
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

// ── T14: 들여쓴 블록의 중간에서 Enter ───────────────────────────────────────
await scenario("T14_split_mid_indented", "A 밑에 들여쓴 B(BBBBBBBB)의 중간에서 Enter — 두 조각의 깊이", async () => {
  const p = await build("T14", [{ k: "A", type: "paragraph", text: "AAAA" }, { k: "B", type: "paragraph", text: "BBBBBBBB", parent: "A" }]);
  const before = await caret(p.ids.B, "mid");
  await press("Enter");
  return snapshot(p, { caretBefore: before });
});

// ── T15: 블록(halo) 다중 선택 + Tab ────────────────────────────────────────
// 캐럿이 없는 선택 모드에서는 키가 window 핸들러로 간다 — 거기 Tab 이 있는지 없는지가
// 그대로 결과다. 선택은 왼쪽 여백 마퀴 드래그(deselect.check.mjs 와 같은 방법).
await scenario("T15_multiselect_tab", "B·C 를 블록으로 선택(halo)한 뒤 Tab", async () => {
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

// ── T16: 두 블록에 걸친 텍스트 선택 + Tab ──────────────────────────────────
await scenario("T16_textsel_across_tab", "B→C 에 걸친 텍스트 선택 상태에서 Tab", async () => {
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

// ── T17: 깊이 1단의 px, 그리고 최대 깊이 ───────────────────────────────────
// 계단을 Tab 으로 직접 만든다: Pi 에서 Tab 을 i 번 누르면 i 단이 되는지까지 함께 잰다.
await scenario("T17_depth_geometry", "Tab 으로 계단을 쌓아 단당 px 과 상한을 잰다", async () => {
  const N = 8;
  const seed = Array.from({ length: N }, (_, i) => ({ k: `P${i}`, type: "paragraph", text: `P${i}` }));
  const p = await build("T17", seed);
  for (let i = 1; i < N; i++) { await caret(p.ids[`P${i}`], "end"); await press("Tab", i, 220); }
  const stair = (await domTree()).map((r) => ({ text: r.text, domDepth: r.domDepth, padLeft: r.padLeft, ceLeft: r.ceLeft }));
  const byDepth = {};
  for (const r of stair) if (byDepth[r.domDepth] === undefined) byDepth[r.domDepth] = r.ceLeft;
  const stepPx = Object.keys(byDepth).sort((a, b) => a - b).slice(1).map((d) => +(byDepth[d] - byDepth[d - 1]).toFixed(1));
  // 상한: 이미 깊은 사슬 끝에 형제를 하나 두고 거기서 Tab — 계단 끝은 형제가 없어
  // 더 못 내려가므로, 상한만 따로 이렇게 확인한다.
  const D = 14;
  const chain = Array.from({ length: D }, (_, i) => ({ k: `L${i}`, type: "paragraph", text: `L${i}`, ...(i ? { parent: `L${i - 1}` } : {}) }));
  chain.push({ k: "S", type: "paragraph", text: "SIB", parent: `L${D - 2}` }); // L(D-1) 의 형제
  const q = await build("T17-deep", chain);
  const beforeDeep = (await domTree()).find((r) => r.id === q.ids.S.slice(0, 8));
  await caret(q.ids.S, "end");
  await press("Tab", 3, 260); // 한 번은 L(D-1) 밑, 그 다음은 형제가 없어 안 움직여야 한다
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

// ── T18: 깊이별 리스트 마커 ────────────────────────────────────────────────
// 노션은 깊이에 따라 글머리 글리프(• ◦ ▪)와 번호 체계(1. a. i.)가 바뀐다.
// 깊이마다 항목이 하나뿐이면 번호가 늘 "1." 로 나와 체계를 말할 수 없으므로,
// 각 깊이에 두 항목씩 만든다(둘째 항목의 라벨이 체계를 드러낸다).
await scenario("T18_list_markers", "글머리·번호 목록의 깊이 0~3 마커 (깊이마다 두 항목)", async () => {
  const TABS = [0, 0, 1, 1, 2, 2, 3, 3]; // i 번째 항목에 누를 Tab 수 → 깊이 0,0,1,1,2,2,3,3
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

// ── T19 / T20: 컨테이너(콜아웃·토글) 안에서의 Tab ──────────────────────────
// 콜아웃/토글 자식은 렌더 트리에서 depth 가 0 으로 리셋된다(block-row.tsx) —
// 그래서 domDepth 만 보면 안 되고 편집영역 x 까지 같이 찍는다.
await scenario("T19_tab_inside_callout", "콜아웃 안의 두 번째 자식 문단에서 Tab", async () => {
  const p = await build("T19", [
    { k: "CA", type: "callout", text: "callout" },
    { k: "c1", type: "paragraph", text: "inside one", parent: "CA" },
    { k: "c2", type: "paragraph", text: "inside two", parent: "CA" },
  ]);
  const beforeRow = (await domTree()).find((r) => r.id === p.ids.c2.slice(0, 8));
  const before = await caret(p.ids.c2, "end");
  await press("Tab");
  const firstChildTab = await (async () => { // 첫 자식은 앞 형제가 없다 — 같이 확인
    await caret(p.ids.c1, "end"); await press("Tab");
    return (await domTree()).find((r) => r.id === p.ids.c1.slice(0, 8));
  })();
  return snapshot(p, { caretBefore: before, c2Before: beforeRow, c1AfterTab: firstChildTab });
});
await scenario("T20_tab_inside_toggle", "펼친 토글 안의 두 번째 자식 문단에서 Tab", async () => {
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

// ── T21: 타입별로 "문단 밑으로 들여쓸 수 있나" ─────────────────────────────
// 페이지 하나에 [문단 host, 대상 타입] 짝을 늘어놓고 대상에서만 Tab 을 누른다.
// divider 는 편집영역이 없어 캐럿을 못 놓는다 — 6점 클릭(halo)으로 선택하고 Tab.
await scenario("T21_can_indent_type", "각 타입 블록을 앞의 문단 밑으로 Tab", async () => {
  const seed = [];
  for (const t of TYPES) { seed.push({ k: `h_${t}`, type: "paragraph", text: `host ${t}` }); seed.push({ k: `x_${t}`, type: t, text: `x ${t}` }); }
  const p = await build("T21", seed);
  const per = {};
  for (const t of TYPES) {
    const id = p.ids[`x_${t}`];
    const c = await caret(id, "end");
    let drivenBy = "caret";
    if (!c.placed) { // 편집영역이 없는 타입: 6점 핸들 클릭으로 블록 선택 후 Tab
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

// ── T22: 타입별로 "밑에 자식을 받을 수 있나" ───────────────────────────────
// [대상 타입 X, 문단 P] 짝. P 에서 Tab 을 눌러 X 밑으로 들어가는지 본다.
await scenario("T22_can_accept_children", "각 타입 뒤의 문단에서 Tab — 그 타입이 자식을 받나", async () => {
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

// ── 정리 ───────────────────────────────────────────────────────────────────
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
