// Offline edits survive a reload (docs/willow-ainmem-plan.md Task 1).
//
//   [BASE_URL=…] [USER_ID=…] node e2e/offline-replay.check.mjs
//
// Guarantees:
//   1. Text typed while saves cannot reach the server is still on screen after a reload
//      (the editor replays the transactions waiting in IndexedDB on top of the page).
//   2. Once saves go through again, the server has it — once, not twice.
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
const api = ctx.request;

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
} finally {
  await api.delete(`${BASE}/api/pages/${pageId}`).catch(() => {});
  await browser.close();
}
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
