// Video call UI server — zero dependencies, plain Node.
//
//   node server.mjs
//
// Serves the static video call UI from public/ plus a /api/calls endpoint
// with the recent-calls data the sidebar renders.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
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
// The UI's "DemoUser" contact places a REAL in-app call into the notion app.
// The videocall page itself is the caller endpoint — its camera and mic feed
// the WebRTC leg, so both call tabs sit on the same machine and host ICE
// candidates just work (the app's RTCPeerConnection has no STUN/TURN, so a
// remote caller could never connect). This server only lends the page a
// notion identity: it keeps a session for the caller account and proxies
// ring/state/SDP — the videocall tab can't log in itself without evicting
// DemoUser's session (same Chrome profile = same cookie jar).
//   POST /api/notion-call         -> ensure the 1:1 room + start ringing
//   GET  /api/notion-call         -> {roomId, call} for UI polling
//   POST /api/notion-call/signal  -> {action: offer|answer, sdp} as the caller
//   POST /api/notion-call/end     -> cancel (ringing) / end (live)
const NOTION_BASE = process.env.NOTION_BASE || "http://localhost:3220";
const NOTION_CALLER = process.env.NOTION_CALLER || "Ava";
const BRIDGE_CLIENT_ID = "videocall-bridge";
let bridgeRoom = null;
let callerCookie = null;

function cookieFrom(res) {
  const raw = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function demoLogin(as) {
  const res = await fetch(`${NOTION_BASE}/api/auth/demo-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(as ? { as } : {}),
  });
  if (!res.ok) throw new Error(`demo-login ${as || "DemoUser"}: ${res.status}`);
  return { cookie: cookieFrom(res), user: (await res.json()).user };
}

function callerFetch(pathname, init = {}) {
  return fetch(`${NOTION_BASE}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: callerCookie || "",
      "x-client-id": BRIDGE_CLIENT_ID,
      ...(init.headers || {}),
    },
  });
}

/** The caller's 1:1 room with DemoUser. Room creation is scoped to the
 *  session's active workspace, so a fresh login needs the invite dance
 *  (idempotent: the dedup key always resolves to the same room). */
async function ensureRoom() {
  const ava = await demoLogin(NOTION_CALLER);
  callerCookie = ava.cookie;
  const demo = await demoLogin(null);
  const mkRoom = async () => {
    const r = await callerFetch(`/api/dm/rooms`, {
      method: "POST",
      body: JSON.stringify({ memberIds: [demo.user.id] }),
    });
    return (await r.json().catch(() => ({}))).room;
  };
  let room = await mkRoom();
  if (!room) {
    // not in DemoUser's workspace yet — DemoUser (owner) mints an invite;
    // joining also points the caller's session at that workspace
    const ws = (await (await fetch(`${NOTION_BASE}/api/workspaces`, {
      headers: { cookie: demo.cookie },
    })).json()).workspaces?.[0];
    if (!ws) throw new Error("DemoUser has no workspace");
    const inv = await (await fetch(`${NOTION_BASE}/api/workspace/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: demo.cookie },
      body: JSON.stringify({ workspaceId: ws.id }),
    })).json();
    if (!inv.token) throw new Error("invite mint failed");
    const join = await callerFetch(`/api/invite/${inv.token}`, { method: "POST" });
    if (!join.ok) throw new Error(`invite join: ${join.status}`);
    callerCookie = cookieFrom(join) || callerCookie;
    room = await mkRoom();
  }
  if (!room?.id) throw new Error("room create/dedup failed");
  bridgeRoom = room.id;
  return bridgeRoom;
}

async function notionCallState() {
  if (!bridgeRoom) return null;
  let res = await callerFetch(`/api/calls/${bridgeRoom}`);
  if (res.status === 401) {
    callerCookie = (await demoLogin(NOTION_CALLER)).cookie;
    res = await callerFetch(`/api/calls/${bridgeRoom}`);
  }
  if (!res.ok) return null;
  return (await res.json()).call ?? null;
}

async function handleNotionCall(req, res, url) {
  res.setHeader("Content-Type", MIME[".json"]);
  try {
    if (url.pathname === "/api/notion-call" && req.method === "POST") {
      await ensureRoom();
      const live = await notionCallState();
      if (!live) {
        const r = await callerFetch(`/api/calls/${bridgeRoom}`, {
          method: "POST",
          body: JSON.stringify({ action: "invite" }),
        });
        if (!r.ok && r.status !== 409) throw new Error(`invite: ${r.status}`);
      }
      res.end(JSON.stringify({ ok: true, roomId: bridgeRoom, already: !!live }));
    } else if (url.pathname === "/api/notion-call" && req.method === "GET") {
      res.end(JSON.stringify({ roomId: bridgeRoom, call: await notionCallState() }));
    } else if (url.pathname === "/api/notion-call/signal" && req.method === "POST") {
      const { action, sdp } = await readBody(req);
      if ((action !== "offer" && action !== "answer") || !sdp) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "expected {action: offer|answer, sdp}" }));
        return;
      }
      const r = await callerFetch(`/api/calls/${bridgeRoom}`, {
        method: "POST",
        body: JSON.stringify({ action, sdp }),
      });
      res.writeHead(r.status);
      res.end(JSON.stringify(await r.json().catch(() => ({}))));
    } else if (url.pathname === "/api/notion-call/end" && req.method === "POST") {
      // ringing → only the caller may "cancel"; live → either side may "end".
      const call = await notionCallState();
      if (call && bridgeRoom) {
        const action = call.status === "ringing" ? "cancel" : "end";
        await callerFetch(`/api/calls/${bridgeRoom}`, {
          method: "POST",
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
  // no-store: a stale cached page speaks an old bridge protocol and can
  // sabotage live calls (it once auto-cancelled every ring)
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(fs.readFileSync(file));
});

server.listen(PORT, () => {
  console.log(`Video Call UI: http://localhost:${PORT}`);
});
