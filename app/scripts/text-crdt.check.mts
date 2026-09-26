// Text CRDT library checks — docs/text-crdt-design.md §8, §12.
//
//   POSTGRES_URL=… npx tsx --tsconfig scripts/tsconfig.json scripts/text-crdt.check.mts
//   HTML_FILE=/path/one-html-per-line.txt npx tsx … scripts/text-crdt.check.mts
//
// 1. Is the normal form C(h)=render(parse(h)) (a) idempotent and (b) equal to h in characters and tag sets (DOM)?
//    The mark model normalises tag nesting order, so the bar is not byte equality but "same tag set per character".
// 2. RGA convergence: concurrent inserts/deletes from three clients applied in any order give the same text
// 3. merging runs
// 4. Mark (formatting) convergence: concurrent bold vs unbold → one result by ts LWW; inserts inside a range inherit the format
import fs from "node:fs";
import { integrate, mergeRuns, tombstone } from "@/lib/text-crdt/rga";
import { parseHtml, itemsFromText, renderHtml, renderText, tagToMark } from "@/lib/text-crdt/html";
import { resolveFormats, formatsAt, anchorBefore, charPosOf } from "@/lib/text-crdt/marks";
import type { Mark, TextItem, ItemId } from "@/lib/text-crdt/types";
import { sanitizeInline } from "@/lib/rich-text";
import { TEXT_CRDT_CHECK as C } from "@/i18n/content/scripts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

// (character, tag set) per character — for DOM equality. Tag sets are sorted so order is ignored.
function charTagSet(html: string): string {
  const { items, marks } = parseHtml(html, "m");
  const fmt = resolveFormats(items, marks);
  const out: [string, string][] = [];
  let cu = 0;
  for (const it of items) {
    if (it.br) { out.push(["\n", "br"]); cu += it.text.length; continue; }
    for (const ch of it.text) {
      const set = fmt[cu] ? formatsAt(fmt[cu]).map((f) => f.key + (f.value ?? "")).sort() : [];
      out.push([ch, set.join("|")]);
      cu += ch.length;
    }
  }
  return JSON.stringify(out);
}
const same = (h: string) => {
  const p = parseHtml(h, "m");
  const c = renderHtml(p.items, p.marks);
  const p2 = parseHtml(c, "m");
  const c2 = renderHtml(p2.items, p2.marks);
  return { ok: charTagSet(c) === charTagSet(h) && c2 === c, c };
};

// ── 1. Round trip: samples ─────────────────────────────────────────────
const samples = [
  "plain",
  "<b>bold</b> and <i>it</i>",
  "<b><i>bi</i></b><strong>s</strong>",
  "a<br />b<br>c",
  "x &quot;q&quot; &amp; it's &gt; y",
  '<a href="https://x.y/?a=1&amp;b=2">l</a>',
  '<a href="/p/abc" class="mention" data-mention-type="page" data-mention-id="abc">@Page</a> tail',
  '<span class="mention" data-mention-type="person" data-mention-id="u1">@Kim</span>',
  '<span class="eq" data-tex="x^2">$x^2$</span>',
  "<code>a &lt; b</code><u>u</u><s>s</s>",
  "trailing<br /><br />",
  "A😀B漢字",
  "",
];
for (const h of samples) {
  const s = sanitizeInline(h);
  const r = same(s);
  check(`normal form: ${JSON.stringify(s).slice(0, 60)}`, r.ok, r.ok ? undefined : `got ${JSON.stringify(r.c)}`);
}
check("text cache: br → \\n", renderText(parseHtml("a<br />b", "m").items) === "a\nb");
check("plain text → items → text", renderText(itemsFromText(C.twoLines, "m").items) === C.twoLines);
check("emoji length UTF-16", parseHtml("A😀B", "m").items[0].text.length === 4);

