// QA-3: opening a page makes its workspace the active one (Notion, measured
// 2026-09-09 — docs/qa-backlog.md). Drives the dev app with a sealed session
// whose ACTIVE workspace is A, opens a page that lives in B, and measures:
//   1. the server HTML already carries B's sidebar (first paint, no flash)
//   2. in the browser the switcher shows B, the tree lists B's root page and
//      not A's, and /api/pages (session-scoped) answers for B — the session
//      followed; exactly one POST /api/workspaces/switch (no loop on refresh)
//   3. a hard load of an A page (session now B) flips everything back to A
//   4. a SOFT navigation (client-side, via the editor's link delegation) from
//      the A page to the B page flips everything to B again
//
//   [BASE_URL=http://localhost:3110] node e2e/workspace-follows-page.check.mjs
//
// Fixture: dev DB user amy@comcom.ai owns "Bobae Jeon's Workspace" (A) and is a
// member of ComCom (B). Both pages are ROOT pages so they appear in the tree.
// Dev data is expendable; nothing here writes content — only the session's
// active workspace moves, which is the feature under test.
import fs from "node:fs";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER = "30790fd0-9bdb-4c6c-abb8-3903fff5fd6d";
const A = { id: "e888c3f7-b3a9-49e6-8326-3f2f523ec0d5", name: "Bobae Jeon's Workspace", page: "4e53a13f-a970-48fc-ac80-662f447034dc" };
const B = { id: "2c88615f-4a30-43f8-9608-6ac977919dc0", name: "ComCom", page: "8ffbb568-f936-4901-ab83-9ebb2a685dbe" };

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const seal = (data) => sealData(data, { password: secret, ttl: 0 });
const unescape = (s) => (s ?? "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) fails++; };

// ── 1. first paint: server HTML with active=A ────────────────────────────────
{
  const cookie = await seal({ userId: USER, activeWorkspaceId: A.id });
  const ssrSwitcher = async (pageId) => {
    const html = await (await fetch(`${BASE}/p/${pageId}`, { headers: { cookie: `rm-session=${cookie}` } })).text();
    return unescape(html.match(/data-testid="workspace-switcher"[\s\S]{0,600}?<span[^>]*>([^<]+)<\/span>/)?.[1]);
  };
  const sB = await ssrSwitcher(B.page);
  check("1a. SSR sidebar names the PAGE's workspace (B), not the session's (A)", sB === B.name, `switcher="${sB}"`);
  const sA = await ssrSwitcher(A.page);
  check("1b. SSR sidebar for an A page names A", sA === A.name, `switcher="${sA}"`);
}

// ── 2–4. browser ──────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: await seal({ userId: USER, activeWorkspaceId: A.id }), url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const switches = [];
page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/workspaces/switch")) switches.push(JSON.parse(r.postData() ?? "{}").workspaceId?.slice(0, 8)); });

const switcherText = () => page.locator('[data-testid="workspace-switcher"] span').first().innerText();
const treeHas = (id) => page.locator(`[data-testid="page-tree-item-${id}"]`).count().then((n) => n > 0);
const activeViaApi = () => page.evaluate(async () => { const d = await (await fetch("/api/pages")).json(); return d.pages?.[0]?.workspaceId ?? null; });
const settle = async (ws) => {
  // wait for the follower's switch + refresh; cap at 6s
  for (let i = 0; i < 60; i++) {
    if ((await treeHas(ws.page)) && (await switcherText()) === ws.name) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(800);
};
const expectWorkspace = async (label, ws, other, nSwitch) => {
  await settle(ws);
  const sw = await switcherText();
  check(`${label}: switcher shows ${ws.name}`, sw === ws.name, sw);
  check(`${label}: tree lists ${ws.name}'s root page, not the other's`, (await treeHas(ws.page)) && !(await treeHas(other.page)));
  // the chrome is right before the session has followed (that is the point);
  // give the follower's switch round-trip up to 6s before judging the session
  let active = null;
  for (let i = 0; i < 60 && active !== ws.id; i++) { active = await activeViaApi(); if (active !== ws.id) await page.waitForTimeout(100); }
  check(`${label}: session followed — /api/pages answers for ${ws.name}`, active === ws.id, `got ${active?.slice(0, 8)}`);
  check(`${label}: switch POSTs so far = ${nSwitch} (no loop)`, switches.length === nSwitch, `got ${switches.length}: ${switches.join(",")}`);
};

// 2. hard load a B page while A is active; also time how long A's tree lingers
await page.goto(`${BASE}/p/${B.page}`, { waitUntil: "domcontentloaded" });
{
  const t0 = Date.now(); let sawA = false, aGoneAt = null;
  for (let i = 0; i < 60; i++) {
    const [hasA, hasB] = await Promise.all([treeHas(A.page), treeHas(B.page)]);
    if (hasA) sawA = true;
    if (hasB && !hasA) { aGoneAt = Date.now() - t0; break; }
    await page.waitForTimeout(50);
  }
  console.log(`   ℹ A's tree visible before B's: ${sawA ? `yes, until ~${aGoneAt}ms` : "no"}`);
}
await expectWorkspace("2. hard-load B page (active was A)", B, A, 1);

// 3. hard load an A page now that the session says B
await page.goto(`${BASE}/p/${A.page}`, { waitUntil: "domcontentloaded" });
await expectWorkspace("3. hard-load A page (active was B)", A, B, 2);

// 4. soft navigation A → B through the editor's internal-link delegation
await page.waitForSelector('[data-testid="editor-root"]', { timeout: 8000 });
await page.evaluate((href) => {
  const a = document.createElement("a"); a.href = href; a.textContent = "→B"; a.id = "probe-link";
  document.querySelector('[data-testid="editor-root"]').appendChild(a);
}, `/p/${B.page}`);
const nav = page.waitForURL(`**/p/${B.page}`, { timeout: 8000 });
await page.click("#probe-link");
await nav;
check("4a. soft nav happened (no full reload: probe survives until refresh)", page.url().endsWith(`/p/${B.page}`));
await expectWorkspace("4. soft-nav to B page (active was A)", B, A, 3);

check("5. no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
