// Offline edits survive a reload (docs/willow-ainmem-plan.md Task 1).
//
//   [BASE_URL=…] [USER_ID=…] node e2e/offline-replay.check.mjs
//
// Guarantees:
//   1. Text typed while saves cannot reach the server is still on screen after a reload
//      (the editor replays the transactions waiting in IndexedDB on top of the page).
//   2. Once saves go through again, the server has it — once, not twice.
//   3. A long offline session (600 transactions, over the server's 500 per request) is
//      sent in pieces, none dropped (review C2).
//   4. Another person signing in on this browser neither sees nor sends the first
//      person's unsent edits; they go out when the first person is back (review I1).
//      Set OTHER_USER_ID to a second user.
// dev only. Deletes the page it creates.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const fails = [];
const check = (name, ok, detail) => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
// the checks' own view of the server, always as the first person
const apiCtx = await browser.newContext();
await apiCtx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const api = apiCtx.request;

const pageId = (await (await api.post(`${BASE}/api/pages`, { data: { title: "offline-replay.check" } })).json()).page.id;
const B1 = crypto.randomUUID();
await api.put(`${BASE}/api/pages/${pageId}/blocks`, { data: { blocks: [{ id: B1, type: "paragraph", position: 1, parentBlockId: null, content: { text: "AB", html: "AB" } }], deletedIds: [] } });
const serverText = async () => (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks.find((b) => b.id === B1)?.content.text;

try {
  const page = await ctx.newPage();
  await page.route("**/api/saveTransactions", (r) => r.abort("internetdisconnected"));
  const ready = async () => {
    await page.waitForFunction((id) => window.__editorReady === id, pageId, { timeout: 120_000 });
    await page.waitForTimeout(700);
  };
  await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await ready();
  const editable = page.locator(`[data-testid="block-editable-${B1}"]`);
  await editable.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" offline", { delay: 30 });
  await sleep(800); // stored in IndexedDB; the send failed

  await page.reload({ waitUntil: "domcontentloaded" });
  await ready();
  let dom = "";
  for (let i = 0; i < 10; i++) { dom = await editable.innerText(); if (dom === "AB offline") break; await sleep(300); }
  check("1. text typed while saves failed is on screen after a reload", dom === "AB offline", `dom=${JSON.stringify(dom)}`);

  await page.unroute("**/api/saveTransactions");
  let srv = "";
  for (let i = 0; i < 40; i++) { srv = await serverText(); if (srv === "AB offline") break; await sleep(700); }
  check("2. the server has it once saves go through", srv === "AB offline", `server=${JSON.stringify(srv)}`);

  // 3. 600 queued transactions
  await page.route("**/api/saveTransactions", (r) => r.abort("internetdisconnected"));
  const statuses = [];
  page.on("response", (r) => { if (/saveTransactions/.test(r.url())) statuses.push(r.status()); });
  await page.evaluate(async ({ pid, bid }) => {
    const q = globalThis[Symbol.for("app.transaction-queue")];
    const all = [];
    for (let i = 1; i <= 600; i++) {
      all.push(q.enqueue({ id: crypto.randomUUID(), pageId: pid, timestamp: Date.now(), debug: { userAction: "backlog", clientCommitTimeMs: Date.now() }, operations: [{ command: "update", pointer: { table: "block", id: bid }, path: [], args: { position: i } }] }));
    }
    await Promise.all(all);
  }, { pid: pageId, bid: B1 });
  await page.unroute("**/api/saveTransactions");
  let left = -1;
  for (let i = 0; i < 60; i++) {
    left = await page.evaluate(() => globalThis[Symbol.for("app.transaction-queue")].debugPending().length);
    if (left === 0) break;
    await sleep(500);
  }
  const pos = (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks.find((b) => b.id === B1)?.position;
  check("3. 600 offline transactions all reach the server", left === 0 && pos === 600 && !statuses.includes(413), `left=${left} position=${pos} statuses=${[...new Set(statuses)].join(",")}`);

  // 4. another person on this browser
  const OTHER = process.env.OTHER_USER_ID;
  if (!OTHER) check("4. (set OTHER_USER_ID to run the shared-browser check)", false);
  else {
    await page.route("**/api/saveTransactions", (r) => r.abort("internetdisconnected"));
    await editable.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" mine", { delay: 30 });
    await sleep(800);
    const other = await sealData({ userId: OTHER }, { password: secret, ttl: 0 });
    const otherCtxApi = await browser.newContext();
    await otherCtxApi.addCookies([{ name: "rm-session", value: other, domain: new URL(BASE).hostname, path: "/" }]);
    const otherPage = (await (await otherCtxApi.request.post(`${BASE}/api/pages`, { data: { title: "offline-replay other" } })).json()).page.id;
    await page.close();
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "rm-session", value: other, domain: new URL(BASE).hostname, path: "/" }]);
    const p2 = await ctx.newPage();
    await p2.goto(`${BASE}/p/${otherPage}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await p2.waitForFunction((id) => window.__editorReady === id, otherPage, { timeout: 120_000 });
    await sleep(16000); // past the orphan sweep
    const held = await p2.evaluate(() => globalThis[Symbol.for("app.transaction-queue")].debugPending().length);
    const cachedA = await p2.evaluate(async (pid) => !!(await caches.match(`${location.origin}/p/${pid}`)), pageId);
    const srvB = await serverText();
    check("4. the other person's tab does not adopt or send the first person's edits", held === 0 && srvB === "AB offline", `held=${held} server=${JSON.stringify(srvB)}`);
    check("4. …nor can it open the first person's cached page", !cachedA);
    await p2.close();
    await otherCtxApi.request.delete(`${BASE}/api/pages/${otherPage}`).catch(() => {});
    await otherCtxApi.close();
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
    const p3 = await ctx.newPage();
    await p3.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await p3.waitForFunction((id) => window.__editorReady === id, pageId, { timeout: 120_000 });
    let back = "";
    for (let i = 0; i < 40; i++) { back = await serverText(); if (back === "AB offline mine") break; await sleep(700); }
    check("4. back as the first person, the edit goes out", back === "AB offline mine", `server=${JSON.stringify(back)}`);
  }
} finally {
  await api.delete(`${BASE}/api/pages/${pageId}`).catch(() => {});
  await browser.close();
}
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
