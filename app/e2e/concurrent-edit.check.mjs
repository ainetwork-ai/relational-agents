// 3단계 ③ — 두 탭이 같은 블록을 동시에 편집해도 실시간 수렴하는가 (docs/text-crdt-design §8).
//
//   [BASE_URL=…] [USER_ID=…] node e2e/concurrent-edit.check.mjs
//
// 보장:
//   1. 동시 입력 — 양쪽 화면이 실시간으로 같은 텍스트로 수렴하고, 모든 글자가 남고, 거절이 없다.
//      (같은 지점 동시 삽입은 RGA 규칙대로 인터리브될 수 있으나, 유실 없이 수렴한다.)
//   2. 원격 삽입이 내 캐럿을 밀지 않는다 — 내 왼쪽에 남이 넣어도 내 다음 입력은 내 자리에.
//   3. 서식 — 한 탭의 굵게가 서버·양쪽에 반영.
// dev 전용. 만든 페이지는 지운다.
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

// ── 1. 동시 입력 — 실시간 수렴, 무손실 ────────────────────────────────────
await atEnd(A.page); await atEnd(B.page);
await Promise.all([A.page.keyboard.type("111", { delay: 30 }), B.page.keyboard.type("222", { delay: 30 })]);
await sleep(3500);
let srv = await serverText(), aDom = "", bDom = "";
for (let i = 0; i < 20; i++) { srv = await serverText(); aDom = await editable(A.page).innerText(); bDom = await editable(B.page).innerText(); if (aDom === srv && bDom === srv) break; await sleep(700); }
check("1. 동시 입력 — 두 탭 화면이 서버와 수렴 (≤14s)", aDom === srv && bDom === srv, `A=${JSON.stringify(aDom)} B=${JSON.stringify(bDom)} srv=${JSON.stringify(srv)}`);
check("1. 동시 입력 — 모든 글자 보존 (AB+111+222)", sorted(srv) === sorted("AB111222"), `server=${JSON.stringify(srv)} sorted=${sorted(srv)}`);
check("1. 동시 입력 — 거절(422) 없음", rejects === 0, `rejects=${rejects}`);

// ── 2. 원격 삽입이 내 캐럿을 밀지 않는다 ──────────────────────────────────
await editable(A.page).click(); await A.page.keyboard.press("Home"); await sleep(300);
await editable(B.page).click(); await B.page.keyboard.press("Home"); await B.page.keyboard.type("Q", { delay: 20 });
await sleep(2000); // A receives Q live; A's caret must stay before the old first char
await A.page.keyboard.type("!", { delay: 20 });
await sleep(2000);
let srv2 = await serverText();
check("2. 원격 삽입 후 내 입력이 내 캐럿(맨 앞)에", /^[!Q]{2}/.test(srv2) || srv2.startsWith("!"), `server=${JSON.stringify(srv2.slice(0, 8))}`);
for (let i = 0; i < 20; i++) { srv2 = await serverText(); if ((await editable(A.page).innerText()) === srv2 && (await editable(B.page).innerText()) === srv2) break; await sleep(700); }
check("2. 여전히 두 탭 수렴 (≤14s)", (await editable(A.page).innerText()) === srv2 && (await editable(B.page).innerText()) === srv2, `A=${JSON.stringify((await editable(A.page).innerText()).slice(0,10))} B=${JSON.stringify((await editable(B.page).innerText()).slice(0,10))} srv=${JSON.stringify(srv2.slice(0,10))}`);

// ── 3. 서식 ──────────────────────────────────────────────────────────────
await editable(A.page).click(); await A.page.keyboard.press("End");
await A.page.keyboard.down("Shift"); await A.page.keyboard.press("ArrowLeft"); await A.page.keyboard.press("ArrowLeft"); await A.page.keyboard.up("Shift");
await A.page.keyboard.press("Control+b");
await sleep(2500);
const srv3html = (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks.find((b) => b.id === B1)?.content.html;
check("3. 굵게 → 서버 html 에 <b>", /<b>/.test(srv3html ?? ""), `html=${JSON.stringify((srv3html ?? "").slice(-24))}`);

await api.delete(`${BASE}/api/pages/${pageId}`);
await A.c.close(); await B.c.close(); await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(" | ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
