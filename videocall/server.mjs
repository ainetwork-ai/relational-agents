// Video call UI server — zero dependencies, plain Node.
//
//   node server.mjs
//
// Serves the static video call UI from public/ plus a /api/calls endpoint
// with the recent-calls data the sidebar renders.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.VIDEOCALL_PORT || 3111);
const PUBLIC = path.join(HERE, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// section/kind/when are locale-neutral keys; the client renders them in EN/PT.
// DemoUser is the one REAL contact — clicking the row rings the notion app.
const CALLS = [
  { section: "today", name: "DemoUser", avatar: null, missed: false, kind: "video", when: { h: 14, m: 30 } },
  { section: "today", name: "Emma", avatar: "/gfs/emma.png", missed: false, kind: "video", when: { h: 10, m: 36 } },
  { section: "today", name: "Sophia", avatar: "/gfs/sophia.png", missed: true, kind: "video", when: { h: 9, m: 12 } },
  { section: "today", name: "Luna", avatar: "/gfs/luna.png", missed: false, kind: "audio", when: { h: 3, m: 43 } },
  { section: "yesterday", name: "Olivia", avatar: "/gfs/olivia.png", missed: false, kind: "video", when: { h: 23, m: 2 } },
  { section: "yesterday", name: "Mia Collins", avatar: "/gfs/mia.png", missed: true, kind: "video", when: { h: 20, m: 45 } },
  { section: "lastWeek", name: "Hannah Brooks", avatar: "/gfs/hannah.png", missed: false, kind: "video", when: { date: "2026-08-01" } },
  { section: "lastWeek", name: "Maya Sterling", avatar: "/gfs/maya.png", missed: false, kind: "audio", when: { date: "2026-07-31" } },
  { section: "lastWeek", name: "Riley Vance", avatar: "/gfs/riley.png", missed: true, kind: "video", when: { date: "2026-07-30" } },
  { section: "lastWeek", name: "Zoe Harrison", avatar: "/gfs/zoe.png", missed: false, kind: "video", when: { date: "2026-07-29" } },
  { section: "lastWeek", name: "Sophie Miller", avatar: "/gfs/sophie.png", missed: false, kind: "video", when: { date: "2026-07-28" } },
];

// ---- notion-call bridge ----
// The UI's "DemoUser" contact places a REAL in-app call into the notion app:
// POST /api/notion-call spawns a headless caller (app/e2e/demo-caller.mjs,
// fake camera/mic) that logs in as the demo caller account and rings
// DemoUser's 1:1 room — the incoming card pops wherever DemoUser is logged
// in. The caller must live outside this browser: the videocall tab shares
// its Chrome profile (= notion session cookie) with DemoUser's tab, so
// logging in as the caller here would log DemoUser out.
//   POST   /api/notion-call        -> start ringing {ok, already?}
//   GET    /api/notion-call        -> {running, roomId, call} for UI polling
//   POST   /api/notion-call/end    -> cancel/end from the videocall UI
const NOTION_BASE = process.env.NOTION_BASE || "http://localhost:3220";
const NOTION_CALLER = process.env.NOTION_CALLER || "Ava";
const CALLER_SCRIPT = path.join(HERE, "..", "app", "e2e", "demo-caller.mjs");
let callerChild = null;
let bridgeRoom = null;
let callerCookie = null;

function cookieFrom(res) {
  const raw = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  return raw.map((c) => c.split(";")[0]).join("; ");
}

/** Session cookie for the caller account — lets this server proxy call
 *  state (same user as the headless caller, so cancel is permitted). */
async function callerLogin() {
  const res = await fetch(`${NOTION_BASE}/api/auth/demo-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ as: NOTION_CALLER }),
  });
  if (!res.ok) throw new Error(`demo-login ${NOTION_CALLER}: ${res.status}`);
  callerCookie = cookieFrom(res);
  return callerCookie;
}

async function notionCallState() {
  if (!bridgeRoom) return null;
  const get = () =>
    fetch(`${NOTION_BASE}/api/calls/${bridgeRoom}`, { headers: { cookie: callerCookie || "" } });
  let res = await get();
  if (res.status === 401) { await callerLogin(); res = await get(); }
  if (!res.ok) return null;
  return (await res.json()).call ?? null;
}

function startCaller() {
  const child = spawn(process.execPath, [CALLER_SCRIPT], {
    cwd: path.join(HERE, "..", "app"),
    env: { ...process.env, BASE_URL: NOTION_BASE, VC_CALLER: NOTION_CALLER },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => {
    const line = String(d).trim();
    console.log(`[caller] ${line}`);
    const m = line.match(/^ROOM ([\w-]+)$/m);
    if (m) bridgeRoom = m[1];
  });
  child.stderr.on("data", (d) => console.error(`[caller] ${String(d).trim()}`));
  child.on("exit", (code) => {
    console.log(`[caller] exited (${code})`);
    if (callerChild === child) callerChild = null;
  });
  callerChild = child;
}

async function handleNotionCall(req, res, url) {
  res.setHeader("Content-Type", MIME[".json"]);
  try {
    if (url.pathname === "/api/notion-call" && req.method === "POST") {
      if (callerChild) {
        res.end(JSON.stringify({ ok: true, already: true }));
        return;
      }
      startCaller();
      res.end(JSON.stringify({ ok: true }));
    } else if (url.pathname === "/api/notion-call" && req.method === "GET") {
      const call = callerChild ? await notionCallState() : null;
      res.end(JSON.stringify({ running: !!callerChild, roomId: bridgeRoom, call }));
    } else if (url.pathname === "/api/notion-call/end" && req.method === "POST") {
      // ringing → only the caller may "cancel"; live → either side may "end".
      const call = await notionCallState();
      if (call && bridgeRoom) {
        const action = call.status === "ringing" ? "cancel" : "end";
        await fetch(`${NOTION_BASE}/api/calls/${bridgeRoom}`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: callerCookie || "" },
          body: JSON.stringify({ action }),
        });
      }
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method not allowed" }));
    }
  } catch (e) {
    res.writeHead(502);
    res.end(JSON.stringify({ error: String(e).slice(0, 200) }));
  }
}

// In-memory WebRTC signaling for the test harness (public/test.html).
// Non-trickle: each side posts one complete SDP blob, the other side polls.
//   GET    /api/rtc/<room>            -> { offer, answer } (null until posted)
//   POST   /api/rtc/<room>  {role: "offer"|"answer", sdp}
//   DELETE /api/rtc/<room>            -> reset room
const rtcRooms = new Map();

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`[req-log] ${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${req.url}`);
  if (url.pathname.startsWith("/api/notion-call")) {
    await handleNotionCall(req, res, url);
    return;
  }
  const rtcMatch = url.pathname.match(/^\/api\/rtc\/([\w-]+)$/);
  if (rtcMatch) {
    const room = rtcMatch[1];
    res.setHeader("Content-Type", MIME[".json"]);
    if (req.method === "GET") {
      const state = rtcRooms.get(room) || { offer: null, answer: null };
      res.end(JSON.stringify(state));
    } else if (req.method === "POST") {
      const { role, sdp } = await readBody(req);
      if (role !== "offer" && role !== "answer" || !sdp) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "expected {role: offer|answer, sdp}" }));
        return;
      }
      const state = rtcRooms.get(room) || { offer: null, answer: null };
      state[role] = sdp;
      rtcRooms.set(room, state);
      res.end(JSON.stringify({ ok: true }));
    } else if (req.method === "DELETE") {
      rtcRooms.delete(room);
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method not allowed" }));
    }
    return;
  }
  if (url.pathname === "/api/calls") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ calls: CALLS }));
    return;
  }
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  // /web/* serves the shared browser modules (ringtone, azure-transcript).
  const root = rel.startsWith("/web/") ? HERE : PUBLIC;
  const file = path.join(root, path.normalize(rel));
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

server.listen(PORT, () => {
  console.log(`Video Call UI: http://localhost:${PORT}`);
});
