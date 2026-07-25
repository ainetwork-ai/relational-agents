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
const CALLS = [
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
