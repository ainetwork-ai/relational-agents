// 텍스트 CRDT 3단계 ② — 서버 적용기와 검증을 API 로 잰다 (docs/text-crdt-design.md §2, §5, §9-2).
//
//   [BASE_URL=…] [USER_ID=…] node e2e/text-ops.check.mjs
//
// 페이지를 만들고 블록 하나에 html 을 심은 뒤 POST /api/saveTransactions 로:
//   1. 두 클라이언트가 같은 글자 뒤에 동시에 삽입(요청 2개 병렬) → 서버 텍스트가 RGA 규칙대로 하나로 수렴
//   2. deleteText / formatText → text·html 캐시가 items 와 일치
//   3. moveTextSlice → 새 블록으로 잘라 옮기기 (Enter 의 서버 쪽), id 유지
//   4. 검증: 없는 origin → 422 + rejectedIds, 옛 instance → 422, 다른 페이지 블록으로 move → 422
//   5. 멱등: 같은 트랜잭션 재전송 → 200, 텍스트 불변
//   6. 표 셀 경로: cellItems 로 삽입 → cells/html 캐시 갱신
// 만든 페이지는 지운다. dev DB 전용.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails.push(name);
};
const uuid = () => crypto.randomUUID();

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const api = ctx.request;

const pageId = (await (await api.post(`${BASE}/api/pages`, { data: { title: "text-ops.check" } })).json()).page.id;
const otherPageId = (await (await api.post(`${BASE}/api/pages`, { data: { title: "text-ops.check other" } })).json()).page.id;
const B1 = uuid(), B2 = uuid(), T1 = uuid(), OTHER = uuid();
await api.put(`${BASE}/api/pages/${pageId}/blocks`, {
  data: {
    blocks: [
      { id: B1, type: "paragraph", position: 1, parentBlockId: null, content: { text: "AB", html: "AB" } },
      { id: T1, type: "table", position: 2, parentBlockId: null, content: { table: { cells: [["a", "b"], ["c", "d"]], headerRow: false } } },
    ],
    deletedIds: [],
  },
});
await api.put(`${BASE}/api/pages/${otherPageId}/blocks`, {
  data: { blocks: [{ id: OTHER, type: "paragraph", position: 1, parentBlockId: null, content: { text: "other", html: "other" } }], deletedIds: [] },
});

const blocksOf = async (pid = pageId) => (await (await api.get(`${BASE}/api/pages/${pid}/blocks`)).json()).blocks;
const block = async (id, pid = pageId) => (await blocksOf(pid)).find((b) => b.id === id);
const send = (transactions, clientId = "c1") =>
  api.post(`${BASE}/api/saveTransactions`, { data: { requestId: uuid(), transactions }, headers: { "x-client-id": clientId } });
const tx = (operations, action = "check") => ({ id: uuid(), pageId, timestamp: Date.now(), debug: { userAction: action, clientCommitTimeMs: Date.now() }, operations });
const textOp = (command, blockId, args, path = ["content", "items"]) => ({ command, pointer: { table: "block", id: blockId }, path, args });

// the seeded block carries an instance built from "AB": items [{id:["m",1], text:"AB"}]
const seeded = await block(B1);
const inst = seeded.content.textInstance;
check("씨앗 블록에 instance 와 items 가 있다", typeof inst === "string" && Array.isArray(seeded.content.items) && seeded.content.items[0]?.text === "AB", JSON.stringify(seeded.content.items));
const A = ["m", 1], Bc = ["m", 2];

