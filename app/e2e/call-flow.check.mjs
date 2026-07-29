// Two-browser E2E check for the in-app video call: DM-header button → ring →
// top-right incoming card → accept → real WebRTC P2P video → transcript line
// → OKF Timeline append → open record page grows live (fs-watch).
//
// Standalone (not a Playwright spec): needs a running dev server, two demo
// accounts and a CONSENTED dm room between them. Fake camera/mic via flags,
// so it runs headless.
//
//   CALL_ROOM_ID=<roomId> [BASE_URL=http://localhost:3000] \
//   [VC_USER_A=vc-alice] [VC_USER_B=vc-bob] node e2e/call-flow.check.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ROOM = process.env.CALL_ROOM_ID;
const USER_A = process.env.VC_USER_A ?? "vc-alice";
const USER_B = process.env.VC_USER_B ?? "vc-bob";
if (!ROOM) {
  console.error("CALL_ROOM_ID is required (a consented dm room between the two demo users)");
  process.exit(2);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

async function login(ctx, as) {
  const res = await ctx.request.post(`${BASE}/api/auth/demo-login`, { data: { as } });
  if (!res.ok()) throw new Error(`login ${as} failed: ${res.status()}`);
}

const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
await login(ctxA, USER_A);
await login(ctxB, USER_B);
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();
const errors = { A: [], B: [] };
pageA.on("pageerror", (e) => errors.A.push(String(e)));
pageB.on("pageerror", (e) => errors.B.push(String(e)));

// record pages, derived from the room (no hardcoding): the root renders
// index.md (a table of contents) — the transcript bullets land in Timeline.md
const roomInfo = await (await ctxA.request.get(`${BASE}/api/dm/rooms/${ROOM}`)).json();
const rootPageId = roomInfo.room?.rootPageId;
const timelinePageId = rootPageId
  ? Buffer.from(`${Buffer.from(rootPageId, "base64url").toString()}/Timeline.md`)
      .toString("base64url")
      .replace(/=+$/, "")
  : null;

try {
  // ---- send ----
  await pageA.goto(`${BASE}/dm/${ROOM}`);
  const callBtn = pageA.getByTestId("call-button");
  await callBtn.waitFor({ timeout: 15000 });
  check("send: call button in DM header", true);

  // callee parked on home first so the SSE inbox is already open
  await pageB.goto(`${BASE}/home`);
  await pageB.waitForTimeout(1500);

  await callBtn.click();
  await pageA.waitForURL(`**/call/${ROOM}`, { timeout: 15000 });
  await pageA.getByTestId("call-status").waitFor({ timeout: 15000 });
  let status = "";
  for (let i = 0; i < 20; i++) {
    status = (await pageA.getByTestId("call-status").textContent()) ?? "";
    if (status.includes("Calling")) break;
    await pageA.waitForTimeout(300);
  }
  check("send: caller lands on /call with Calling…", status.includes("Calling"), `status="${status}"`);

  // ---- receive ----
  const card = pageB.getByTestId("incoming-call");
  await card.waitFor({ timeout: 10000 });
  const callerName = await card.textContent();
  check("receive: incoming card on callee", callerName?.includes(USER_A) ?? false);

  await pageB.getByTestId("incoming-accept").click();
  await pageB.waitForURL(`**/call/${ROOM}`, { timeout: 15000 });
  check("receive: accept navigates callee to /call", true);

  // ---- media ----
  const connected = async (page) =>
    page.evaluate(() => {
      const vids = [...document.querySelectorAll("video")];
      const remote = vids.find((v) => !v.muted);
      return !!remote && remote.readyState >= 2 && remote.videoWidth > 0 && !remote.classList.contains("hidden");
    });
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    await pageA.waitForTimeout(500);
    ok = (await connected(pageA)) && (await connected(pageB));
  }
  check("media: P2P remote video live on BOTH sides", ok);
  check("media: chat panel present", await pageA.getByTestId("call-chat-panel").isVisible());
  check("media: local PiP visible", await pageA.getByTestId("call-pip").isVisible());

  // ---- transcript line → both panels + live record page ----
  const postLine = (text) =>
    pageA.evaluate(
      ([room, t]) =>
        fetch(`/api/dm/rooms/${room}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: `🎙 ${t}` }),
        }),
      [ROOM, text]
    );
  const line = `line ${Date.now()}`;
  await postLine(line);
  await pageB.getByTestId("call-chat-panel").getByText(line).waitFor({ timeout: 10000 });
  check("record: transcript line reaches CALLEE's panel via SSE", true);

  if (timelinePageId) {
    const pageR = await ctxA.newPage();
    await pageR.goto(`${BASE}/p/${timelinePageId}`);
    await pageR.waitForTimeout(1000);
    const line2 = `live ${Date.now()}`;
    await postLine(line2);
    let grew = false;
    for (let i = 0; i < 20 && !grew; i++) {
      await pageR.waitForTimeout(500);
      grew = (await pageR.getByText(line2).count()) > 0;
    }
    check("record: open Timeline page live-grows (fs-watch)", grew);
  } else {
    check("record: open Timeline page live-grows (fs-watch)", false, "room has no rootPageId yet");
  }

  // ---- end ----
  await pageA.getByTestId("call-end").click();
  await pageA.waitForURL(`**/p/**`, { timeout: 15000 });
  check("end: caller navigates to the record page", true);
  await pageB.waitForURL((u) => !u.pathname.startsWith("/call/"), { timeout: 15000 });
  check("end: propagates — callee auto-leaves /call", true);
  const st = await ctxA.request.get(`${BASE}/api/calls/${ROOM}`);
  check("end: call state cleared", (await st.json()).call === null);

  check("no page errors (caller)", errors.A.length === 0, errors.A.join(" | ").slice(0, 200));
  check("no page errors (callee)", errors.B.length === 0, errors.B.join(" | ").slice(0, 200));
} catch (e) {
  check("script completed", false, String(e).slice(0, 300));
  try {
    await pageA.screenshot({ path: "/tmp/call-flow-fail-A.png" });
    await pageB.screenshot({ path: "/tmp/call-flow-fail-B.png" });
  } catch {}
} finally {
  await browser.close();
}
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
