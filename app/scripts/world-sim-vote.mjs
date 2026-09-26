// One member claims their treasury vote through the World ID *simulator* (staging) in a fresh browser.
// The simulator ships the same five fixed test identities in every browser, so "one member = one human" only holds
// if each member picks a different IDENTITY; a fresh browser context just keeps that choice out of the presenter's way.
//   cd app && ROOM=<room id> SLUG=tokyo-chris IDENTITY=3 OUT=<shots dir> node scripts/world-sim-vote.mjs
// IDENTITY picks one of the simulator's five fixed test identities (#0..#4); a fresh browser defaults to #4,
// which is the one a presenter's own fresh simulator will use, so off-camera members take #3, #2, #1.
import { chromium } from "@playwright/test";
const BASE = "https://ainmem.ainetwork.xyz", ROOM = process.env.ROOM, SLUG = process.env.SLUG, OUT = process.env.OUT ?? ".", IDENTITY = process.env.IDENTITY;
if (!ROOM || !SLUG || !/^[0-4]$/.test(IDENTITY ?? "")) { console.error("ROOM, SLUG and IDENTITY (0-4) are required"); process.exit(2); }
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
const p = await ctx.newPage();
const settle = async (pg, ms = 2000) => { await pg.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await pg.waitForTimeout(ms); };
const status = async () => { for (let i = 0; i < 6; i++) { try { const r = await p.request.get(`${BASE}/api/dm/rooms/${ROOM}/treasury`); if (r.ok()) return await r.json(); } catch {} await p.waitForTimeout(3000); } return null; };

await p.goto(`${BASE}/api/auth/demo-login?as=${SLUG}&returnTo=/dm/${ROOM}`); await settle(p, 3000);
const before = await status();
const seated = (s) => (s?.members ?? []).filter((m) => m.seatLevel).map((m) => `${m.name ?? m.userId}:${m.seatLevel}`);
console.log(`[${SLUG}] before: mySeated=${before?.mySeated} seats=${JSON.stringify(seated(before))}`);
if (before?.mySeated) { console.log(`[${SLUG}] already seated — nothing to do`); await browser.close(); process.exit(0); }

// Open the IDKit widget.
let claim = p.getByRole("button", { name: /Claim your vote with World ID/ });
if (!(await claim.count())) { await p.getByText(/Shared treasury/).first().click(); await p.waitForTimeout(1200); claim = p.getByRole("button", { name: /Claim your vote with World ID/ }); }
if (!(await claim.count())) { console.log(`[${SLUG}] no Claim button`); await p.screenshot({ path: `${OUT}/${SLUG}-noclaim.png` }); await browser.close(); process.exit(1); }
await claim.first().click();

// The simulator link lives inside the widget's shadow root; read its href instead of clicking through the overlay.
let simHref = null;
for (let i = 0; i < 20 && !simHref; i++) {
  await p.waitForTimeout(1000);
  simHref = await p.evaluate(() => { const root = document.querySelector("[data-idkit-shadow-host]")?.shadowRoot; if (!root) return null; return [...root.querySelectorAll("a")].map((a) => a.getAttribute("href")).find((h) => /simulator/i.test(h || "")) ?? null; });
}
if (!simHref) { console.log(`[${SLUG}] no simulator link in the widget`); await p.screenshot({ path: `${OUT}/${SLUG}-nosim.png` }); await browser.close(); process.exit(1); }
console.log(`[${SLUG}] simulator: ${simHref.slice(0, 60)}…`);

// Drive the simulator: pick the requested test identity first (persisted in the context's localStorage), then open the request.
const sim = await ctx.newPage(); await sim.goto("https://simulator.worldcoin.org/"); await settle(sim, 3000); // seeds the identity store
const picked = await sim.evaluate((n) => { const k = "Simulator_Identity_Store_2"; const st = JSON.parse(localStorage.getItem(k) || "null"); const id = st?.state?.identities?.find((i) => i.meta?.idNumber === n)?.id; if (!id) return null; st.state.activeIdentityID = id; localStorage.setItem(k, JSON.stringify(st)); return id; }, Number(IDENTITY));
if (!picked) { console.log(`[${SLUG}] identity #${IDENTITY} not in the simulator store`); await browser.close(); process.exit(1); }
await sim.goto(`https://simulator.worldcoin.org/id/${picked}`); await settle(sim, 2500);
const activeNow = await sim.evaluate(() => JSON.parse(localStorage.getItem("Simulator_Identity_Store_2") || "{}")?.state?.activeIdentityID);
console.log(`[${SLUG}] picked Identity #${IDENTITY} = ${picked}; active=${activeNow}; url=${sim.url()}`);
if (activeNow !== picked) { console.log(`[${SLUG}] simulator did not switch identity`); await browser.close(); process.exit(1); }
await sim.goto(simHref); await settle(sim, 4000);
console.log(`[${SLUG}] sim id page: ${sim.url()}`);
const simText = async () => (await sim.evaluate(() => document.body.innerText)).replace(/\n+/g, " | ");
let t = await simText(); console.log(`[${SLUG}] sim: ${t.slice(0, 400)}`);
await sim.screenshot({ path: `${OUT}/${SLUG}-sim-1.png` });
const cont = sim.getByRole("button", { name: /^Continue$/ });
if (!(await cont.count())) { console.log(`[${SLUG}] no Continue button`); await browser.close(); process.exit(1); }
await cont.first().click(); await settle(sim, 3000);
for (let i = 0; i < 30; i++) { t = await simText(); if (/success|verified|sent|error|fail|invalid/i.test(t) && !/Continue/.test(t)) break; await sim.waitForTimeout(2000); }
console.log(`[${SLUG}] sim after: ${t.slice(0, 400)}`);
await sim.screenshot({ path: `${OUT}/${SLUG}-sim-2.png` });

// Back in the app: the widget hands the proof to /treasury/seat; wait for the seat to become real.
let claimed = false;
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(3000);
  const body = await p.evaluate(() => document.body.innerText);
  const line = (body.match(/[^\n]*(Vote claimed|didn't check out|isn't reachable|already|failed|error)[^\n]*/i) || [""])[0].trim();
  if (line) { console.log(`[${SLUG}] app: ${line.slice(0, 200)}`); claimed = /Vote claimed/i.test(line); break; }
  const s = await status(); if (s?.mySeated) { console.log(`[${SLUG}] app: mySeated`); claimed = true; break; }
}
await p.screenshot({ path: `${OUT}/${SLUG}-app.png` });
const after = await status();
console.log(`[${SLUG}] after: mySeated=${after?.mySeated} seats=${JSON.stringify(seated(after))} claimed=${claimed}`);
await browser.close();
process.exit(claimed ? 0 : 1);
