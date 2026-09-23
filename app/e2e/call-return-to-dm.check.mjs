// A call, once over, returns you to the room it started from — not to the
// relationship document. Covers both sides: the one who hangs up (leave())
// and the one who merely hears the call end (dm-call-end event).
//
//   [BASE_URL=http://localhost:3220] node e2e/call-return-to-dm.check.mjs
import { chromium, request } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3220";
const USER_A = process.env.VC_USER_A ?? "vc-alice";
const USER_B = process.env.VC_USER_B ?? "vc-bob";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function login(as) {
  const ctx = await request.newContext({ baseURL: BASE });
  const res = await ctx.post("/api/auth/demo-login", { data: as ? { as } : {} });
  if (!res.ok()) throw new Error(`demo-login ${as ?? "DemoUser"}: ${res.status()}`);
  return { ctx, user: (await res.json()).user };
}

const a = await login(USER_A);
const b = await login(USER_B);

// same provisioning as run-call-checks.mjs — invite dance if needed
async function ensureRoom() {
  const mk = async () =>
    (await (await a.ctx.post("/api/dm/rooms", { data: { memberIds: [b.user.id] } })).json()).room;
  let room = await mk();
  if (!room) {
    const demo = await login(null);
    const ws = (await (await demo.ctx.get("/api/workspaces")).json()).workspaces?.[0];
    if (!ws) throw new Error("DemoUser has no workspace to invite into");
    const inv = await (
      await demo.ctx.post("/api/workspace/invite", { data: { workspaceId: ws.id } })
    ).json();
    for (const who of [a, b]) await who.ctx.post(`/api/invite/${inv.token}`);
    room = await mk();
  }
  if (!room?.id) throw new Error("could not create/find the test room");
  return room.id;
}

const ROOM = await ensureRoom();
await a.ctx.post(`/api/calls/${ROOM}`, { data: { action: "end" } }).catch(() => {}); // clear ghosts

const roomInfo = await (await a.ctx.get(`/api/dm/rooms/${ROOM}`)).json();
const rootPageId = roomInfo.room?.rootPageId ?? null;
console.log(`room ${ROOM.slice(0, 8)} rootPageId=${rootPageId ? rootPageId.slice(0, 8) : "none"}`);

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

try {
  // ---- A dials from the room, B accepts, the call goes active ----
  await pageB.goto(`${BASE}/home`);
  await pageB.waitForTimeout(1200); // SSE inbox subscribes
  await pageA.goto(`${BASE}/dm/${ROOM}`);
  await pageA.getByTestId("call-button").click();
  await pageA.waitForURL(`**/call/${ROOM}`, { timeout: 15000 });
  await pageB.getByTestId("incoming-call").waitFor({ timeout: 10000 });
  await pageB.getByTestId("incoming-accept").click();
  await pageB.waitForURL(`**/call/${ROOM}`, { timeout: 15000 });
  // both stand on /call; give the handshake a moment to reach active
  await pageA.getByTestId("call-end").waitFor({ timeout: 15000 });
  await pageA.waitForTimeout(2500);

  // ---- A hangs up → A goes straight back to the dm room (leave()) ----
  await pageA.getByTestId("call-end").click();
  await pageA.waitForURL(`**/dm/${ROOM}`, { timeout: 15000 });
  check("hang-up returns the caller to the dm room", true);

  // ---- B only hears the end → B lands in the dm room too (dm-call-end) ----
  await pageB.waitForURL(`**/dm/${ROOM}`, { timeout: 15000 });
  check("remote end returns the other side to the dm room", true);
} catch (e) {
  check("script completed", false, String(e).slice(0, 300));
  try {
    console.log(`A at: ${pageA.url()}`);
    console.log(`B at: ${pageB.url()}`);
  } catch {}
} finally {
  await a.ctx.post(`/api/calls/${ROOM}`, { data: { action: "end" } }).catch(() => {});
  await browser.close();
}
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
