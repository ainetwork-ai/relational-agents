// Supplementary in-app video call flows: decline, cancel (incoming card
// auto-dismiss), and the record-page call button (reverse lookup). Companion
// to call-flow.check.mjs — same setup requirements.
//
//   CALL_ROOM_ID=<roomId> [BASE_URL=http://localhost:3000] \
//   [VC_USER_A=vc-alice] [VC_USER_B=vc-bob] node e2e/call-flows-extra.check.mjs
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
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
await ctxA.request.post(`${BASE}/api/auth/demo-login`, { data: { as: USER_A } });
await ctxB.request.post(`${BASE}/api/auth/demo-login`, { data: { as: USER_B } });
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

const roomInfo = await (await ctxA.request.get(`${BASE}/api/dm/rooms/${ROOM}`)).json();
const rootPageId = roomInfo.room?.rootPageId;

try {
  // ---- record-page call button (reverse lookup) ----
  if (rootPageId) {
    await pageA.goto(`${BASE}/p/${rootPageId}`);
    await pageA.getByTestId("call-button").waitFor({ timeout: 15000 });
    check("record page shows the call button", true);
  } else {
    check("record page shows the call button", false, "room has no rootPageId yet");
  }

  // ---- decline ----
  await pageB.goto(`${BASE}/home`);
  await pageB.waitForTimeout(1200);
  await pageA.goto(`${BASE}/dm/${ROOM}`);
  await pageA.getByTestId("call-button").click();
  await pageA.waitForURL(`**/call/${ROOM}`, { timeout: 15000 });
  await pageB.getByTestId("incoming-call").waitFor({ timeout: 10000 });
  await pageB.getByTestId("incoming-decline").click();
  await pageA.waitForURL((u) => !u.pathname.startsWith("/call/"), { timeout: 15000 });
  check("decline: caller leaves /call", true);
  check("decline: callee card dismissed", (await pageB.getByTestId("incoming-call").count()) === 0);

  // ---- cancel (end while ringing) ----
  await pageA.goto(`${BASE}/dm/${ROOM}`);
  await pageA.getByTestId("call-button").click();
  await pageA.waitForURL(`**/call/${ROOM}`, { timeout: 15000 });
  await pageB.getByTestId("incoming-call").waitFor({ timeout: 10000 });
  await pageA.getByTestId("call-end").click();
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) {
    await pageB.waitForTimeout(300);
    gone = (await pageB.getByTestId("incoming-call").count()) === 0;
  }
  check("cancel: callee card auto-dismisses", gone);
} catch (e) {
  check("script completed", false, String(e).slice(0, 300));
  try {
    await pageA.screenshot({ path: "/tmp/call-extra-fail-A.png" });
    await pageB.screenshot({ path: "/tmp/call-extra-fail-B.png" });
  } catch {}
} finally {
  await browser.close();
}
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
