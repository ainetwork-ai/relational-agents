// The premise of video playback — does the file proxy answer `Range` with 206.
//
// Why this is worth a check: `<video>` seeking and iOS Safari playback assume 206 Partial
// Content. Given the whole file as a 200, Safari refuses to play at all. We left out only
// this part when porting the ainteams file stack — `streamFile(bucket,key,range)` accepted
// partial reads from the start, but no route passed a range.
// Measurements and background: docs/notion-video.md §4.
//
//   [BASE_URL=…] [PAGE_ID=…] node e2e/file-range.check.mjs
//
// Uses only the files and comments it uploads, and deletes them at the end.
import fs from "node:fs";
import { sealData } from "iron-session";
import { Client } from "pg";
import { content } from "./i18n.mjs";

const C = content.FILE_RANGE;

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const ME = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const PAGE_ID = process.env.PAGE_ID ?? "46802c30-928f-4df6-a032-c53e478e7f73";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const cookie = await sealData({ userId: ME }, { password: secret, ttl: 0 });
const H = { cookie: `rm-session=${cookie}` };

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};

// It need not be a playable file — what is measured is HTTP semantics, not decoding.
const SIZE = 4096;
const BODY = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) BODY[i] = i % 251;

const pg = new Client({ connectionString: pgUrl });
await pg.connect();
const madeComments = [];
let fileId = null;
let imageId = null;

async function upload(name, type, bytes) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), name);
  fd.append("kind", "file"); // the generic allowlist — the default path is image-only
  const r = await fetch(`${BASE}/api/upload`, { method: "POST", headers: H, body: fd });
  if (!r.ok) throw new Error(`upload ${name} failed: ${r.status} ${(await r.text()).slice(0, 120)}`);
  return await r.json();
}

async function attach(up, name) {
  const r = await fetch(`${BASE}/api/pages/${PAGE_ID}/comments`, {
    method: "POST",
    headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({
      body: `${C.commentBody} (${name})`,
      blockId: null,
      attachments: [{ url: up.url, name, size: SIZE, mimeType: up.mimeType ?? undefined }],
    }),
  });
  if (!r.ok) throw new Error(`comment failed: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const { comment } = await r.json();
  madeComments.push(comment.id);
  const id = comment.attachments?.[0]?.id;
  if (!id) throw new Error("no attachment id came back");
  return id;
}

const get = (id, range) =>
  fetch(`${BASE}/api/files/${id}/stream`, { headers: range ? { ...H, range } : H });

try {
  const upVideo = await upload("clip.mp4", "video/mp4", BODY);
  fileId = await attach(upVideo, "clip.mp4");
  check("0. made the video attachment", !!fileId, String(fileId));

  // ── R1. without Range ─────────────────────────────────────────────────────
  {
    const r = await get(fileId);
    const buf = Buffer.from(await r.arrayBuffer());
    check("R1. without Range, 200 with everything", r.status === 200 && buf.length === SIZE, `status=${r.status} len=${buf.length}`);
    check("R1. announces Accept-Ranges", r.headers.get("accept-ranges") === "bytes", String(r.headers.get("accept-ranges")));
    check("R1. Content-Type is video/mp4", r.headers.get("content-type") === "video/mp4", String(r.headers.get("content-type")));
    check("R1. the bytes match what was uploaded", buf.equals(BODY));
  }

  // ── R2. the first 100 bytes ───────────────────────────────────────────────
  {
    const r = await get(fileId, "bytes=0-99");
    const buf = Buffer.from(await r.arrayBuffer());
    check("R2. bytes=0-99 → 206", r.status === 206, `status=${r.status}`);
    check("R2. Content-Range is right", r.headers.get("content-range") === `bytes 0-99/${SIZE}`, String(r.headers.get("content-range")));
    check("R2. Content-Length 100 · actually 100 bytes", r.headers.get("content-length") === "100" && buf.length === 100, `len=${buf.length}`);
    check("R2. those 100 bytes are the start of the file", buf.equals(BODY.subarray(0, 100)));
  }

  // ── R3. suffix — the shape a player probes first when the mp4 moov is at the end ─
  {
    const r = await get(fileId, "bytes=-16");
    const buf = Buffer.from(await r.arrayBuffer());
    check("R3. bytes=-16 (last 16 bytes) → 206", r.status === 206, `status=${r.status}`);
    check("R3. Content-Range points at the end", r.headers.get("content-range") === `bytes ${SIZE - 16}-${SIZE - 1}/${SIZE}`, String(r.headers.get("content-range")));
    check("R3. those 16 bytes are the end of the file", buf.length === 16 && buf.equals(BODY.subarray(SIZE - 16)), `len=${buf.length}`);
  }

  // ── R4. open end ──────────────────────────────────────────────────────────
  {
    const r = await get(fileId, "bytes=4000-");
    const buf = Buffer.from(await r.arrayBuffer());
    check("R4. bytes=4000- → 206 to the end", r.status === 206 && buf.length === SIZE - 4000, `status=${r.status} len=${buf.length}`);
  }

  // ── R5. outside the file ──────────────────────────────────────────────────
  {
    const r = await get(fileId, `bytes=${SIZE}-`);
    check("R5. 416 when the range is outside the file", r.status === 416, `status=${r.status}`);
    check("R5. 416 carries Content-Range: bytes */size", r.headers.get("content-range") === `bytes */${SIZE}`, String(r.headers.get("content-range")));
  }

  // ── R6. an unrecognised form gets everything, not 416 ─────────────────────
  {
    const r = await get(fileId, "bytes=0-9,20-29");
    const buf = Buffer.from(await r.arrayBuffer());
    check("R6. multiple ranges are answered with a full 200 (not 416)", r.status === 200 && buf.length === SIZE, `status=${r.status} len=${buf.length}`);
  }

  // ── R7. images have nothing to seek ───────────────────────────────────────
  {
    const upImg = await upload("dot.png", "image/png", BODY);
    imageId = await attach(upImg, "dot.png");
    const r = await get(imageId);
    await r.arrayBuffer();
    check("R7. no Accept-Ranges on images", r.headers.get("accept-ranges") === null, String(r.headers.get("accept-ranges")));
    const r2 = await get(imageId, "bytes=0-9");
    const b2 = Buffer.from(await r2.arrayBuffer());
    check("R7. still answers 206 when asked", r2.status === 206 && b2.length === 10, `status=${r2.status} len=${b2.length}`);
  }
} catch (e) {
  check("run", false
, String(e).slice(0, 300));
} finally {
  for (const id of madeComments) {
    await fetch(`${BASE}/api/comments/${id}`, { method: "DELETE", headers: H }).catch(() => {});
  }
  await pg.end().catch(() => {});
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
