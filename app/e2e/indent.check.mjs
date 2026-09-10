// 들여쓰기(중첩) 패리티 — 우리 앱이 원본과 같게 움직이는지.
//
// 기대값은 전부 2026-09-10 에 app.notion.com 에서 직접 잰 것이고, 시나리오 이름은
// docs/notion-indent.md 의 표와 같다(원 데이터: scratchpad/nind-*.jsonl).
// "고쳤다"의 근거는 이 스크립트의 exit 0 이다.
//
//   [BASE_URL=http://localhost:3110] [ONLY=enter_with_children,shift_tab_middle]
//   node e2e/indent.check.mjs
//
// 왜 DOM 과 저장을 같이 보나: 화면에서는 들여써졌는데 저장은 안 된 상태가 실제로
// 가능하다(에디터는 트랜잭션 큐로 따로 저장한다). 그래서 키를 누른 뒤 DOM 트리와
// GET /api/pages/<id>/blocks 의 parentBlockId·position 을 함께 본다.
//
// 페이지는 시나리오마다 새로 만들고 끝에 전부 보관함으로 보낸다(dev 데이터는 버려도 됨).
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
/** seed: [{ k, type?, text?, parent? }] — parent 는 앞에 나온 k */
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

/** 캐럿 놓기 — 줄바꿈에 흔들리지 않게 Range 로 정확히 */
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

/** 화면 트리: 깊이·들여쓰기 px·마커·텍스트 */
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

/** 저장된 원본 블록 그대로 (content 까지 봐야 하는 검사용) */
async function blocksOf(p) {
  const r = await fetch(`${BASE}/api/pages/${p.pageId}/blocks`, { headers: H }).then((x) => x.json()).catch(() => ({}));
  return r.blocks ?? [];
}

/** 저장된 진실 — 같은 답이 두 번 연속 나올 때까지 */
async function persisted(p) {
  let prev = null, rows = [];
  for (let i = 0; i < 12; i++) {
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
    if (snap === prev) return rows;
    prev = snap;
  }
  return rows;
}

/** 화면 모양을 한 줄로 — "A@0 B@1" (텍스트가 있으면 텍스트, 없으면 타입) */
const shape = (tree) => tree.map((b) => `${b.text || b.type}@${b.depth}`).join(" ");
/** 저장된 트리를 문서 순서로 — position 은 형제 목록 안에서만 1..n 이라
 *  API 가 주는 순서(평평한 정렬)로는 부모와 자식이 섞인다 */
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

// ── 1. Tab 은 캐럿 위치와 무관하게 블록을 들여쓰고, 캐럿은 그 자리에 남는다 ─────
scenario("tab_caret", async () => {
  const p = await build("tab_caret", [{ k: "A" }, { k: "B", text: "BBBBBB" }]);
  const before = await caret(p.ids.B, 3);
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(400);
  const t = await domTree();
  const c = await caretNow();
  check("Tab: 블록이 한 단 들어간다", shape(t) === "A@0 BBBBBB@1", dump(t));
  check("Tab: 캐럿이 같은 글자에 남는다", c.offset === before.offset && c.inEditable, `우리 ${c.offset} / 노션 ${before.offset}`);
  const rows = await persisted(p);
  check("Tab: 저장에도 부모가 남는다", rows.find((r) => r.key === "B")?.parentKey === "A", JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

// ── 2. 들여쓴 뒤 Enter — 아래로 계속 같은 깊이 ───────────────────────────────
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
  check("Enter: 들여쓴 블록 아래가 계속 같은 깊이", shape(t) === "A@0 B@1 C@1 D@1", dump(t));
  const rows = await persisted(p);
  check("Enter: 저장도 같은 부모", pshape(rows) === "A@0 B@1 C@1 D@1", pshape(rows));
});

// ── 3. 들여쓴 빈 문단에서 Enter — 내어쓰지 않는다(원본과 같음) ───────────────
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
  check("빈 문단 Enter: 같은 깊이의 빈 줄이 하나 더", shape(t) === "A@0 B@1 paragraph@1 paragraph@1", dump(t));
});

