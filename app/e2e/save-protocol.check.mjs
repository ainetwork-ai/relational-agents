// Save protocol stage 1 — measures the criteria in docs/save-protocol-target.md §7 on dev.
//
//   [BASE_URL=…] [USER_ID=…] node e2e/save-protocol.check.mjs
//
// Creates a page of 227 Hangul paragraphs (≈65KB, the same size as the page the incident happened on) and:
//   1. one character → request ≤ 2KB, first request when idle ≤ 100ms, 1 in flight
//   2. rapid typing while awaiting a response → next request 450~700ms after the response, several transactions batched
//   3. 5 keystrokes offline → IndexedDB Transaction ≥ 5, `offline` badge, retry every 5.0±0.7s with the same ids,
//      back online → 0 rows, badge gone, everything reaches the server
//   4. the same request twice → 1 block (idempotent)
//   5. close the tab 10ms after typing → a new tab lands it on the server within ≤ 20s (Notion: a live tab recovers it 13.6s after close)
// Deletes the page it made at the end. dev DB only.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import { content } from "./i18n.mjs";

const C = content.SAVE_PROTOCOL;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const api = ctx.request;
await ctx.addInitScript(() => {
  window.__marks = [];
  const mark = (k) => window.__marks.push([k, performance.now()]);
  document.addEventListener("input", () => mark("input"), true);
  const of = window.fetch;
  window.fetch = function (u) { if (String(u).endsWith("/api/saveTransactions")) mark("fetch"); return of.apply(this, arguments); };
});

// ── Page setup: 227 paragraphs ≈ 65KB ───────────────────────────────────────
const created = await api.post(`${BASE}/api/pages`, { data: { title: `save-protocol.check ${new Date().toISOString()}` } });
if (!created.ok()) throw new Error(`create page ${created.status()} ${await created.text()}`);
const pageId = (await created.json()).page?.id ?? (await created.json()).id;
const filler = C.filler;
const bigBlocks = Array.from({ length: 227 }, (_, i) => ({
  id: uuid(), type: "paragraph", position: i + 1, parentBlockId: null,
  content: { text: `${i + 1}. ${filler.repeat(3)}`, html: `${i + 1}. ${filler.repeat(3)}` },
}));
const seeded = await api.put(`${BASE}/api/pages/${pageId}/blocks`, { data: { blocks: bigBlocks, deletedIds: [] } });
if (!seeded.ok()) throw new Error(`seed ${seeded.status()}`);
const seedBytes = Buffer.byteLength(JSON.stringify({ blocks: bigBlocks }));
console.log(`page ${pageId}: ${bigBlocks.length} blocks, whole-page payload would be ${seedBytes} bytes`);

const serverText = async () => (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks;
const idbCount = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("TransactionStore");
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("Transaction")) return res(0); const c = db.transaction("Transaction").objectStore("Transaction").count(); c.onsuccess = () => { res(c.result); db.close(); }; };
  r.onerror = () => res(-1);
}));

function watch(page) {
  const events = [];
  page.on("request", (r) => { if (/\/api\/saveTransactions$/.test(r.url()) && r.method() === "POST") events.push({ kind: "req", t: Date.now(), bytes: Buffer.byteLength(r.postData() ?? ""), txs: JSON.parse(r.postData() ?? "{}").transactions?.map((x) => x.id) ?? [] }); });
  page.on("response", (r) => { if (/\/api\/saveTransactions$/.test(r.url())) events.push({ kind: "res", t: Date.now(), status: r.status() }); });
  page.on("requestfailed", (r) => { if (/\/api\/saveTransactions$/.test(r.url())) events.push({ kind: "fail", t: Date.now(), txs: JSON.parse(r.postData() ?? "{}").transactions?.map((x) => x.id) ?? [] }); });
  return events;
}
async function openEditor(page) {
  await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction((id) => window.__editorReady === id, pageId, { timeout: 120_000 });
  await page.waitForTimeout(800);
}
async function focusLast(page) {
  const last = page.locator('[data-testid^="block-editable-"]').last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await page.evaluate(() => { const el = document.activeElement; if (!el) return; const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); });
}

