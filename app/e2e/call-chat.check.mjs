// In-call chat + call-record bubbles, two browsers: the call view's side
// panel IS the room's real chat (same composer, same bubbles, @agent), and
// the calls route drops KakaoTalk-style "📞" event bubbles into the room
// (Video Call / ended · duration / Missed call).
//
//   CALL_ROOM_ID=<roomId> [BASE_URL=http://localhost:3000] \
//   [VC_USER_A=vc-alice] [VC_USER_B=vc-bob] node e2e/call-chat.check.mjs
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

const panel = (page) => page.getByTestId("call-chat-panel");

async function ring() {
  await pageA.goto(`${BASE}/dm/${ROOM}`);
  await pageA.getByTestId("call-button").click({ timeout: 15000 });
  await pageA.waitForURL(`**/call/${ROOM}`, { timeout: 15000 });
  await pageB.getByTestId("incoming-call").waitFor({ timeout: 15000 });
}

try {
  // a ghost call left by an aborted previous run turns "invite" into a
  // silent 409-join and nobody ever rings — always start from a clean slate
  await ctxA.request
    .post(`${BASE}/api/calls/${ROOM}`, { data: { action: "end" } })
    .catch(() => {});

  await pageB.goto(`${BASE}/home`);
  await pageB.waitForTimeout(1500);

  // @agent needs the room's agent — provision it up front (idempotent-ish;
  // an already-provisioned room just errors and that's fine)
  await ctxA.request.post(`${BASE}/api/dm/rooms/${ROOM}/agent`).catch(() => {});

  // ---- call + accept ----
  await ring();
  // the caller's own ring must never pop as an incoming call on their side
  check(
    "caller sees NO incoming popup for their own ring",
    (await pageA.getByTestId("incoming-call").count()) === 0
  );
  await pageB.getByTestId("incoming-accept").click();
  await pageB.waitForURL(`**/call/${ROOM}`, { timeout: 15000 });

  // ---- the side panel is the real chat ----
  const composerA = panel(pageA).getByTestId("dm-composer-input");
  await composerA.waitFor({ timeout: 15000 });
  check("panel: real composer inside the call view", true);

  const line = `typed in call ${Date.now()}`;
  await composerA.fill(line);
  await composerA.press("Enter");
  await panel(pageB).getByText(line).waitFor({ timeout: 10000 });
  check("panel: typed message reaches the OTHER side's panel", true);

  // start bubble appears live in the in-call chat
  const started = await panel(pageA).getByTestId("dm-msg-call").filter({ hasText: "Video Call" }).count();
  check("bubble: 'Video Call' start bubble in the panel", started > 0);

  // ---- @agent from inside the call = private side-channel ----
  await composerA.fill(`@agent what do you remember? ${Date.now()}`);
  await composerA.press("Enter");
  await panel(pageA).getByTestId("dm-msg-private").first().waitFor({ timeout: 10000 });
  check("panel: @agent question is private (quiet marker)", true);

  // ---- hang up → ended · duration bubble ----
  await pageA.waitForTimeout(1200); // give the call a measurable duration
  await pageA.getByTestId("call-end").click();
  await pageB.waitForURL((u) => !u.pathname.startsWith("/call/"), { timeout: 15000 });
  await pageA.goto(`${BASE}/dm/${ROOM}`);
  await pageA
    .getByTestId("dm-msg-call")
    .filter({ hasText: "Video Call ended" })
    .last()
    .waitFor({ timeout: 10000 });
  check("bubble: 'Video Call ended · m:ss' after hangup", true);

  // ---- decline → Missed call bubble ----
  await pageB.goto(`${BASE}/home`);
  await pageB.waitForTimeout(1200);
  await ring();
  await pageB.getByTestId("incoming-decline").click();
  await pageA.waitForURL((u) => !u.pathname.startsWith("/call/"), { timeout: 15000 });
  await pageA.goto(`${BASE}/dm/${ROOM}`);
  await pageA
    .getByTestId("dm-msg-call")
    .filter({ hasText: "Missed call" })
    .last()
    .waitFor({ timeout: 10000 });
  check("bubble: 'Missed call' after decline", true);
} catch (e) {
  check("script completed", false, String(e).slice(0, 300));
  try {
    await pageA.screenshot({ path: "/tmp/call-chat-fail-A.png" });
    await pageB.screenshot({ path: "/tmp/call-chat-fail-B.png" });
  } catch {}
} finally {
  await browser.close();
}
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
