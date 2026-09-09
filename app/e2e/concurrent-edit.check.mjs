// 3단계 ③ — 두 탭이 같은 블록을 동시에 편집할 때의 보장 (docs/text-crdt-design §8).
//
//   [BASE_URL=…] [USER_ID=…] node e2e/concurrent-edit.check.mjs
//
// 보장하는 것:
//   1. 유실 없음 — 서버가 텍스트 연산 시 블록 행을 잠가(FOR UPDATE) 동시 요청을 직렬화하므로,
//      두 탭이 같은 블록에 동시에 쳐도 두 입력이 모두 서버에 남고 거절이 없다.
//   2. 순차 수렴 — 한 탭이 치고 멈춘 뒤 다른 탭이 치면 서버·양쪽이 같은 텍스트로 수렴한다.
//   3. 서식 — 한 탭에서 굵게 한 결과가 서버에 <b> 로 남는다.
// (같은 블록을 두 사람이 '동시에' 치는 동안에는 각자 자기 입력을 먼저 보고, 멈추면 서버 병합본으로
//  수렴한다 — 포커스된 블록 실시간 병합은 후속 작업.)
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
const serverText = async () => (await (await api.get(`${BASE}/api/pages/${pageId}/blocks`)).json()).blocks.find((b) => b.id === B1)?.content;

const A = await open();
const B = await open();

// ── 1. 동시 입력 — 유실 없음 ──────────────────────────────────────────────
await atEnd(A.page); await atEnd(B.page);
await Promise.all([A.page.keyboard.type("111", { delay: 20 }), B.page.keyboard.type("222", { delay: 20 })]);
await sleep(3500);
const srv = await serverText();
check("1. 동시 입력 — 서버에 두 입력 모두 (유실 없음)", srv.text.includes("111") && srv.text.includes("222") && srv.text.startsWith("AB"), `server=${JSON.stringify(srv.text)}`);
check("1. 동시 입력 — 거절(422) 없음", rejects === 0, `rejects=${rejects}`);

// ── 2. 순차 수렴 ─────────────────────────────────────────────────────────
// B 가 멈춘 뒤 A 가 마지막에 " END" 를 치고 멈추면, B 는 포커스 아닌 채 원격 병합으로 수렴한다.
await editable(B.page).click(); await B.page.keyboard.press("End"); // B focuses to receive
await sleep(200);
await atEnd(A.page);
await A.page.keyboard.type(" X", { delay: 30 });
await sleep(300);
await B.page.mouse.click(3, 3); // B blurs → next remote merge lands
await sleep(3000);
const srv2 = await serverText();
check("2. A 가 이어 친 뒤 B(비포커스)가 수렴", (await editable(B.page).innerText()) === srv2.text, `B=${JSON.stringify(await editable(B.page).innerText())} srv=${JSON.stringify(srv2.text)}`);
check("2. 서버에 A 의 ' X' 반영", srv2.text.includes(" X"), `server=${JSON.stringify(srv2.text)}`);

// ── 3. 서식 ──────────────────────────────────────────────────────────────
await editable(A.page).click(); await A.page.keyboard.press("End");
await A.page.keyboard.down("Shift"); await A.page.keyboard.press("ArrowLeft"); await A.page.keyboard.press("ArrowLeft"); await A.page.keyboard.up("Shift");
await A.page.keyboard.press("Control+b");
await sleep(2500);
const srv3 = await serverText();
check("3. 굵게 → 서버 html 에 <b>", /<b>/.test(srv3.html ?? ""), `html=${JSON.stringify((srv3.html ?? "").slice(-30))}`);

await api.delete(`${BASE}/api/pages/${pageId}`);
await A.c.close(); await B.c.close(); await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(" | ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
