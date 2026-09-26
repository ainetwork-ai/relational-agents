// Unit checks for editor diff → ops (docs/text-crdt-design.md §3.2).
//   npx tsx --tsconfig scripts/tsconfig.json scripts/text-edit.check.mts
//
// Checks that the ops produced by computeTextOps(previous instance, new html), applied twice
// (local and remote) through the server applier, render the same as the new html, and that the
// ops are minimal (typing one character = 1 insertText).
import { instanceFromContent } from "@/lib/text-crdt/content";

import { renderHtml, renderText } from "@/lib/text-crdt/html";
import { applyTextOp } from "@/lib/text-crdt/ops";
import { computeTextOps, nextSeqFor } from "@/lib/editor/text-edit";
import type { TextInstance } from "@/lib/text-crdt/types";
import { sanitizeInline } from "@/lib/rich-text";
import { TEXT_EDIT_CHECK as C } from "@/i18n/content/scripts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: string) => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) fails++; };
const PATH = ["content", "items"] as const;

// Treat it as an edit from the previous html to the new html, compute and apply the ops, and check the resulting html
function edit(fromHtml: string, toHtml: string, clientId = "c1"): { ops: number; html: string; text: string; inst: TextInstance } {
  const inst0 = instanceFromContent(undefined, sanitizeInline(fromHtml));
  const seq = nextSeqFor(inst0.items, clientId);
  const { ops, instance } = computeTextOps(inst0, sanitizeInline(toHtml), "B", PATH as never, clientId, seq);
  // As if the server received them, apply the same ops to the previous instance again (remote replica) → must give the same result
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

// ── Insert / delete ─────────────────────────────────────────────────────
expect("type one character at the end → insertText 1", "AB", "ABc", "ABc", 1);
expect("type one character in the middle", "AB", "AxB", "AxB", 1);
expect("type at the very start (origin=start)", "AB", "xAB", "xAB", 1);
expect("delete one character → deleteText 1", "ABC", "AC", "AC", 1);
expect("replace a selection → delete+insert", "ABC", "AxC", "AxC", 2);
expect("delete everything", "ABC", "", "", 1);
expect("type into empty", "", "hi", "hi", 1);
expect("type an emoji", "AB", "A😀B", "A😀B", 1);
expect("type Hangul", C.hangulBefore, C.hangulAfter, C.hangulAfter, 1);

// ── Formatting ──────────────────────────────────────────────────────────
expect("bold (annotate range)", "ABC", "A<b>B</b>C", "A<b>B</b>C");
expect("unbold", "A<b>B</b>C", "ABC", "ABC");
expect("typing on at the end of bold text → keeps inheriting", "<b>AB</b>", "<b>ABC</b>", "<b>ABC</b>");
expect("add link", "site", '<a href="https://x.io">site</a>', '<a href="https://x.io">site</a>');
expect("italic + bold overlap", "abc", "a<b><i>b</i></b>c", "a<b><i>b</i></b>c");

// ── Minimality: several characters typed at once are applied together ──────
{
  // three characters at once (like a paste) → insertText 1 (run)
  const r = edit("X", "Xabc");
  check("paste 3 characters → insertText 1", r.ops === 1 && r.text === "Xabc", `ops=${r.ops} text=${r.text}`);
}

// ── Sequential edits: type a, then b → the server receives them in order and converges ──
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
  check("5 sequential characters → server 'hello'", renderText((server as { items: never[] }).items) === "hello", renderText((server as { items: never[] }).items));
}


// ── Table cells: block-diff turns a cell edit into a cell-path op ──────────
{
  const { diffBlocks } = await import("@/lib/editor/block-diff");
  const { withTextInstance } = await import("@/lib/text-crdt/content");
  const tracked = withTextInstance({ table: { cells: [["a", "b"], ["c", "d"]], headerRow: false } } as never) as { table: { cells: string[][]; cellItems: { instance: string }[][] } };
  const old = { id: "T", type: "table", parentBlockId: null, position: 1, content: tracked } as never;
  const nb = JSON.parse(JSON.stringify(tracked)); nb.table.cells[0][0] = "aX";
  const { ops, patches } = diffBlocks([old], [{ ...(old as object), content: nb }] as never, "c1");
  check("table: edit one cell → cell-path insertText 1", ops.length === 1 && (ops[0] as { command: string }).command === "insertText" && (ops[0] as { path: (string|number)[] }).path.join(",") === "content,table,cellItems,0,0", `${ops.length} ${JSON.stringify((ops[0] as { path?: unknown })?.path)}`);
  let sc = JSON.parse(JSON.stringify(tracked));
  for (const op of ops) sc = applyTextOp(sc, op as never);
  check("table: after server apply only that cell is aX", sc.table.cells[0][0] === "aX" && sc.table.cells[0][1] === "b" && sc.table.cells[1][1] === "d", JSON.stringify(sc.table.cells));
  check("table: only the changed cell gets a new instance", (patches.get("T") as unknown as { table: { cellItems: { instance: string }[][] } }).table.cellItems[0][1].instance === tracked.table.cellItems[0][1].instance);
  const struct = JSON.parse(JSON.stringify(tracked)); struct.table.cells.push(["e", "f"]);
  const r3 = diffBlocks([old], [{ ...(old as object), content: struct }] as never, "c1");
  check("table: add a row (structure) → whole update", r3.ops.every((o) => (o as { command: string }).command === "update"));
}

console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
