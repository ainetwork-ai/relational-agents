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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`[req-log] ${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${req.url}`);
  if (url.pathname === "/api/calls") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ calls: CALLS }));
    return;
  }
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
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
