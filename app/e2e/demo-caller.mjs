// Headless caller behind the videocall-UI bridge (videocall/server.mjs
// POST /api/notion-call): logs into the notion app as a demo account, finds
// (or provisions) its 1:1 DM room with DemoUser, clicks the header call
// button and stays parked on /call — the fake camera/mic feed the WebRTC
// leg — until the call ends on either side.
//
//   [BASE_URL=http://localhost:3220] [VC_CALLER=Ava] \
//   [CALL_TIMEOUT_MS=600000] node e2e/demo-caller.mjs
//
// Prints "ROOM <id>" once the room is known — the bridge parses this line
// to proxy call status for the videocall UI.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3220";
const CALLER = process.env.VC_CALLER ?? "Ava";
const TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS ?? 10 * 60 * 1000);

const log = (...a) => console.log(new Date().toISOString(), ...a);

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

async function login(ctx, as) {
  const res = await ctx.request.post(`${BASE}/api/auth/demo-login`, {
    data: as ? { as } : {},
  });
  if (!res.ok()) throw new Error(`demo-login ${as ?? "DemoUser"}: ${res.status()}`);
  return (await res.json()).user;
}

/** The caller's 1:1 DM room with DemoUser. Listed by membership, so it is
 *  found regardless of the session's active workspace; only a missing room
 *  needs the invite dance (rooms POST scopes creation to the caller's
 *  default workspace, so a fresh session can't just re-create it). */
async function ensureRoom(ctx, demoCtx) {
  const me = await login(ctx, CALLER);
  const demo = await login(demoCtx, null);
  const rooms = (await (await ctx.request.get(`${BASE}/api/dm/rooms`)).json()).rooms ?? [];
  const mine = rooms.find(
    (r) => r.members?.length === 2 && r.members.some((m) => m.id === demo.id)
  );
  if (mine) return mine.id;

  log(`no room with DemoUser yet — provisioning as ${CALLER}`);
  // DemoUser (workspace owner) mints an invite; joining also points the
  // caller's session at that workspace, which room-creation validates.
  const ws = (await (await demoCtx.request.get(`${BASE}/api/workspaces`)).json())
    .workspaces?.[0];
  if (!ws) throw new Error("DemoUser has no workspace");
  const inv = await demoCtx.request.post(`${BASE}/api/workspace/invite`, {
    data: { workspaceId: ws.id },
  });
  if (!inv.ok()) throw new Error(`invite mint: ${inv.status()}`);
  const { token } = await inv.json();
  const join = await ctx.request.post(`${BASE}/api/invite/${token}`);
  if (!join.ok()) throw new Error(`invite join: ${join.status()}`);
  const made = await ctx.request.post(`${BASE}/api/dm/rooms`, {
    data: { memberIds: [demo.id] },
  });
  const body = await made.json();
  if (!body.room?.id) throw new Error(`room create: ${JSON.stringify(body).slice(0, 200)}`);
  return body.room.id;
}

try {
  const ctx = await browser.newContext();
  const demoCtx = await browser.newContext();
  const room = await ensureRoom(ctx, demoCtx);
  console.log(`ROOM ${room}`);

  const page = await ctx.newPage();
  await page.goto(`${BASE}/dm/${room}`);
  await page.getByTestId("call-button").click({ timeout: 15000 });
  await page.waitForURL(`**/call/${room}`, { timeout: 15000 });
  log(`ringing as ${CALLER}`);

  // Park on /call until the call is over. Not a bare waitForURL: a decline
  // that lands before this page finishes mounting leaves the view stranded
  // on /call showing "Call ended" (call-view sync's loading branch never
  // navigates), so also poll the server and bail once the call is gone.
  const deadline = Date.now() + TIMEOUT_MS;
  let gone = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (!page.url().includes(`/call/${room}`)) break;
    const state = await (await ctx.request.get(`${BASE}/api/calls/${room}`)).json();
    gone = state.call === null ? gone + 1 : 0;
    if (gone >= 3) break;
  }
  log("call over — leaving");
} catch (e) {
  log("caller error:", String(e).slice(0, 300));
  process.exitCode = 1;
} finally {
  await browser.close();
}
