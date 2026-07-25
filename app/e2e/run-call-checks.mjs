// One-command regression run for the in-app video call.
//
//   [BASE_URL=http://localhost:3220] node e2e/run-call-checks.mjs
//
// Provisions everything the checks assume — two demo accounts sharing a
// workspace, their consented 1:1 room, the room's agent — clears any ghost
// call between scripts (an aborted run's leftover turns the next invite into
// a silent join), then runs the three call checks and reports one verdict.
import { spawnSync } from "node:child_process";
import { request } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3220";
const USER_A = process.env.VC_USER_A ?? "vc-alice";
const USER_B = process.env.VC_USER_B ?? "vc-bob";

async function login(as) {
  const ctx = await request.newContext({ baseURL: BASE });
  const res = await ctx.post("/api/auth/demo-login", { data: as ? { as } : {} });
  if (!res.ok()) throw new Error(`demo-login ${as ?? "DemoUser"}: ${res.status()}`);
  return { ctx, user: (await res.json()).user };
}

const a = await login(USER_A);
const b = await login(USER_B);

// room create is scoped to the caller's active workspace — a fresh session
// needs the invite dance before the 1:1 dedup can resolve
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
await a.ctx.post(`/api/dm/rooms/${ROOM}/agent`).catch(() => {}); // @agent check needs the bot
const clearCall = () =>
  a.ctx.post(`/api/calls/${ROOM}`, { data: { action: "end" } }).catch(() => {});

const CHECKS = ["call-chat.check.mjs", "call-flow.check.mjs", "call-flows-extra.check.mjs"];
const results = [];
for (const script of CHECKS) {
  await clearCall();
  console.log(`\n########## ${script} (room ${ROOM.slice(0, 8)}) ##########`);
  const r = spawnSync(process.execPath, [`e2e/${script}`], {
    stdio: "inherit",
    env: { ...process.env, CALL_ROOM_ID: ROOM, BASE_URL: BASE },
  });
  results.push({ script, code: r.status ?? 1 });
}
await clearCall();

console.log("\n=======================================");
for (const r of results) console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.script}`);
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
