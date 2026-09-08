// 텍스트 CRDT 라이브러리 검사 — docs/text-crdt-design.md §8 의 "캐시" 기준.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/text-crdt.check.mts            # 단위 + dev DB 왕복
//   HTML_FILE=/path/one-html-per-line.txt npx tsx … scripts/text-crdt.check.mts   # 파일(prod 덤프)로 왕복
//
// 1. 정규형 C(h) = render(parse(h)) 가 (a) 멱등이고 (b) h 와 글자·태그 열이 같은가 (샘플 + DB 의 모든 블록).
//    바이트 동일은 목표가 아니다: 저장된 html 에는 &quot; 와 " 가 섞여 있고 </b><b> 처럼 같은 태그가 붙어
//    있는 것도 있어, C 는 그것을 한 표기로 모은다(DOM 이 보여주는 것은 같다).
// 2. RGA 수렴: 세 클라이언트의 동시 삽입·삭제를 임의 순서로 적용해도 같은 텍스트인가
// 3. run 합치기: 글자 단위로 넣은 것이 한 조각이 되는가
import fs from "node:fs";
import { integrate, mergeRuns, tombstone, retag } from "@/lib/text-crdt/rga";
import type { TextItem, ItemId } from "@/lib/text-crdt/types";
import { itemsFromHtml, itemsFromText, renderHtml, renderText } from "@/lib/text-crdt/html";
import { sanitizeInline } from "@/lib/rich-text";

let fails = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
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
  "",
];
const chars = (h: string) => JSON.stringify(itemsFromHtml(h, "m").flatMap((it) => [...it.text].map((ch) => [ch, it.br ? "br" : it.tags.join("")])));
const same = (h: string) => { const c = renderHtml(itemsFromHtml(h, "m")); return { ok: chars(c) === chars(h) && renderHtml(itemsFromHtml(c, "m")) === c, c }; };
for (const h of samples) {
  const s = sanitizeInline(h);
  const r = same(s);
  check(`정규형: ${JSON.stringify(s).slice(0, 60)}`, r.ok, r.ok ? undefined : `got ${JSON.stringify(r.c)}`);
}
check("text 캐시: br → \\n", renderText(itemsFromHtml("a<br />b", "m")) === "a\nb");
check("plain text → items → text", renderText(itemsFromText("한 줄\n둘", "m")) === "한 줄\n둘");

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
  let bad = 0;
  const examples: string[] = [];
  let changed = 0;
  for (const h of htmls) {
    const r = same(h);
    if (!r.ok) {
      bad++;
      if (examples.length < 3) examples.push(`${JSON.stringify(h).slice(0, 100)} → ${JSON.stringify(r.c).slice(0, 100)}`);
    } else if (r.c !== h) changed++;
  }
  check(`정규형: 저장된 html ${htmls.length}건 전부 글자·태그 보존 + 멱등`, bad === 0, bad ? `${bad} broken; e.g. ${examples.join(" | ")}` : `${htmls.length} ok, ${changed} normalised (same DOM)`);
}

// ── 2. RGA 수렴 ─────────────────────────────────────────────────────────
type Op = { kind: "ins"; item: TextItem } | { kind: "del"; from: ItemId; count: number };
function apply(items: TextItem[], op: Op) {
  if (op.kind === "ins") integrate(items, op.item);
  else tombstone(items, op.from, op.count);
}
function shuffle<T>(a: T[], seed: number): T[] {
  const out = [...a];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
{
  // base "AB" by m; three clients insert concurrently after B and after A, one deletes A
  const base = itemsFromHtml("AB", "m");
  const B: ItemId = ["m", 2], A: ItemId = ["m", 1];
  const ops: Op[] = [
    { kind: "ins", item: { id: ["c1", 1], origin: B, text: "x", tags: [] } },
    { kind: "ins", item: { id: ["c2", 1], origin: B, text: "y", tags: [] } },
    { kind: "ins", item: { id: ["c3", 7], origin: A, text: "Q", tags: ["<b>"] } },
    { kind: "ins", item: { id: ["c1", 2], origin: ["c1", 1], text: "z", tags: [] } }, // continues x
    { kind: "del", from: A, count: 1 },
  ];
  // dependency-respecting orders only: an op that continues another must come after it
  const results = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const order = shuffle(ops, seed);
    const idx = (k: Op) => order.indexOf(k);
    if (idx(ops[3]) < idx(ops[0])) continue;
    const items = base.map((x) => ({ ...x, tags: [...x.tags] }));
    for (const op of order) apply(items, op);
    results.add(renderHtml(items));
  }
  check("RGA 수렴: 임의 순서 적용 결과가 하나", results.size === 1, [...results].join(" | "));
  const only = [...results][0];
  check("RGA 결과: x 는 y 앞(seq 같음 → clientId 큰 쪽 앞)이고 z 는 x 뒤", only === "<b>Q</b>Byxz" || only === "<b>Q</b>Bxzy", only);
}

// ── 3. run 합치기 ─────────────────────────────────────────────────────
{
  const items: TextItem[] = [];
  let origin: ItemId | "start" = "start";
  for (let i = 1; i <= 13; i++) {
    integrate(items, { id: ["k", i], origin, text: String.fromCharCode(64 + i), tags: [] });
    origin = ["k", i];
  }
  check("13 글자 → 1 조각", items.length === 1 && items[0].text.length === 13, `${items.length} items`);
  // a tombstone in the middle splits the run into three; merging keeps the count minimal
  tombstone(items, ["k", 5], 2);
  check("가운데 2 글자 삭제 → 3 조각, 텍스트 11 글자", items.length === 3 && renderText(items).length === 11, `${items.length}/${renderText(items).length}`);
  retag(items, ["k", 1], 3, ["<b>"]);
  check("앞 3 글자 굵게 → html", renderHtml(mergeRuns(items)) === "<b>ABC</b>DGHIJKLM", renderHtml(mergeRuns(items)));
  // an insert whose origin is a tombstoned character still lands right after it
  // (seq is a Lamport clock: above everything this client has seen → 14)
  integrate(items, { id: ["c9", 14], origin: ["k", 6], text: "*", tags: [] });
  check("삭제된 글자 뒤 삽입 → 그 자리", renderText(items) === "ABCD*GHIJKLM", renderText(items));
}

console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