// ── 4. 들여쓴 빈 리스트 항목에서 Enter — 한 단 내려가고 리스트를 유지한다 ────
scenario("enter_empty_list", async () => {
  const p = await build("enter_empty_list", [
    { k: "A", type: "bulleted_list", text: "a" },
    { k: "B", type: "bulleted_list", text: "b" },
  ]);
  await caret(p.ids.B, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(250);
  await tab.keyboard.press("Enter"); // 같은 깊이의 빈 항목
  await tab.waitForTimeout(300);
  const mid = await domTree();
  check("빈 항목이 같은 깊이로 생긴다", shape(mid) === "a@0 b@1 bulleted_list@1", dump(mid));
  await tab.keyboard.press("Enter"); // 빈 항목 → 한 단 내림
  await tab.waitForTimeout(400);
  const t = await domTree();
  const empty = t.find((b) => b.text === "");
  check("빈 항목 Enter: 한 단 내려간다", empty?.depth === 0, dump(t));
  check("빈 항목 Enter: 리스트를 유지한다", empty?.type === "bulleted_list", empty?.type ?? "?");
});

// ── 5. 자식 있는 블록 끝에서 Enter — 새 블록이 바로 아래, 자식은 새 블록에게 ──
scenario("enter_with_children", async () => {
  const p = await build("enter_with_children", [{ k: "A" }, { k: "K", parent: "A" }, { k: "Z" }]);
  await caret(p.ids.A, "end");
  await tab.keyboard.press("Enter");
  await tab.keyboard.type("X", { delay: 40 });
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("자식 있는 블록의 Enter: 새 줄이 바로 아래, 자식이 그 아래로", shape(t) === "A@0 X@0 K@1 Z@0", dump(t));
  const rows = await persisted(p);
  const k = rows.find((r) => r.key === "K");
  check("자식의 부모가 새 블록으로 저장된다", k?.parentKey === "NEW", JSON.stringify(rows.map((r) => [r.key, r.parentKey])));
});

// ── 6. 중간 분할에서도 자식은 뒤쪽(새 블록)으로 ─────────────────────────────
scenario("split_with_children", async () => {
  const p = await build("split_with_children", [{ k: "A", text: "AAAA" }, { k: "K", parent: "A" }]);
  await caret(p.ids.A, "mid");
  await tab.keyboard.press("Enter");
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("중간 분할: 앞·뒤 같은 깊이, 자식은 뒤쪽", shape(t) === "AA@0 AA@0 K@1", dump(t));
});

// ── 7~9. Shift+Tab ─────────────────────────────────────────────────────────
scenario("shift_tab_leaf", async () => {
  const p = await build("shift_tab_leaf", [{ k: "A" }, { k: "B", parent: "A" }, { k: "C", parent: "B" }]);
  const before = await caret(p.ids.C, 1);
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(450);
  const t = await domTree();
  const c = await caretNow();
  check("Shift+Tab: 한 단만 내려가고 부모 바로 뒤에 선다", shape(t) === "A@0 B@1 C@1", dump(t));
  check("Shift+Tab: 캐럿이 같은 글자에 남는다", c.offset === before.offset, `우리 ${c.offset} / 노션 ${before.offset}`);
  const rows = await persisted(p);
  const positions = rows.filter((r) => r.parentKey === "A").map((r) => r.position);
  check("Shift+Tab: 형제 position 이 겹치지 않는다", new Set(positions).size === positions.length, JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

scenario("shift_tab_middle_adopts", async () => {
  const p = await build("shift_tab_middle_adopts", [
    { k: "A" }, { k: "B1", parent: "A" }, { k: "B2", parent: "A" }, { k: "B3", parent: "A" },
  ]);
  await caret(p.ids.B2, "end");
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(500);
  const t = await domTree();
 // 원본(T6b): A > B1, 그리고 B2 가 A 옆으로 나오면서 B3 를 자식으로 데려간다
  check("Shift+Tab(가운데 자식): 아래 형제를 자식으로 데려간다", shape(t) === "A@0 B1@1 B2@0 B3@1", dump(t));
  const rows = await persisted(p);
  check("저장도 같은 트리", rows.find((r) => r.key === "B3")?.parentKey === "B2", JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

scenario("shift_tab_with_children", async () => {
  const p = await build("shift_tab_with_children", [{ k: "A" }, { k: "B", parent: "A" }, { k: "C", parent: "B" }]);
  await caret(p.ids.B, "end");
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("Shift+Tab(자식 있음): 자식은 그대로 아래에", shape(t) === "A@0 B@0 C@1", dump(t));
  const rows = await persisted(p);
  const tops = rows.filter((r) => r.parentKey === null).map((r) => r.position);
  check("최상위 position 이 겹치지 않는다", new Set(tops).size === tops.length, JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

// ── 10~12. 맨 앞 Backspace ─────────────────────────────────────────────────
scenario("backspace_indented_paragraph", async () => {
  const p = await build("backspace_indented_paragraph", [{ k: "A" }, { k: "B", parent: "A" }]);
  await caret(p.ids.B, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  const t1 = await domTree();
  check("들여쓴 문단 맨 앞 Backspace: 먼저 한 단 내려간다", shape(t1) === "A@0 B@0", dump(t1));
  await caret(p.ids.B, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  const t2 = await domTree();
  check("깊이 0 에서는 위 블록과 합쳐진다", shape(t2) === "AB@0", dump(t2));
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
  check("들여쓴 리스트 맨 앞 Backspace: 먼저 글머리만 떨어진다", b1?.type === "paragraph" && b1?.depth === 1, dump(t1));
  await caret(p.ids.B, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  const t2 = await domTree();
  check("그다음 한 단 내려간다", t2.find((x) => x.text === "bb")?.depth === 0, dump(t2));
});

scenario("backspace_lifts_children", async () => {
  const p = await build("backspace_lifts_children", [{ k: "A" }, { k: "B" }, { k: "K", parent: "B" }, { k: "Z" }]);
  await caret(p.ids.B, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(500);
  const t = await domTree();
 // 원본(T28): 'AB' 로 합쳐지고 K 는 최상위로 올라와 바로 뒤에 선다
  check("합쳐질 때 자식이 사라지지 않는다", shape(t) === "AB@0 K@0 Z@0", dump(t));
  const rows = await persisted(p);
  check("자식이 고아(보이지 않는 블록)로 남지 않는다", rows.every((r) => r.parentKey === null), JSON.stringify(rows.map((r) => [r.key, r.parentKey])));
});

// ── 13. 거절되는 Tab ───────────────────────────────────────────────────────
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
  check("첫 블록에서 Tab: 아무 일도 없다", shape(await domTree()) === shape(first), dump(await domTree()));
  await caret(p.ids.B, "end");
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(300);
  check("첫 자식에서 Tab: 아무 일도 없다", (await domTree()).find((x) => x.text === "B")?.depth === 1);
  for (const [who, label] of [["PH", "제목"], ["PD", "구분선"], ["PC", "코드"]]) {
    await caret(p.ids[who], "end");
    await tab.keyboard.press("Tab");
    await tab.waitForTimeout(300);
    check(`앞 형제가 ${label}이면 들여쓰지 않는다`, (await domTree()).find((x) => x.text === who)?.depth === 0, dump(await domTree()));
  }
});

// ── 14. 코드 블록의 Tab 은 탭 문자 ─────────────────────────────────────────
scenario("code_tab_inserts_tab", async () => {
  const p = await build("code_tab_inserts_tab", [{ k: "X" }, { k: "C", type: "code", text: "ab" }]);
  await caret(p.ids.C, 0);
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(450);
  const t = await domTree();
  const code = t.find((b) => b.type === "code");
  check("코드 안 Tab: 블록은 그대로", code?.depth === 0, dump(t));
  const text = await tab.evaluate((id) => document.querySelector(`[data-testid="block-editable-${id}"]`)?.innerText ?? "", p.ids.C);
  check("코드 안 Tab: 탭 문자가 들어간다", text.includes("\t"), JSON.stringify(text.slice(0, 12)));
});

// ── 15. 블록(halo) 선택에서 Tab / Shift+Tab — 선택을 유지한다 ──────────────
scenario("halo_tab", async () => {
  const p = await build("halo_tab", [{ k: "H0" }, { k: "H1" }, { k: "H2" }]);
  await caret(p.ids.H1, "end");
  await tab.keyboard.press("Escape");
  await tab.waitForTimeout(200);
  await tab.keyboard.press("Shift+ArrowDown");
  await tab.waitForTimeout(250);
  const sel = (await domTree()).filter((b) => b.selected).map((b) => b.text);
  check("두 블록이 선택된다", sel.join(",") === "H1,H2", JSON.stringify(sel));
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(500);
  const t = await domTree();
  check("블록 선택 Tab: 선택한 블록이 모두 한 단 들어간다", shape(t) === "H0@0 H1@1 H2@1", dump(t));
  check("블록 선택 Tab: 선택이 유지된다", t.filter((b) => b.selected).length === 2, JSON.stringify(t.filter((b) => b.selected).map((b) => b.text)));
  await tab.keyboard.press("Shift+Tab");
  await tab.waitForTimeout(500);
  const t2 = await domTree();
  check("블록 선택 Shift+Tab: 모두 한 단 나온다", shape(t2) === "H0@0 H1@0 H2@0", dump(t2));
  const rows = await persisted(p);
  check("저장도 최상위로 돌아온다", rows.every((r) => r.parentKey === null), JSON.stringify(rows.map((r) => [r.key, r.parentKey])));
});

// ── 16. 두 블록에 걸친 텍스트 선택 + Tab — 둘 다, 선택도 유지 ──────────────
scenario("textsel_tab", async () => {
  const p = await build("textsel_tab", [{ k: "P0" }, { k: "P1" }, { k: "P2" }]);
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
  check("두 블록에 걸친 선택이 만들어졌다", before.selLen > 0, JSON.stringify(before));
  await tab.keyboard.press("Tab");
  await tab.waitForTimeout(600);
  const t = await domTree();
  check("텍스트 선택 Tab: 걸친 블록이 모두 들어간다", shape(t) === "P0@0 P1@1 P2@1", dump(t));
  const after = await caretNow();
  check("텍스트 선택 Tab: 선택이 남는다", after.selLen === before.selLen, `우리 ${after.selLen} / 노션 ${before.selLen}`);
});

// ── 17. 새로 고쳐도 남는다 ─────────────────────────────────────────────────
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
  check("새로 고침 뒤에도 같은 트리", shape(t) === beforeShape && shape(t) === "A@0 B@1 C@1", `${shape(t)} / 저장 전 ${beforeShape}`);
});

// ── 18. 기하와 마커 — 깊이마다 얼마나 들어가고 마커가 어떻게 바뀌나 ──────────
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

 // 문단 사슬 — 한 단 30px (원본 366→396→426…)
  await build("geo_paragraph", chain("paragraph", 4, "P"));
  let r = await boxes();
  check("문단 아래 문단: 한 단 30px", r.map((x) => x.padL).join(",") === "0,30,60,90", JSON.stringify(r.map((x) => x.padL)));

 // 글머리 사슬 — 한 단 32px, 마커 • ◦ ▪ •
  await build("geo_bullet", chain("bulleted_list", 4, "B"));
  r = await boxes();
  check("글머리 아래 글머리: 한 단 32px", r.map((x) => x.padL).join(",") === "0,32,64,96", JSON.stringify(r.map((x) => x.padL)));
  check("글머리 마커가 깊이마다 바뀐다 (•◦▪•)", r.map((x) => x.marker).join("") === "•◦▪•", JSON.stringify(r.map((x) => x.marker)));

 // 번호 사슬 — 마커 1. a. i. 1.
  await build("geo_number", chain("numbered_list", 4, "N"));
  r = await boxes();
  check("번호 마커가 깊이마다 바뀐다 (1. a. i. 1.)", r.map((x) => x.marker).join(" ") === "1. a. i. 1.", JSON.stringify(r.map((x) => x.marker)));

 // 문단 밑의 글머리는 여전히 • (주기는 같은 종류 리스트 조상 수로 센다 — T21)
  await build("geo_bullet_under_paragraph", [{ k: "P" }, { k: "B", type: "bulleted_list", parent: "P" }]);
  r = await boxes();
  check("문단 밑 글머리 마커는 •", r[1].marker === "•", JSON.stringify(r.map((x) => [x.type, x.marker, x.padL])));
  check("문단 밑 글머리도 한 단 30px", r[1].padL === 30, JSON.stringify(r.map((x) => x.padL)));

 // 토글 자식은 토글 텍스트와 같은 x = 박스에서 32px, 그 아래는 다시 30px
  await build("geo_toggle", [{ k: "T", type: "toggle" }, { k: "C1", parent: "T" }, { k: "C2", parent: "C1" }]);
  r = await boxes();
  const d = (i) => +(r[i].absL - r[0].absL).toFixed(1);
  check("토글 자식: 박스에서 32px", d(1) === 32, `${d(1)} (기대 32)`);
  check("토글 손자: 거기서 다시 30px", d(2) === 62, `${d(2)} (기대 62)`);
});

// ── 19. 맨 앞 Backspace 정책 — 원본과 같은 순서 ────────────────────────────
scenario("backspace_policy", async () => {
 // (a) 제목은 스타일을 벗지 않고 **한 번에** 위 블록과 합쳐진다 (A_heading*)
  let p = await build("bs_heading", [{ k: "P", text: "PREV" }, { k: "H", type: "heading2", text: "XX" }]);
  await caret(p.ids.H, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  check("제목 맨 앞 Backspace: 한 번에 합쳐진다", shape(await domTree()) === "PREVXX@0", dump(await domTree()));

 // (b) 인용·글머리·번호·할 일·토글은 먼저 스타일만 벗는다 (A_quote / A_bulleted_list …)
  for (const [type, label] of [["quote", "인용"], ["bulleted_list", "글머리"], ["numbered_list", "번호"], ["todo", "할 일"], ["toggle", "토글"]]) {
    p = await build(`bs_${type}`, [{ k: "P", text: "PREV" }, { k: "B", type, text: "XX" }]);
    await caret(p.ids.B, 0);
    await tab.keyboard.press("Backspace");
    await tab.waitForTimeout(400);
    const t1 = await domTree();
    check(`${label} 맨 앞 Backspace: 먼저 스타일만 벗는다`, shape(t1) === "PREV@0 XX@0" && t1[1].type === "paragraph", dump(t1));
    await caret(p.ids.B, 0);
    await tab.keyboard.press("Backspace");
    await tab.waitForTimeout(400);
    check(`${label}: 그다음 합쳐진다`, shape(await domTree()) === "PREVXX@0", dump(await domTree()));
  }

 // (c) 코드 블록은 아무 일도 없다 (A_codetext)
  p = await build("bs_code", [{ k: "P", text: "PREV" }, { k: "C", type: "code", text: "QQ" }]);
  await caret(p.ids.C, 0);
  const beforeCode = shape(await domTree());
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(400);
  check("코드 맨 앞 Backspace: 아무 일도 없다", shape(await domTree()) === beforeCode, dump(await domTree()));

 // (d) 페이지 첫 블록은 텍스트가 **제목으로** 간다 (B_*: 블록이 사라지고 제목이 늘어난다)
  p = await build("bs_title", [{ k: "A", text: "ZZTOP" }, { k: "B", text: "keep" }]);
  const titleBefore = await tab.inputValue('[data-testid="page-title"]');
  await caret(p.ids.A, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(600);
  const t = await domTree();
  check("첫 블록 맨 앞 Backspace: 블록이 사라진다", shape(t) === "keep@0", dump(t));
  check("첫 블록 맨 앞 Backspace: 텍스트가 제목에 붙는다",
    (await tab.inputValue('[data-testid="page-title"]')) === titleBefore + "ZZTOP",
    `"${await tab.inputValue('[data-testid="page-title"]')}" (전 "${titleBefore}")`);
  const rows = await persisted(p);
  check("제목 병합이 저장된다", rows.length === 1 && rows[0].key === "B", JSON.stringify(rows.map((r) => [r.key, r.text])));

 // (e) ⌘Z 한 번이 제목과 블록을 함께 되돌린다 (원본 M4 실측)
  await tab.keyboard.press("Control+z");
  await tab.waitForTimeout(600);
  check("⌘Z: 블록이 돌아온다", shape(await domTree()) === "ZZTOP@0 keep@0", dump(await domTree()));
  check("⌘Z: 제목도 함께 돌아온다",
    (await tab.inputValue('[data-testid="page-title"]')) === titleBefore,
    `"${await tab.inputValue('[data-testid="page-title"]')}" (기대 "${titleBefore}")`);
});

// ── 20. 맨 앞 Backspace의 남은 경우들 ─────────────────────────────────────
scenario("backspace_edges", async () => {
 // 토글의 첫 자식은 내어쓰기가 아니라 토글 제목으로 접힌다 (2026-08-26 toggle/enter_backspace)
  let p = await build("bs_toggle_kid", [
    { k: "T", type: "toggle", text: "TT" },
    { k: "K", parent: "T", text: "KK" },
  ]);
  await caret(p.ids.K, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  check("토글 첫 자식의 Backspace: 제목으로 접힌다", shape(await domTree()) === "TTKK@0", dump(await domTree()));

 // 빈 첫 블록은 제목으로 옮길 것이 없다 — 아무 일도 없어야 한다
  p = await build("bs_empty_first", [{ k: "A", text: "" }, { k: "B", text: "keep" }]);
  const titleBefore = await tab.inputValue('[data-testid="page-title"]');
  await caret(p.ids.A, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(450);
  check("빈 첫 블록: 제목이 그대로", (await tab.inputValue('[data-testid="page-title"]')) === titleBefore,
    `"${await tab.inputValue('[data-testid="page-title"]')}"`);

 // 첫 블록에 자식이 있으면 자식은 그 자리(맨 앞)로 올라온다
  p = await build("bs_first_kids", [{ k: "A", text: "AA" }, { k: "K", parent: "A", text: "KK" }, { k: "Z", text: "ZZ" }]);
  await caret(p.ids.A, 0);
  await tab.keyboard.press("Backspace");
  await tab.waitForTimeout(600);
  check("첫 블록의 자식은 그 자리로 올라온다", shape(await domTree()) === "KK@0 ZZ@0", dump(await domTree()));
});

// ── 접힌 토글 — 2026-09-10 3차 실측 (scratchpad/nind-M7·M8·M10.jsonl) ──────
// 원본에서 잰 네 가지:
//  M7 S2  앞 형제가 접힌 토글일 때 Tab → 토글이 **펴지고** 그 마지막 자식이 된다
//  M7 S1  접힌 토글 제목 끝 Enter → **형제 토글**이 생기고 숨은 자식은 그대로
//  M10 D1 접힌 토글 제목 가운데 Enter → 토글 둘로 갈라지고 자식은 **앞쪽**에 남는다
//  M7 S3  자식을 못 받는 타입(제목)에서 Shift+Tab → 뒤 형제를 **안 데려간다**
//  M8 S5  접힌 토글에서 Shift+Tab → 뒤 형제를 **데려간다**(접힌 채라 안 보인다)
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
  check("접힌 토글로 Tab: 토글이 펴지고 마지막 자식이 된다", shape(t) === "TG@0 KK@1 XX@1", dump(t));
  const c = await caretNow();
  check("접힌 토글로 Tab: 캐럿이 살아 있다", c && !c.none && c.offset === 2, JSON.stringify(c));
  const rows = await persisted(p);
  check("저장도 같은 트리", pshape(rows) === "TG@0 KK@1 XX@1", JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
  const saved = await blocksOf(p);
  check("저장된 토글이 펴져 있다", saved.find((b) => b.id === p.ids.TG)?.content?.expanded === true,
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
  check("접힌 토글에서 Enter: 숨은 자식이 새어 나오지 않는다", shape(t) === "TG@0 NN@0", dump(t));
  check("접힌 토글에서 Enter: 새 줄도 토글", t.find((b) => b.text === "NN")?.type === "toggle", dump(t));
  const rows = await persisted(p);
  check("저장: 자식은 토글 안에 그대로", rows.find((r) => r.key === "K")?.parentKey === "TG",
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
  check("제목은 뒤 형제를 데려가지 않는다", shape(t) === "AA@0 BB@1 HH@0", dump(t));
  const rows = await persisted(p);
  check("저장도 같은 트리", pshape(rows) === "AA@0 BB@1 HH@0", JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
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
  check("접힌 토글은 뒤 형제를 데려가고 접힌 채로 있다", shape(t) === "AA@0 TG@0", dump(t));
  const rows = await persisted(p);
  check("저장: 뒤 형제가 토글의 자식", rows.find((r) => r.key === "B")?.parentKey === "TG",
    JSON.stringify(rows.map((r) => [r.key, r.parentKey, r.position])));
});

// ── 실행 ───────────────────────────────────────────────────────────────────
const names = Object.keys(scenarios).filter((n) => !ONLY.length || ONLY.includes(n));
for (const n of names) {
  console.log(`\n── ${n} ─────────────────────────────`);
  try {
    await scenarios[n]();
  } catch (e) {
    check(`${n}: 시나리오가 끝까지 돌지 않았습니다`, false, String(e).slice(0, 200));
  }
}

if (pageErrors.length) check(`콘솔 에러 ${pageErrors.length}건`, false, pageErrors.slice(0, 2).join(" / ").slice(0, 200));
await browser.close();
for (const id of createdPages) {
  await fetch(`${BASE}/api/pages/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ isArchived: true }) }).catch(() => {});
}

if (fails) {
  console.error(`\n  ┌─ 들여쓰기가 원본과 다릅니다 (${fails}건) ─────────────`);
  console.error("  │ 기대값 출처: docs/notion-indent.md (2026-09-10 실측)");
  console.error("  └──────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`\n들여쓰기 — 원본과 같습니다 (시나리오 ${names.length}개).`);
