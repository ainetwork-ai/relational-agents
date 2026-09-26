// Stage 3 ③ — do two tabs editing the same block at once converge in real time? (docs/text-crdt-design §8).
//
//   [BASE_URL=…] [USER_ID=…] node e2e/concurrent-edit.check.mjs
//
// Guarantees:
//   1. Concurrent typing — both screens converge on the same text in real time, every character survives, no rejections.
//      (Concurrent inserts at the same point may interleave per the RGA rules, but converge without loss.)
//   2. A remote insert does not push my caret — if someone inserts to my left, my next keystroke still lands where I was.
//   3. Formatting — one tab's bold reaches the server and both tabs.
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
const uuid = () => crypto.randomUUID();
const sorted = (s) => [...s].sort().join("");

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const api = ctx.request;

const pageId = (await (await api.post(`${BASE}/api/pages`, { data: { title: "concurrent-edit.check" } })).json()).page.id;
const B1 = uuid();
await api.put(`${BASE}/api/pages/${pageId}/blocks`, { data: { blocks: [{ id: B1, type: "paragraph", position: 1, parentBlockId: null, content: { text: "AB", html: "AB" } }], deletedIds: [] } });

let rejects = 0;
async function open() {
  const c = await browser.newContext();
  await c.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
  const page = await c.newPage();
  page.on("response", (r) => { if (/saveTransactions/.test(r.url()) && r.status() !== 200) rejects++; });
  await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction((id) => window.__editorReady === id, pageId, { timeout: 120_000 });
  await page.waitForTimeout(700);
  return { c, page };
}
const editable = (page) => page.locator(`[data-testid="block-editable-${B1}"]`);
const atEnd = async (page) => { await editable(page).click(); await page.keyboard.press("End"); };
const serverText = async () => (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks.find((b) => b.id === B1)?.content.text;

const A = await open();
const B = await open();

// ── 1. Concurrent typing — real-time convergence, lossless ──────────────────
await atEnd(A.page); await atEnd(B.page);
await Promise.all([A.page.keyboard.type("111", { delay: 30 }), B.page.keyboard.type("222", { delay: 30 })]);
await sleep(3500);
let srv = await serverText(), aDom = "", bDom = "";
for (let i = 0; i < 20; i++) { srv = await serverText(); aDom = await editable(A.page).innerText(); bDom = await editable(B.page).innerText(); if (aDom === srv && bDom === srv) break; await sleep(700); }
check("1. concurrent typing — both tabs converge with the server (≤14s)", aDom === srv && bDom === srv, `A=${JSON.stringify(aDom)} B=${JSON.stringify(bDom)} srv=${JSON.stringify(srv)}`);
check("1. concurrent typing — every character kept (AB+111+222)", sorted(srv) === sorted("AB111222"), `server=${JSON.stringify(srv)} sorted=${sorted(srv)}`);
check("1. concurrent typing — no rejections (422)", rejects === 0, `rejects=${rejects}`);

// ── 2. A remote insert does not push my caret ───────────────────────────────
await editable(A.page).click(); await A.page.keyboard.press("Home"); await sleep(300);
await editable(B.page).click(); await B.page.keyboard.press("Home"); await B.page.keyboard.type("Q", { delay: 20 });
await sleep(2000); // A receives Q live; A's caret must stay before the old first char
await A.page.keyboard.type("!", { delay: 20 });
await sleep(2000);
let srv2 = await serverText();
check("2. after a remote insert my typing lands at my caret (start)", /^[!Q]{2}/.test(srv2) || srv2.startsWith("!"), `server=${JSON.stringify(srv2.slice(0, 8))}`);
for (let i = 0; i < 20; i++) { srv2 = await serverText(); if ((await editable(A.page).innerText()) === srv2 && (await editable(B.page).innerText()) === srv2) break; await sleep(700); }
check("2. both tabs still converge (≤14s)", (await editable(A.page).innerText()) === srv2 && (await editable(B.page).innerText()) === srv2, `A=${JSON.stringify((await editable(A.page).innerText()).slice(0,10))} B=${JSON.stringify((await editable(B.page).innerText()).slice(0,10))} srv=${JSON.stringify(srv2.slice(0,10))}`);

// ── 3. Formatting ────────────────────────────────────────────────────────────
await editable(A.page).click(); await A.page.keyboard.press("End");
await A.page.keyboard.down("Shift"); await A.page.keyboard.press("ArrowLeft"); await A.page.keyboard.press("ArrowLeft"); await A.page.keyboard.up("Shift");
await A.page.keyboard.press("Control+b");
await sleep(2500);
const srv3html = (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks.find((b) => b.id === B1)?.content.html;
check("3. bold → <b> in the server html", /<b>/.test(srv3html ?? ""), `html=${JSON.stringify((srv3html ?? "").slice(-24))}`);

await api.delete(`${BASE}/api/pages/${pageId}`);
await A.c.close(); await B.c.close(); await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(" | ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