// ── 1b. Round trip: every html in the DB or a file ─────────────────────
async function allHtml(): Promise<string[]> {
  if (process.env.HTML_FILE) return fs.readFileSync(process.env.HTML_FILE, "utf8").split("\n").filter((l) => l.length);
  const { db } = await import("@/lib/db");
  const { blocks } = await import("@/lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const rows = await db.select({ html: sql<string>`${blocks.content}->>'html'` }).from(blocks).where(eq(blocks.alive, true));
  return rows.map((r) => r.html).filter((h): h is string => typeof h === "string");
}
{
  const htmls = await allHtml();
  let bad = 0, changed = 0;
  const ex: string[] = [];
  for (const h of htmls) {
    const r = same(h);
    if (!r.ok) { bad++; if (ex.length < 3) ex.push(`${JSON.stringify(h).slice(0, 90)} → ${JSON.stringify(r.c).slice(0, 90)}`); }
    else if (r.c !== h) changed++;
  }
  check(`normal form: all ${htmls.length} stored html keep characters and tag sets + idempotent`, bad === 0, bad ? `${bad} broken; e.g. ${ex.join(" | ")}` : `${htmls.length} ok, ${changed} normalised (same DOM)`);
}

// ── 2. RGA convergence ─────────────────────────────────────────────────
type Op = { kind: "ins"; item: TextItem } | { kind: "del"; from: ItemId; count: number };
const applyOp = (items: TextItem[], op: Op) => (op.kind === "ins" ? integrate(items, op.item) : tombstone(items, op.from, op.count));
function shuffle<T>(a: T[], seed: number): T[] {
  const out = [...a]; let s = seed;
  for (let i = out.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
{
  const base = parseHtml("AB", "m").items;
  const B: ItemId = ["m", 2], A: ItemId = ["m", 1];
  const ops: Op[] = [
    { kind: "ins", item: { id: ["c1", 1], origin: B, text: "x" } },
    { kind: "ins", item: { id: ["c2", 1], origin: B, text: "y" } },
    { kind: "ins", item: { id: ["c3", 7], origin: A, text: "Q" } },
    { kind: "ins", item: { id: ["c1", 2], origin: ["c1", 1], text: "z" } },
    { kind: "del", from: A, count: 1 },
  ];
  const results = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const order = shuffle(ops, seed);
    if (order.indexOf(ops[3]) < order.indexOf(ops[0])) continue;
    const items = base.map((x) => ({ ...x }));
    for (const op of order) applyOp(items, op);
    results.add(renderText(items));
  }
  check("RGA convergence: any order gives one result", results.size === 1, [...results].join(" | "));
  check("RGA result: QByxz (Q after the deleted A, y·x tie on seq so larger clientId first, z after x)", [...results][0] === "QByxz", [...results][0]);
}

// ── 3. Merging runs ───────────────────────────────────────────────────
{
  const items: TextItem[] = [];
  let origin: ItemId | "start" = "start";
  for (let i = 1; i <= 13; i++) { integrate(items, { id: ["k", i], origin, text: String.fromCharCode(64 + i) }); origin = ["k", i]; }
  check("13 characters → 1 piece", items.length === 1 && items[0].text.length === 13, `${items.length}`);
  tombstone(items, ["k", 5], 2);
  check("delete 2 characters in the middle → 3 pieces, text 11", items.length === 3 && renderText(items).length === 11, `${items.length}/${renderText(items).length}`);
  integrate(items, { id: ["c9", 14], origin: ["k", 6], text: "*" });
  check("insert after a deleted character → lands in place", renderText(items) === "ABCD*GHIJKLM", renderText(items));
}

// ── 4. Mark (formatting) convergence ───────────────────────────────────
function markRange(items: TextItem[], from: ItemId, count: number, key: string, ts: number, by: string, off?: true): Mark {
  const pos = charPosOf(items, from);
  return { key, start: anchorBefore(items, pos), end: anchorBefore(items, pos + count), ts, by, ...(off ? { off: true } : {}) };
}
{
  // Bold all of "ABC" (ts1), and unbold the same range (ts2) — the later one wins
  const items = parseHtml("ABC", "m").items;
  const A: ItemId = ["m", 1];
  const boldOn = markRange(items, A, 3, "b", 1, "c1");
  const boldOff = markRange(items, A, 3, "b", 2, "c2", true);
  const r1 = renderHtml(items, [boldOn, boldOff]);
  const r2 = renderHtml(items, [boldOff, boldOn]); // even with the order swapped
  check("mark LWW: bold(ts1)+unbold(ts2) → unbold wins regardless of order", r1 === "ABC" && r2 === "ABC", `${r1} | ${r2}`);
  const r3 = renderHtml(items, [boldOff, { ...boldOn, ts: 3 }]); // bold again is the latest
  check("mark LWW: latest bold wins", r3 === "<b>ABC</b>", r3);
}
{
  // Insert a character between A|B of bold "AB" → does it inherit (inside the range, so bold)
  const items = parseHtml("AB", "m").items;
  const A: ItemId = ["m", 1], B: ItemId = ["m", 2];
  const bold = markRange(items, A, 2, "b", 1, "c1"); // start before A, end before (after B) = "end"
  integrate(items, { id: ["c1", 5], origin: A, text: "m" }); // A m B
  check("insert inside range → inherits format (AmB all bold)", renderHtml(items, [bold]) === "<b>AmB</b>", renderHtml(items, [bold]));
  // Insert at the range's right end (after B) → end is before-next (here "end"), so it inherits
  const items2 = parseHtml("AB", "m").items;
  const bold2: Mark = { key: "b", start: anchorBefore(items2, 0), end: "end", ts: 1, by: "c1" };
  integrate(items2, { id: ["c1", 6], origin: B, text: "C" }); // AB C
  check("typing on at the range end → inherits (ABC bold)", renderHtml(items2, [bold2]) === "<b>ABC</b>", renderHtml(items2, [bold2]));
  // Insert left of the range (before A) → start is before-A, so excluded
  const items3 = parseHtml("AB", "m").items;
  const bold3: Mark = { key: "b", start: { id: A, side: "before" }, end: "end", ts: 1, by: "c1" };
  integrate(items3, { id: ["c1", 7], origin: "start", text: "Z" }); // Z A B
  check("insert before range → excluded (Z not bold)", renderHtml(items3, [bold3]) === "Z<b>AB</b>", renderHtml(items3, [bold3]));
}
{
  // Link (a mark with a value) round trip
  const h = '<a href="https://x.io">site</a>';
  const p = parseHtml(h, "m");
  check("link mark: round trip via value", renderHtml(p.items, p.marks) === h, renderHtml(p.items, p.marks));
  check("link tagToMark key is stable", tagToMark('<a href="https://x.io">').key === tagToMark('<a href="https://x.io">').key);
}

console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
