// 텍스트 CRDT 라이브러리 검사 — docs/text-crdt-design.md §8, §12.
//
//   POSTGRES_URL=… npx tsx --tsconfig scripts/tsconfig.json scripts/text-crdt.check.mts
//   HTML_FILE=/path/one-html-per-line.txt npx tsx … scripts/text-crdt.check.mts
//
// 1. 정규형 C(h)=render(parse(h)) 가 (a) 멱등이고 (b) h 와 글자·태그 집합(DOM)이 같은가.
//    마크 모델은 태그 중첩 순서를 정규화하므로 바이트 동일이 아니라 "글자마다 태그 집합 동일"이 기준이다.
// 2. RGA 수렴: 세 클라이언트의 동시 삽입·삭제를 임의 순서로 적용해도 같은 텍스트
// 3. run 합치기
// 4. 마크(서식) 수렴: 굵게 vs 굵게해제 동시 → ts LWW 로 하나로, 범위 안 삽입은 서식 상속
import fs from "node:fs";
import { integrate, mergeRuns, tombstone } from "@/lib/text-crdt/rga";
import { parseHtml, itemsFromText, renderHtml, renderText, tagToMark } from "@/lib/text-crdt/html";
import { resolveFormats, formatsAt, anchorBefore, charPosOf } from "@/lib/text-crdt/marks";
import type { Mark, TextItem, ItemId } from "@/lib/text-crdt/types";
import { sanitizeInline } from "@/lib/rich-text";

let fails = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

// 글자마다 (문자, 태그 집합) — DOM 동등 비교용. 태그 집합은 정렬해 순서 무시.
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

// ── 1. 왕복: 샘플 ──────────────────────────────────────────────────────
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
  check(`정규형: ${JSON.stringify(s).slice(0, 60)}`, r.ok, r.ok ? undefined : `got ${JSON.stringify(r.c)}`);
}
check("text 캐시: br → \\n", renderText(parseHtml("a<br />b", "m").items) === "a\nb");
check("plain text → items → text", renderText(itemsFromText("한 줄\n둘", "m").items) === "한 줄\n둘");
check("이모지 길이 UTF-16", parseHtml("A😀B", "m").items[0].text.length === 4);

// ── 1b. 왕복: DB 또는 파일의 모든 html ──────────────────────────────────
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
  check(`정규형: 저장된 html ${htmls.length}건 전부 글자·태그집합 보존 + 멱등`, bad === 0, bad ? `${bad} broken; e.g. ${ex.join(" | ")}` : `${htmls.length} ok, ${changed} normalised (same DOM)`);
}

// ── 2. RGA 수렴 ─────────────────────────────────────────────────────────
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
  check("RGA 수렴: 임의 순서 결과가 하나", results.size === 1, [...results].join(" | "));
  check("RGA 결과: QByxz (Q 는 삭제된 A 뒤, y·x 는 seq 동률 clientId 큰 쪽 먼저, z 는 x 뒤)", [...results][0] === "QByxz", [...results][0]);
}

// ── 3. run 합치기 ─────────────────────────────────────────────────────
{
  const items: TextItem[] = [];
  let origin: ItemId | "start" = "start";
  for (let i = 1; i <= 13; i++) { integrate(items, { id: ["k", i], origin, text: String.fromCharCode(64 + i) }); origin = ["k", i]; }
  check("13 글자 → 1 조각", items.length === 1 && items[0].text.length === 13, `${items.length}`);
  tombstone(items, ["k", 5], 2);
  check("가운데 2 글자 삭제 → 3 조각, 텍스트 11", items.length === 3 && renderText(items).length === 11, `${items.length}/${renderText(items).length}`);
  integrate(items, { id: ["c9", 14], origin: ["k", 6], text: "*" });
  check("삭제된 글자 뒤 삽입 → 그 자리", renderText(items) === "ABCD*GHIJKLM", renderText(items));
}

// ── 4. 마크(서식) 수렴 ──────────────────────────────────────────────────
function markRange(items: TextItem[], from: ItemId, count: number, key: string, ts: number, by: string, off?: true): Mark {
  const pos = charPosOf(items, from);
  return { key, start: anchorBefore(items, pos), end: anchorBefore(items, pos + count), ts, by, ...(off ? { off: true } : {}) };
}
{
  // "ABC" 전체를 굵게(ts1) 하고, 같은 범위를 굵게해제(ts2) — 나중 것이 이긴다
  const items = parseHtml("ABC", "m").items;
  const A: ItemId = ["m", 1];
  const boldOn = markRange(items, A, 3, "b", 1, "c1");
  const boldOff = markRange(items, A, 3, "b", 2, "c2", true);
  const r1 = renderHtml(items, [boldOn, boldOff]);
  const r2 = renderHtml(items, [boldOff, boldOn]); // 순서 바꿔도
  check("마크 LWW: 굵게(ts1)+해제(ts2) → 순서 무관 해제 승", r1 === "ABC" && r2 === "ABC", `${r1} | ${r2}`);
  const r3 = renderHtml(items, [boldOff, { ...boldOn, ts: 3 }]); // 다시 굵게가 최신
  check("마크 LWW: 최신 굵게 승", r3 === "<b>ABC</b>", r3);
}
{
  // 굵은 "AB" 의 A|B 사이에 글자 삽입 → 물려받는가 (범위 안이므로 굵게)
  const items = parseHtml("AB", "m").items;
  const A: ItemId = ["m", 1], B: ItemId = ["m", 2];
  const bold = markRange(items, A, 2, "b", 1, "c1"); // start before A, end before (after B) = "end"
  integrate(items, { id: ["c1", 5], origin: A, text: "m" }); // A m B
  check("범위 안 삽입 → 서식 상속 (AmB 모두 굵게)", renderHtml(items, [bold]) === "<b>AmB</b>", renderHtml(items, [bold]));
  // 범위 오른쪽 끝(B 뒤)에 삽입 → end 가 before-next(여기선 end) 이므로 상속
  const items2 = parseHtml("AB", "m").items;
  const bold2: Mark = { key: "b", start: anchorBefore(items2, 0), end: "end", ts: 1, by: "c1" };
  integrate(items2, { id: ["c1", 6], origin: B, text: "C" }); // AB C
  check("범위 끝에 이어치기 → 상속 (ABC 굵게)", renderHtml(items2, [bold2]) === "<b>ABC</b>", renderHtml(items2, [bold2]));
  // 범위 왼쪽(A 앞)에 삽입 → start 가 before-A 이므로 제외
  const items3 = parseHtml("AB", "m").items;
  const bold3: Mark = { key: "b", start: { id: A, side: "before" }, end: "end", ts: 1, by: "c1" };
  integrate(items3, { id: ["c1", 7], origin: "start", text: "Z" }); // Z A B
  check("범위 앞에 삽입 → 제외 (Z 는 안 굵게)", renderHtml(items3, [bold3]) === "Z<b>AB</b>", renderHtml(items3, [bold3]));
}
{
  // 링크(값 있는 마크) 왕복
  const h = '<a href="https://x.io">site</a>';
  const p = parseHtml(h, "m");
  check("링크 마크: value 로 왕복", renderHtml(p.items, p.marks) === h, renderHtml(p.items, p.marks));
  check("링크 tagToMark key 안정", tagToMark('<a href="https://x.io">').key === tagToMark('<a href="https://x.io">').key);
}

console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