// ── 1. 동시 삽입 → 수렴 ─────────────────────────────────────────────────
{
  const r = await Promise.all([
    send([tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c1", 5], origin: Bc, text: "x", tags: [] }] })])], "c1"),
    send([tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c2", 3], origin: Bc, text: "y", tags: [] }] })])], "c2"),
  ]);
  const b = await block(B1);
  check("1. 두 클라이언트 동시 삽입 → 200/200, 텍스트 ABxy (seq 큰 쪽 앞)", r[0].ok() && r[1].ok() && b.content.text === "ABxy", `${r[0].status()}/${r[1].status()} text=${JSON.stringify(b.content.text)} html=${JSON.stringify(b.content.html)}`);
  // continue x's run: origin = x, seq 6 → merges into one run "xz"
  await send([tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c1", 6], origin: ["c1", 5], text: "z", tags: [] }] })])], "c1");
  const b2 = await block(B1);
  check("1. 이어 치기 → ABxzy, run 합침", b2.content.text === "ABxzy" && b2.content.items.some((it) => it.id[0] === "c1" && it.text === "xz"), `${b2.content.text} items=${b2.content.items.length}`);
}

// ── 2. deleteText / formatText → 캐시 ───────────────────────────────────
{
  await send([tx([textOp("deleteText", B1, { instance: inst, ranges: [[A, 1]] })])]);
  let b = await block(B1);
  check("2. A 삭제 → text Bxzy, tombstone 은 items 에 남음", b.content.text === "Bxzy" && b.content.items.some((it) => it.deleted), `${b.content.text}`);
  await send([tx([textOp("formatText", B1, { instance: inst, ranges: [[Bc, 1], [["c1", 5], 2]], tags: ["<b>"] })])]);
  b = await block(B1);
  check("2. B·xz 굵게 → html <b>Bxz</b>y", b.content.html === "<b>Bxz</b>y", b.content.html);
  await send([tx([textOp("formatText", B1, { instance: inst, ranges: [[["c1", 6], 1]], tags: [] })])]);
  b = await block(B1);
  check("2. z 서식 해제 → <b>Bx</b>zy", b.content.html === "<b>Bx</b>zy", b.content.html);
  await send([tx([textOp("deleteText", B1, { instance: inst, ranges: [[["nobody", 99], 3]] })])]);
  check("2. 없는 id 삭제는 무시(200)", (await block(B1)).content.html === "<b>Bx</b>zy");
}

// ── 3. moveTextSlice → 새 블록 (Enter) ──────────────────────────────────
{
  const newInst = "n" + uuid().slice(0, 8);
  const r = await send([
    tx([
      { command: "set", pointer: { table: "block", id: B2 }, path: [], args: { id: B2, type: "paragraph", content: { text: "", html: "", textInstance: newInst, items: [] }, parentBlockId: null, position: 1.5 } },
      textOp("moveTextSlice", B1, { instance: inst, from: ["c1", 6], toBlock: B2, toPath: ["content", "items"], toInstance: newInst, toOrigin: "start" }),
    ], "Text.handleEnter"),
  ]);
  const b1 = await block(B1), b2 = await block(B2);
  check("3. z 부터 새 블록으로 → B1 <b>Bx</b>, B2 zy", r.ok() && b1.content.html === "<b>Bx</b>" && b2.content.text === "zy", `${r.status()} b1=${b1.content.html} b2=${JSON.stringify(b2.content.text)}`);
  check("3. 옮긴 item 의 id 유지, 첫 item origin=start", b2.content.items?.[0]?.id?.[0] === "c1" && b2.content.items[0].id[1] === 6 && b2.content.items[0].origin === "start", JSON.stringify(b2.content.items));
  // a late insert naming the moved character resolves in B2 — the id followed it
  const r2 = await send([tx([textOp("insertText", B2, { instance: newInst, items: [{ id: ["c2", 20], origin: ["c1", 6], text: "!", tags: [] }] })])], "c2");
  check("3. 옮겨진 글자를 origin 으로 하는 삽입 → B2 z!y", r2.ok() && (await block(B2)).content.text === "z!y", (await block(B2)).content.text);
}

// ── 4. 검증 ─────────────────────────────────────────────────────────────
{
  const bad = tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c3", 50], origin: ["ghost", 1], text: "?", tags: [] }] })]);
  const r = await send([bad], "c3");
  const body = await r.json();
  check("4. 없는 origin → 422 + rejectedIds", r.status() === 422 && Array.isArray(body.rejectedIds) && body.rejectedIds.includes(bad.id), `${r.status()} ${JSON.stringify(body).slice(0, 120)}`);
  const stale = tx([textOp("insertText", B1, { instance: "stale-instance", items: [{ id: ["c3", 51], origin: "start", text: "?", tags: [] }] })]);
  const r2 = await send([stale], "c3");
  check("4. 옛 instance → 422", r2.status() === 422 && (await r2.json()).rejectedIds?.includes(stale.id), `${r2.status()}`);
  const cross = tx([textOp("moveTextSlice", B1, { instance: inst, from: Bc, toBlock: OTHER, toPath: ["content", "items"], toInstance: "whatever", toOrigin: "start" })]);
  const r3 = await send([cross]);
  check("4. 다른 페이지 블록으로 move → 422, 원본 불변", r3.status() === 422 && (await block(B1)).content.html === "<b>Bx</b>", `${r3.status()} ${(await block(B1)).content.html}`);
  // a wholesale write starts a new instance; the old one is refused afterwards
  await send([tx([{ command: "update", pointer: { table: "block", id: B1 }, path: [], args: { content: { text: "fresh", html: "fresh" } } }])]);
  const fresh = await block(B1);
  const r4 = await send([tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c1", 70], origin: "start", text: "?", tags: [] }] })])]);
  check("4. 전체 교체 뒤 새 instance, 옛 instance 연산은 422", fresh.content.textInstance !== inst && fresh.content.text === "fresh" && r4.status() === 422, `${fresh.content.textInstance?.slice(0, 6)}≠${inst.slice(0, 6)} ${r4.status()}`);
}

// ── 5. 멱등 ─────────────────────────────────────────────────────────────
{
  const cur = await block(B1);
  const t = tx([textOp("insertText", B1, { instance: cur.content.textInstance, items: [{ id: ["c1", 80], origin: "start", text: ">", tags: [] }] })]);
  const a = await send([t]);
  const b = await send([t]);
  const after = await block(B1);
  check("5. 같은 트랜잭션 2회 → 200/200, 텍스트 >fresh 한 번만", a.ok() && b.ok() && after.content.text === ">fresh", `${a.status()}/${b.status()} ${after.content.text}`);
}

// ── 6. 표 셀 ────────────────────────────────────────────────────────────
{
  const t = await block(T1);
  const cellInst = t.content.table.cellItems?.[1]?.[0]?.instance;
  check("6. 표 셀마다 instance", typeof cellInst === "string", JSON.stringify(t.content.table.cellItems?.[1]?.[0]));
  const r = await send([tx([textOp("insertText", T1, { instance: cellInst, items: [{ id: ["c1", 9], origin: ["m", 1], text: "!", tags: ["<b>"] }] }, ["content", "table", "cellItems", 1, 0])])]);
  const t2 = await block(T1);
  check("6. 셀 (1,0) 에 굵은 ! 삽입 → cells c!, html c<b>!</b>", r.ok() && t2.content.table.cells[1][0] === "c!" && t2.content.table.html?.[1]?.[0] === "c<b>!</b>", `${r.status()} ${JSON.stringify(t2.content.table.cells[1])} ${JSON.stringify(t2.content.table.html?.[1])}`);
}

await api.delete(`${BASE}/api/pages/${pageId}`);
await api.delete(`${BASE}/api/pages/${otherPageId}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(" | ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
