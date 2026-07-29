// A call bubble leads back to what that call left in the record.
//
// The chat is where a call is visible; its meaning lives in the relationship
// document, and the two were not connected. What the panel must never show is
// the transcript — utterances feed the agent, not the chat (CONTRACT 47e5bc5).
//
//   CALL_ROOM_ID=<consented dm room> [BASE_URL=http://localhost:36625]
//   [VC_USER_A=vc-alice] [VC_USER_B=vc-bob] node e2e/call-record.check.mjs
//
// Places a real call with three spoken lines, hangs up, then checks the bubble.

import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:36625";
const ROOM = process.env.CALL_ROOM_ID;
const A = process.env.VC_USER_A ?? "vc-alice";
const B = process.env.VC_USER_B ?? "vc-bob";
const STRANGER = process.env.STRANGER ?? "acl-stranger";
if (!ROOM) {
  console.error("CALL_ROOM_ID is required");
  process.exit(2);
}

const SPOKEN = [
  "so are we still on for Saturday?",
  "yes — I booked the ferry for the afternoon",
  "perfect, let's watch the sunset from the tower again",
];

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
await ctxA.request.post(`${BASE}/api/auth/demo-login`, { data: { as: A } });
await ctxB.request.post(`${BASE}/api/auth/demo-login`, { data: { as: B } });

// --- a call with something said in it ---------------------------------------
const call = async (ctx, action) =>
  ctx.request.post(`${BASE}/api/calls/${ROOM}`, { data: { action } });
await call(ctxA, "invite");
await call(ctxB, "accept");
for (const [i, text] of SPOKEN.entries())
  await (i === 1 ? ctxB : ctxA).request.post(`${BASE}/api/calls/${ROOM}/utterance`, {
    data: { text },
  });
await call(ctxA, "end");

// the recap is an LLM round-trip started off the request — give it a moment
await new Promise((r) => setTimeout(r, 25_000));

// --- the bubble carries its call, the record answers -------------------------
const { messages } = await (await ctxA.request.get(`${BASE}/api/dm/rooms/${ROOM}/messages`)).json();
const bubbles = messages.filter((m) => m.text.startsWith("📞 ") && m.callId);
check("call bubbles carry callId", bubbles.length >= 2, `${bubbles.length} found`);

const callId = bubbles[bubbles.length - 1].callId;
const rec = await (
  await ctxA.request.get(`${BASE}/api/calls/${ROOM}/record?callId=${callId}`)
).json();
check("utterances counted", rec.utteranceCount === SPOKEN.length, `${rec.utteranceCount}`);
check(
  "the call left something in the record",
  rec.entries.length > 0,
  rec.entries.map((e) => e.sectionTitle).join(", ")
);
check("timeline holds the summary", rec.entries.some((e) => e.section === "timeline"));
check("the document is linkable", Boolean(rec.docPageId));

// the whole point of keeping speech out of the chat
const blob = JSON.stringify(rec);
const verbatim = SPOKEN.filter((s) => blob.includes(s));
check("no transcript in the response", verbatim.length === 0, verbatim.join(" / "));

// a room this account has nothing to do with stays shut
const ctxS = await browser.newContext();
await ctxS.request.post(`${BASE}/api/auth/demo-login`, { data: { as: STRANGER } });
const sRes = await ctxS.request.get(`${BASE}/api/calls/${ROOM}/record?callId=${callId}`);
check("non-member blocked", sRes.status() === 403 || sRes.status() === 404, `${sRes.status()}`);

// --- the bubble in the UI ----------------------------------------------------
const page = await ctxA.newPage();
await page.goto(`${BASE}/dm/${ROOM}`);
await page.waitForSelector('[data-testid="dm-msg-call"]');
const clickable = page.locator('[data-testid="dm-msg-call"]:not([disabled])');
const last = clickable.last();
await last.scrollIntoViewIfNeeded();
const widthBefore = (await last.boundingBox()).width;
await last.click();
const panel = page.locator('[data-testid="dm-call-record"]');
await panel.first().waitFor({ timeout: 15_000 });
check("one panel opens, not both bubbles", (await panel.count()) === 1, `${await panel.count()}`);
check(
  "the bubble keeps its size",
  (await last.boundingBox()).width === widthBefore,
  `${widthBefore} → ${(await last.boundingBox()).width}`
);
const text = await panel.first().innerText();
check("panel shows the record", /IN YOUR RECORD/i.test(text));
check("panel shows no transcript", !SPOKEN.some((s) => text.includes(s)));
check(
  "page does not scroll sideways",
  !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
);
await last.click();
await page.waitForTimeout(300);
check("clicking again folds it away", (await panel.count()) === 0);

await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\n전부 통과");
process.exit(failed ? 1 : 0);
