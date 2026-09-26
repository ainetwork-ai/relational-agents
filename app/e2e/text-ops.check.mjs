// Text CRDT stage 3 ② — measures the server applier and validation through the API (docs/text-crdt-design.md §2, §5, §9-2).
//
//   [BASE_URL=…] [USER_ID=…] node e2e/text-ops.check.mjs
//
// Creates a page, seeds html into one block, then via POST /api/saveTransactions:
//   1. two clients insert after the same character at once (2 parallel requests) → the server text converges to one by the RGA rules
//   2. deleteText / annotate → text/html caches match items
//   3. moveTextSlice → cut and move into a new block (the server side of Enter), ids kept
//   4. validation: unknown origin → 422 + rejectedIds, stale instance → 422, move into another page's block → 422
//   5. idempotency: resending the same transaction → 200, text unchanged
//   6. table cell path: insert via cellItems → cells/html caches updated
// Deletes the pages it created. Dev DB only.
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
check("seeded block has an instance and items", typeof inst === "string" && Array.isArray(seeded.content.items) && seeded.content.items[0]?.text === "AB", JSON.stringify(seeded.content.items));
const A = ["m", 1], Bc = ["m", 2];

// ── 1. Concurrent insert → convergence ─────────────────────────────────────────────────
{
  const r = await Promise.all([
    send([tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c1", 5], origin: Bc, text: "x"  }] })])], "c1"),
    send([tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c2", 3], origin: Bc, text: "y"  }] })])], "c2"),
  ]);
  const b = await block(B1);
  check("1. two clients insert at once → 200/200, text ABxy (larger seq first)", r[0].ok() && r[1].ok() && b.content.text === "ABxy", `${r[0].status()}/${r[1].status()} text=${JSON.stringify(b.content.text)} html=${JSON.stringify(b.content.html)}`);
  // continue x's run: origin = x, seq 6 → merges into one run "xz"
  await send([tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c1", 6], origin: ["c1", 5], text: "z"  }] })])], "c1");
  const b2 = await block(B1);
  check("1. continue typing → ABxzy, runs merged", b2.content.text === "ABxzy" && b2.content.items.some((it) => it.id[0] === "c1" && it.text === "xz"), `${b2.content.text} items=${b2.content.items.length}`);
}

// ── 2. deleteText / annotate → caches ───────────────────────────────────
{
  await send([tx([textOp("deleteText", B1, { instance: inst, ranges: [[A, 1]] })])]);
  let b = await block(B1);
  check("2. delete A → text Bxzy, tombstone stays in items", b.content.text === "Bxzy" && b.content.items.some((it) => it.deleted), `${b.content.text}`);
  await send([tx([textOp("annotate", B1, { instance: inst, ranges: [[Bc, 1], [["c1", 5], 2]], key: "b", ts: 1, by: "c1" })])]);
  b = await block(B1);
  check("2. bold B·xz → html <b>Bxz</b>y", b.content.html === "<b>Bxz</b>y", b.content.html);
  await send([tx([textOp("annotate", B1, { instance: inst, ranges: [[["c1", 6], 1]], key: "b", off: true, ts: 2, by: "c1" })])]);
  b = await block(B1);
  check("2. unformat z → <b>Bx</b>zy", b.content.html === "<b>Bx</b>zy", b.content.html);
  await send([tx([textOp("deleteText", B1, { instance: inst, ranges: [[["nobody", 99], 3]] })])]);
  check("2. deleting an unknown id is ignored (200)", (await block(B1)).content.html === "<b>Bx</b>zy");
}

// ── 3. moveTextSlice → new block (Enter) ──────────────────────────────────
{
  const newInst = "n" + uuid().slice(0, 8);
  const r = await send([
    tx([
      { command: "set", pointer: { table: "block", id: B2 }, path: [], args: { id: B2, type: "paragraph", content: { text: "", html: "", textInstance: newInst, items: [] }, parentBlockId: null, position: 1.5 } },
      textOp("moveTextSlice", B1, { instance: inst, from: ["c1", 6], toBlock: B2, toPath: ["content", "items"], toInstance: newInst, toOrigin: "start" }),
    ], "Text.handleEnter"),
  ]);
  const b1 = await block(B1), b2 = await block(B2);
  check("3. from z into a new block → B1 <b>Bx</b>, B2 zy", r.ok() && b1.content.html === "<b>Bx</b>" && b2.content.text === "zy", `${r.status()} b1=${b1.content.html} b2=${JSON.stringify(b2.content.text)}`);
  check("3. moved item keeps its id, first item origin=start", b2.content.items?.[0]?.id?.[0] === "c1" && b2.content.items[0].id[1] === 6 && b2.content.items[0].origin === "start", JSON.stringify(b2.content.items));
  // a late insert naming the moved character resolves in B2 — the id followed it
  const r2 = await send([tx([textOp("insertText", B2, { instance: newInst, items: [{ id: ["c2", 20], origin: ["c1", 6], text: "!"  }] })])], "c2");
  check("3. insert with the moved character as origin → B2 z!y", r2.ok() && (await block(B2)).content.text === "z!y", (await block(B2)).content.text);
}

// ── 4. Validation ─────────────────────────────────────────────────────────────
{
  const bad = tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c3", 50], origin: ["ghost", 1], text: "?"  }] })]);
  const r = await send([bad], "c3");
  const body = await r.json();
  check("4. unknown origin → 422 + rejectedIds", r.status() === 422 && Array.isArray(body.rejectedIds) && body.rejectedIds.includes(bad.id), `${r.status()} ${JSON.stringify(body).slice(0, 120)}`);
  const stale = tx([textOp("insertText", B1, { instance: "stale-instance", items: [{ id: ["c3", 51], origin: "start", text: "?"  }] })]);
  const r2 = await send([stale], "c3");
  check("4. stale instance → 422", r2.status() === 422 && (await r2.json()).rejectedIds?.includes(stale.id), `${r2.status()}`);
  const cross = tx([textOp("moveTextSlice", B1, { instance: inst, from: Bc, toBlock: OTHER, toPath: ["content", "items"], toInstance: "whatever", toOrigin: "start" })]);
  const r3 = await send([cross]);
  check("4. move into another page's block → 422, source unchanged", r3.status() === 422 && (await block(B1)).content.html === "<b>Bx</b>", `${r3.status()} ${(await block(B1)).content.html}`);
  // a wholesale write starts a new instance; the old one is refused afterwards
  await send([tx([{ command: "update", pointer: { table: "block", id: B1 }, path: [], args: { content: { text: "fresh", html: "fresh" } } }])]);
  const fresh = await block(B1);
  const r4 = await send([tx([textOp("insertText", B1, { instance: inst, items: [{ id: ["c1", 70], origin: "start", text: "?"  }] })])]);
  check("4. new instance after a wholesale replace, ops on the old instance → 422", fresh.content.textInstance !== inst && fresh.content.text === "fresh" && r4.status() === 422, `${fresh.content.textInstance?.slice(0, 6)}≠${inst.slice(0, 6)} ${r4.status()}`);
}

// ── 5. Idempotency ─────────────────────────────────────────────────────────────
{
  const cur = await block(B1);
  const t = tx([textOp("insertText", B1, { instance: cur.content.textInstance, items: [{ id: ["c1", 80], origin: "start", text: ">"  }] })]);
  const a = await send([t]);
  const b = await send([t]);
  const after = await block(B1);
  check("5. same transaction twice → 200/200, text >fresh only once", a.ok() && b.ok() && after.content.text === ">fresh", `${a.status()}/${b.status()} ${after.content.text}`);
}

// ── 6. Table cells ────────────────────────────────────────────────────────────
{
  const t = await block(T1);
  const cellInst = t.content.table.cellItems?.[1]?.[0]?.instance;
  check("6. an instance per table cell", typeof cellInst === "string", JSON.stringify(t.content.table.cellItems?.[1]?.[0]));
  const cpath = ["content", "table", "cellItems", 1, 0];
  await send([tx([textOp("insertText", T1, { instance: cellInst, items: [{ id: ["c1", 9], origin: ["m", 1], text: "!" }] }, cpath)])]);
  const r = await send([tx([textOp("annotate", T1, { instance: cellInst, ranges: [[["c1", 9], 1]], key: "b", ts: 1, by: "c1" }, cpath)])]);
  const t2 = await block(T1);
  check("6. insert ! in cell (1,0) then bold → cells c!, html c<b>!</b>", r.ok() && t2.content.table.cells[1][0] === "c!" && t2.content.table.html?.[1]?.[0] === "c<b>!</b>", `${r.status()} ${JSON.stringify(t2.content.table.cells[1])} ${JSON.stringify(t2.content.table.html?.[1])}`);
}

await api.delete(`${BASE}/api/pages/${pageId}`);
await api.delete(`${BASE}/api/pages/${otherPageId}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(" | ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
