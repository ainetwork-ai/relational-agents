// 에디터 diff → 연산 (docs/text-crdt-design.md §3.2) 단위 검사.
//   npx tsx --tsconfig scripts/tsconfig.json scripts/text-edit.check.mts
//
// computeTextOps(이전 instance, 새 html) 가 낸 연산을 서버 적용기로 두 번(로컬·원격) 적용해도
// 새 html 과 같은 렌더가 나오는지, 그리고 연산이 최소한인지(한 글자 입력 = insertText 1개)를 잰다.
import { instanceFromContent } from "@/lib/text-crdt/content";

import { renderHtml, renderText } from "@/lib/text-crdt/html";
import { applyTextOp } from "@/lib/text-crdt/ops";
import { computeTextOps, nextSeqFor } from "@/lib/editor/text-edit";
import type { TextInstance } from "@/lib/text-crdt/types";
import { sanitizeInline } from "@/lib/rich-text";

let fails = 0;
const check = (name: string, ok: boolean, detail?: string) => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) fails++; };
const PATH = ["content", "items"] as const;

// 이전 html 에서 시작해 새 html 로 편집했다고 두고, 연산을 계산·적용해 결과 html 을 확인
function edit(fromHtml: string, toHtml: string, clientId = "c1"): { ops: number; html: string; text: string; inst: TextInstance } {
  const inst0 = instanceFromContent(undefined, sanitizeInline(fromHtml));
  const seq = nextSeqFor(inst0.items, clientId);
  const { ops, instance } = computeTextOps(inst0, sanitizeInline(toHtml), "B", PATH as never, clientId, seq);
  // 서버가 받은 것처럼, 같은 연산을 이전 instance 에 다시 적용(원격 복제) → 같은 결과여야
  let remote = { textInstance: inst0.instance, items: inst0.items.map((i) => ({ ...i })), marks: (inst0.marks ?? []).map((m) => ({ ...m })) } as never;
  for (const o of ops) remote = applyTextOp(remote, o as never) as never;
  const localHtml = renderHtml(instance.items, instance.marks);
  const remoteHtml = renderHtml((remote as { items: never[] }).items, (remote as { marks: never[] }).marks);
  check(`  local==remote for "${fromHtml}"→"${toHtml}"`, localHtml === remoteHtml, `${localHtml} | ${remoteHtml}`);
  return { ops: ops.length, html: localHtml, text: renderText(instance.items), inst: instance };
}
function expect(name: string, fromHtml: string, toHtml: string, wantHtml: string, wantOps?: number) {
  const r = edit(fromHtml, toHtml);
  check(name, r.html === sanitizeInline(wantHtml) && (wantOps === undefined || r.ops === wantOps), `html=${r.html} ops=${r.ops}`);
}

// ── 삽입·삭제 ────────────────────────────────────────────────────────────
expect("한 글자 끝에 입력 → insertText 1", "AB", "ABc", "ABc", 1);
expect("한 글자 중간에 입력", "AB", "AxB", "AxB", 1);
expect("맨 앞에 입력 (origin=start)", "AB", "xAB", "xAB", 1);
expect("한 글자 삭제 → deleteText 1", "ABC", "AC", "AC", 1);
expect("선택 후 교체 → delete+insert", "ABC", "AxC", "AxC", 2);
expect("전부 지움", "ABC", "", "", 1);
expect("빈 곳에 입력", "", "hi", "hi", 1);
expect("이모지 입력", "AB", "A😀B", "A😀B", 1);
expect("한글 입력", "가나", "가다나", "가다나", 1);

// ── 서식 ────────────────────────────────────────────────────────────────
expect("굵게 (범위 annotate)", "ABC", "A<b>B</b>C", "A<b>B</b>C");
expect("굵게 해제", "A<b>B</b>C", "ABC", "ABC");
expect("굵은 글 끝에 이어치기 → 상속 유지", "<b>AB</b>", "<b>ABC</b>", "<b>ABC</b>");
expect("링크 추가", "site", '<a href="https://x.io">site</a>', '<a href="https://x.io">site</a>');
expect("이탤릭 + 굵게 겹침", "abc", "a<b><i>b</i></b>c", "a<b><i>b</i></b>c");

// ── 최소성: 여러 글자 연속 입력을 한 번에 반영 ──────────────────────────────
{
  // 세 글자를 한 번에(붙여넣기처럼) → insertText 1 (run)
  const r = edit("X", "Xabc");
  check("붙여넣기 3글자 → insertText 1", r.ops === 1 && r.text === "Xabc", `ops=${r.ops} text=${r.text}`);
}

// ── 순차 편집: a 치고 b 치고 → 서버가 순서대로 받아 수렴 ─────────────────────
{
  let inst = instanceFromContent(undefined, "");
  let server = { textInstance: inst.instance, items: [] as never[], marks: [] as never[] } as never;
  let text = "";
  for (const ch of "hello") {
    const seq = nextSeqFor(inst.items, "c1");
    const nextText = text + ch;
    const { ops, instance } = computeTextOps(inst, nextText, "B", PATH as never, "c1", seq);
    for (const o of ops) server = applyTextOp(server, o as never) as never;
    inst = instance; text = nextText;
  }
  check("순차 5글자 → 서버 'hello'", renderText((server as { items: never[] }).items) === "hello", renderText((server as { items: never[] }).items));
}


// ── 표 셀: block-diff 가 셀 편집을 셀 경로 연산으로 ────────────────────────
{
  const { diffBlocks } = await import("@/lib/editor/block-diff");
  const { withTextInstance } = await import("@/lib/text-crdt/content");
  const tracked = withTextInstance({ table: { cells: [["a", "b"], ["c", "d"]], headerRow: false } } as never) as { table: { cells: string[][]; cellItems: { instance: string }[][] } };
  const old = { id: "T", type: "table", parentBlockId: null, position: 1, content: tracked } as never;
  const nb = JSON.parse(JSON.stringify(tracked)); nb.table.cells[0][0] = "aX";
  const { ops, patches } = diffBlocks([old], [{ ...(old as object), content: nb }] as never, "c1");
  check("표: 한 셀 편집 → 셀 경로 insertText 1", ops.length === 1 && (ops[0] as { command: string }).command === "insertText" && (ops[0] as { path: (string|number)[] }).path.join(",") === "content,table,cellItems,0,0", `${ops.length} ${JSON.stringify((ops[0] as { path?: unknown })?.path)}`);
  let sc = JSON.parse(JSON.stringify(tracked));
  for (const op of ops) sc = applyTextOp(sc, op as never);
  check("표: 서버 적용 후 그 셀만 aX", sc.table.cells[0][0] === "aX" && sc.table.cells[0][1] === "b" && sc.table.cells[1][1] === "d", JSON.stringify(sc.table.cells));
  check("표: 바뀐 셀만 새 instance", (patches.get("T") as unknown as { table: { cellItems: { instance: string }[][] } }).table.cellItems[0][1].instance === tracked.table.cellItems[0][1].instance);
  const struct = JSON.parse(JSON.stringify(tracked)); struct.table.cells.push(["e", "f"]);
  const r3 = diffBlocks([old], [{ ...(old as object), content: struct }] as never, "c1");
  check("표: 행 추가(구조) → 통짜 update", r3.ops.every((o) => (o as { command: string }).command === "update"));
}

console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
