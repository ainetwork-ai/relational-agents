// A visited page opens and edits with no network (docs/willow-ainmem-plan.md Task 2).
//
//   [BASE_URL=…] [USER_ID=…] node e2e/offline-open.check.mjs
//
// Guarantees:
//   1. After one visit, the page reloads with the browser offline: title and text are there.
//   2. Text typed offline reaches the server when the network returns.
//   3. Logging out empties the service worker's caches.
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

const TITLE = "offline-open.check";
const pageId = (await (await api.post(`${BASE}/api/pages`, { data: { title: TITLE } })).json()).page.id;
const B1 = crypto.randomUUID();
await api.put(`${BASE}/api/pages/${pageId}/blocks`, { data: { blocks: [{ id: B1, type: "paragraph", position: 1, parentBlockId: null, content: { text: "kept", html: "kept" } }], deletedIds: [] } });
const serverText = async () => (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks.find((b) => b.id === B1)?.content.text;

try {
  const page = await ctx.newPage();
  const ready = async () => {
    await page.waitForFunction((id) => window.__editorReady === id, pageId, { timeout: 120_000 });
    await page.waitForTimeout(700);
  };
  await page.goto(`${BASE}/p/${pageId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await ready();
  // the worker takes over after its first load; the second visit is the one it keeps
  const controlled = await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 20_000 })
    .then(() => true, () => false);
  check("0. a service worker controls the page", controlled);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready();

  await ctx.setOffline(true);
  let opened = true;
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => (opened = false));
  if (opened) await ready().catch(() => (opened = false));
  const editable = page.locator(`[data-testid="block-editable-${B1}"]`);
  const text = opened ? await editable.innerText().catch(() => "") : "";
  const title = opened ? await page.getByTestId("page-title").inputValue().catch(() => page.getByTestId("page-title").innerText()).catch(() => "") : "";
  check("1. offline reload shows the page", opened && text === "kept" && title.includes(TITLE), `opened=${opened} text=${JSON.stringify(text)} title=${JSON.stringify(title)}`);

  if (opened) {
    await editable.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" offline", { delay: 30 });
    await sleep(1000);
  }
  await ctx.setOffline(false);
  let srv = "";
  for (let i = 0; i < 40; i++) { srv = await serverText(); if (srv === "kept offline") break; await sleep(700); }
  check("2. text typed offline reaches the server", srv === "kept offline", `server=${JSON.stringify(srv)}`);

  const before = await page.evaluate(async () => (await caches.keys()).length);
  await page.evaluate(async () => {
    const { clearOfflineCaches } = window.__ainmemOffline ?? {};
    if (clearOfflineCaches) await clearOfflineCaches();
  });
  const after = await page.evaluate(async () => (await caches.keys()).length);
  check("3. logout's clear empties the caches", before > 0 && after === 0, `before=${before} after=${after}`);
} finally {
  await api.delete(`${BASE}/api/pages/${pageId}`).catch(() => {});
  await browser.close();
}
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