if (!process.env.ONLY6) {
// ── 1·2. size · latency · batching ─────────────────────────────────────────
const p1 = await ctx.newPage();
const ev1 = watch(p1);
await openEditor(p1);
await focusLast(p1);
await sleep(1500); // idle
await p1.evaluate(() => { window.__marks = []; });
await p1.keyboard.type("A");
await sleep(1200);
const first = ev1.find((e) => e.kind === "req");
check("1. one character → request ≤ 2KB (regardless of the 65KB document)", !!first && first.bytes <= 2048, first ? `${first.bytes} bytes` : "no request");
const marks = await p1.evaluate(() => window.__marks);
const inputAt = marks.find(([k]) => k === "input")?.[1];
const fetchAt = marks.find(([k]) => k === "fetch")?.[1];
// On this 227-block page the number includes React's synchronous re-render:
// the IndexedDB completion event (store first, then send — Notion's order,
// measured at 4.7ms) only fires after it. That render cost is the typing-lag
// item, not the queue's; it is reported here and judged on a small page below.
console.log(`  · 227-block page input → fetch: ${inputAt !== undefined && fetchAt !== undefined ? Math.round(fetchAt - inputAt) + "ms" : JSON.stringify(marks)} (includes re-render — the baseline for the typing-lag item)`);

// rapid typing while awaiting a response: right after the first key, 4 keys 20ms apart
ev1.length = 0;
await p1.keyboard.type("B");
await sleep(5);
for (const ch of "CDEF") { await p1.keyboard.type(ch); await sleep(20); }
await sleep(2500);
const reqs = ev1.filter((e) => e.kind === "req");
const ress = ev1.filter((e) => e.kind === "res");
const second = reqs[1];
const firstRes = ress[0];
check("2. next request 450~700ms after the response", !!second && !!firstRes && second.t - firstRes.t >= 450 && second.t - firstRes.t <= 700, second && firstRes ? `${second.t - firstRes.t}ms` : `${reqs.length} reqs`);
check("2. next request batches transactions (≥2)", !!second && second.txs.length >= 2, second ? `${second.txs.length} txs` : "");
let overlap = 0, inflight = 0;
for (const e of ev1) { if (e.kind === "req") { if (inflight > 0) overlap++; inflight++; } else inflight = Math.max(0, inflight - 1); }
check("1. 1 request in flight", overlap === 0, `${overlap} overlapping`);
await sleep(1200);
{
  const rows = await serverText();
  const last = rows.sort((a, b) => a.position - b.position).at(-1);
  check("2. everything reaches the server (ABCDEF)", (last?.content?.text ?? "").endsWith("ABCDEF"), (last?.content?.text ?? "").slice(-12));
}

// ── 1c. the queue's own latency: input → fetch on a 2-block page ────────────
{
  const c = await api.post(`${BASE}/api/pages`, { data: { title: "save-protocol.check small" } });
  const smallId = (await c.json()).page.id;
  await api.put(`${BASE}/api/pages/${smallId}/blocks`, { data: { blocks: [{ id: uuid(), type: "paragraph", position: 1, parentBlockId: null, content: { text: C.smallPage, html: C.smallPage } }], deletedIds: [] } });
  const ps = await ctx.newPage();
  await ps.goto(`${BASE}/p/${smallId}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await ps.waitForFunction((id) => window.__editorReady === id, smallId, { timeout: 120_000 });
  await ps.waitForTimeout(800);
  await focusLast(ps);
  await sleep(1500);
  await ps.evaluate(() => { window.__marks = []; });
  await ps.keyboard.type("A");
  await sleep(1200);
  const m = await ps.evaluate(() => window.__marks);
  const i = m.find(([k]) => k === "input")?.[1], f = m.find(([k]) => k === "fetch")?.[1];
  check("1. idle input → fetch ≤ 50ms (2-block page, after the IndexedDB write completes)", i !== undefined && f !== undefined && f - i <= 50, i !== undefined && f !== undefined ? `${Math.round(f - i)}ms` : JSON.stringify(m));
  await ps.close();
  await api.delete(`${BASE}/api/pages/${smallId}`);
}

// ── 3. offline ────────────────────────────────────────────────────────────
ev1.length = 0;
await ctx.setOffline(true);
await sleep(300);
for (const ch of "12345") { await p1.keyboard.type(ch); await sleep(60); }
await sleep(1500);
check("3. 5 keystrokes offline → IndexedDB ≥ 5", (await idbCount(p1)) >= 5, `${await idbCount(p1)} rows`);
await p1.waitForSelector('[data-testid="offline-badge"]', { timeout: 8000 }).catch(() => null);
check("3. `offline` badge", await p1.locator('[data-testid="offline-badge"]').count() === 1);
await sleep(11_000);
const failsEv = ev1.filter((e) => e.kind === "fail");
const gaps = failsEv.slice(1).map((e, i) => e.t - failsEv[i].t);
check("3. retry every 5.0±0.7s", gaps.length >= 1 && gaps.every((g) => g >= 4300 && g <= 5700), `gaps ${gaps.join(",")}ms`);
check("3. retries carry the same transaction ids (all ids of the previous attempt)", failsEv.length >= 2 && failsEv[0].txs.every((id) => failsEv[1].txs.includes(id)), `${failsEv[0]?.txs.length}→${failsEv[1]?.txs.length}`);
await ctx.setOffline(false);
await p1.waitForFunction(() => document.querySelector('[data-testid="editor-root"]')?.getAttribute("data-save-state") === "saved", undefined, { timeout: 20_000 }).catch(() => null);
await sleep(500);
check("3. back online → IndexedDB 0 rows", (await idbCount(p1)) === 0, `${await idbCount(p1)} rows`);
check("3. badge gone", await p1.locator('[data-testid="offline-badge"]').count() === 0);
{
  const rows = await serverText();
  const last = rows.sort((a, b) => a.position - b.position).at(-1);
  check("3. everything reaches the server (ABCDEF12345)", (last?.content?.text ?? "").endsWith("ABCDEF12345"), (last?.content?.text ?? "").slice(-14));
}

// ── 4. idempotency ────────────────────────────────────────────────────────
{
  const before = (await serverText()).length;
  const newBlockId = uuid();
  const body = { requestId: uuid(), transactions: [{ id: uuid(), pageId, timestamp: Date.now(), debug: { userAction: "check.idempotent", clientCommitTimeMs: Date.now() }, operations: [{ command: "set", pointer: { table: "block", id: newBlockId }, path: [], args: { id: newBlockId, type: "paragraph", content: { text: "idem" }, parentBlockId: null, position: 9999 } }] }] };
  const r1 = await api.post(`${BASE}/api/saveTransactions`, { data: body });
  const r2 = await api.post(`${BASE}/api/saveTransactions`, { data: body });
  const body1 = await r1.text();
  check("4. response body is `{}`", body1 === "{}", body1.slice(0, 60));
  const after = (await serverText()).length;
  check("4. the same request twice → 1 block", r1.ok() && r2.ok() && after === before + 1, `${before} → ${after}, ${r1.status()}/${r2.status()}`);
}

// ── 5. closing the tab ────────────────────────────────────────────────────
await p1.close();
const p2 = await ctx.newPage();
await openEditor(p2);
await focusLast(p2);
await sleep(800);
await p2.keyboard.type("Z");
await sleep(10);
const closedAt = Date.now();
await p2.close();
const p3 = await ctx.newPage();
await openEditor(p3);
let landed = null;
for (let i = 0; i < 30; i++) {
  const rows = await serverText();
  // test 4 appended an "idem" block at position 9999, so the last block is that one
  if (rows.some((b) => (b.content?.text ?? "").endsWith("Z"))) { landed = Date.now() - closedAt; break; }
  await sleep(1000);
}
check("5. close the tab 10ms later → a new tab lands it on the server within ≤20s (Notion measured 13.6s)", landed !== null && landed <= 20_000, landed !== null ? `${landed}ms` : "not landed in 30s");
for (let i = 0; i < 20 && (await idbCount(p3)) !== 0; i++) await sleep(1000);
check("5. IndexedDB 0 rows after recovery (≤20s)", (await idbCount(p3)) === 0, `${await idbCount(p3)} rows`);

// 5b. type while no request can go out (offline) and close → the transaction exists only in IndexedDB.
//     The new tab must recover that session's orphans and send them (in 5 the fetch may have arrived right before the close).
await p3.close();
const p4 = await ctx.newPage();
await openEditor(p4);
await focusLast(p4);
await sleep(800);
await ctx.setOffline(true);
await sleep(200);
await p4.keyboard.type("Q");
await sleep(400);
check("5b. offline input → 1 IndexedDB row", (await idbCount(p4)) >= 1, `${await idbCount(p4)} rows`);
const closedAt2 = Date.now();
await p4.close();
await ctx.setOffline(false);
const p5 = await ctx.newPage();
await openEditor(p5);
let landed2 = null;
for (let i = 0; i < 30; i++) {
  const rows = await serverText();
  if (rows.some((b) => (b.content?.text ?? "").endsWith("ZQ"))) { landed2 = Date.now() - closedAt2; break; }
  await sleep(1000);
}
check("5b. a new tab recovers and sends the closed tab's orphan transactions within ≤20s (Notion measured 13.6s)", landed2 !== null && landed2 <= 20_000, landed2 !== null ? `${landed2}ms` : "not landed in 30s");
for (let i = 0; i < 20 && (await idbCount(p5)) !== 0; i++) await sleep(1000);
check("5b. IndexedDB 0 rows after recovery (≤20s)", (await idbCount(p5)) === 0, `${await idbCount(p5)} rows`);
await p5.close();

}

// ── 6. fan-out: another tab's edits arrive as transactions, without GET /blocks ──
{
  const pa = await ctx.newPage();
  const pb = await ctx.newPage();
  await openEditor(pa);
  await openEditor(pb);
  await sleep(1500);
  await pa.bringToFront(); // two pages in one context: only the front one gets key input
  let getsInB = 0;
  pb.on("request", (r) => { if (r.method() === "GET" && /\/api\/pages\/[^/]+\/blocks$/.test(r.url())) getsInB++; });
  await focusLast(pa);
  await pa.keyboard.type(C.fanout);
  const t6 = Date.now();
  await sleep(1500);
  console.log("  · A active:", await pa.evaluate(() => document.activeElement?.getAttribute("data-testid")), "hasFocus:", await pa.evaluate(() => document.hasFocus()), "save-state:", await pa.getAttribute('[data-testid="editor-root"]', "data-save-state"));
  console.log(`  · server has ${C.fanout}:`, (await serverText()).some((b) => (b.content?.text ?? "").includes(C.fanout)));
  let seen = null;
  for (let i = 0; i < 40; i++) {
    const txt = await pb.evaluate(() => [...document.querySelectorAll('[data-testid^="block-editable-"]')].map((e) => e.innerText).join("\n"));
    if (txt.includes(C.fanout)) { seen = Date.now() - t6; break; }
    await sleep(250);
  }
  check("6. the edit reaches the other tab (SSE transaction)", seen !== null, seen !== null ? `${seen}ms` : "not seen in 10s");
  check("6. no full GET /blocks along the way", getsInB === 0, `${getsInB} GETs`);
  // soft delete: remove the last block in A → gone from B and from GET, but the row stays (alive=false)
  const beforeDel = (await serverText()).length;
  const lastId = await pa.evaluate(() => { const els = [...document.querySelectorAll('[data-testid^="block-editable-"]')]; return els[els.length - 1]?.getAttribute("data-testid")?.slice("block-editable-".length) ?? null; });
  await pa.keyboard.press("Control+a");
  await pa.keyboard.press("Backspace");
  await pa.keyboard.press("Backspace");
  await sleep(2500);
  const afterDel = (await serverText()).length;
  check("6. delete a block → gone from GET", afterDel === beforeDel - 1, `${beforeDel} → ${afterDel}`);
  const gone = await pb.evaluate((id) => !document.querySelector(`[data-testid="block-editable-${id}"]`), lastId);
  check("6. the delete also reaches the other tab as a transaction", gone && getsInB === 0, `GETs ${getsInB}`);
  await pa.close(); await pb.close();
}

// ── cleanup ───────────────────────────────────────────────────────────────
await api.delete(`${BASE}/api/pages/${pageId}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(" | ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
