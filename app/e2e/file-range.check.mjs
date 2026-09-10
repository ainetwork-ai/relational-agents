// 동영상 재생의 전제 — 파일 프록시가 `Range` 를 206 으로 답하는가.
//
// 왜 이게 검사거리인가: `<video>` 의 탐색(seek)과 iOS Safari 의 재생이 206 Partial
// Content 를 전제한다. 200 으로 전체를 주면 사파리는 재생 자체를 거부한다. 우리는
// ainteams 의 파일 스택을 포팅하면서 이 부분만 빠뜨렸었다 — `streamFile(bucket,key,range)`
// 는 처음부터 부분 읽기를 받는데 어떤 라우트도 range 를 넘기지 않았다.
// 측정·배경: docs/notion-video.md §4.
//
//   [BASE_URL=…] [PAGE_ID=…] node e2e/file-range.check.mjs
//
// 자기가 올린 파일과 댓글만 쓰고 끝나면 지운다.
import fs from "node:fs";
import { sealData } from "iron-session";
import { Client } from "pg";

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

// 재생 가능한 파일일 필요는 없다 — 재는 것은 HTTP 의미론이지 디코딩이 아니다.
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
      body: `range 검사용 (${name})`,
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
  check("0. 동영상 첨부를 만들었다", !!fileId, String(fileId));

  // ── R1. Range 없이 ────────────────────────────────────────────────────────
  {
    const r = await get(fileId);
    const buf = Buffer.from(await r.arrayBuffer());
    check("R1. Range 없으면 200 전체", r.status === 200 && buf.length === SIZE, `status=${r.status} len=${buf.length}`);
    check("R1. Accept-Ranges 를 알린다", r.headers.get("accept-ranges") === "bytes", String(r.headers.get("accept-ranges")));
    check("R1. Content-Type 이 video/mp4", r.headers.get("content-type") === "video/mp4", String(r.headers.get("content-type")));
    check("R1. 바이트가 올린 것과 같다", buf.equals(BODY));
  }

  // ── R2. 앞에서 100바이트 ──────────────────────────────────────────────────
  {
    const r = await get(fileId, "bytes=0-99");
    const buf = Buffer.from(await r.arrayBuffer());
    check("R2. bytes=0-99 → 206", r.status === 206, `status=${r.status}`);
    check("R2. Content-Range 가 맞다", r.headers.get("content-range") === `bytes 0-99/${SIZE}`, String(r.headers.get("content-range")));
    check("R2. Content-Length 100 · 실제 100바이트", r.headers.get("content-length") === "100" && buf.length === 100, `len=${buf.length}`);
    check("R2. 그 100바이트가 파일의 앞부분", buf.equals(BODY.subarray(0, 100)));
  }

  // ── R3. suffix — mp4 의 moov 가 뒤에 있어 플레이어가 먼저 훑는 형태 ───────
  {
    const r = await get(fileId, "bytes=-16");
    const buf = Buffer.from(await r.arrayBuffer());
    check("R3. bytes=-16 (마지막 16바이트) → 206", r.status === 206, `status=${r.status}`);
    check("R3. Content-Range 가 끝을 가리킨다", r.headers.get("content-range") === `bytes ${SIZE - 16}-${SIZE - 1}/${SIZE}`, String(r.headers.get("content-range")));
    check("R3. 그 16바이트가 파일의 끝", buf.length === 16 && buf.equals(BODY.subarray(SIZE - 16)), `len=${buf.length}`);
  }

  // ── R4. 열린 끝 ───────────────────────────────────────────────────────────
  {
    const r = await get(fileId, "bytes=4000-");
    const buf = Buffer.from(await r.arrayBuffer());
    check("R4. bytes=4000- → 끝까지 206", r.status === 206 && buf.length === SIZE - 4000, `status=${r.status} len=${buf.length}`);
  }

  // ── R5. 파일 밖 ───────────────────────────────────────────────────────────
  {
    const r = await get(fileId, `bytes=${SIZE}-`);
    check("R5. 범위가 파일 밖이면 416", r.status === 416, `status=${r.status}`);
    check("R5. 416 에 Content-Range: bytes */size", r.headers.get("content-range") === `bytes */${SIZE}`, String(r.headers.get("content-range")));
  }

  // ── R6. 못 알아본 형식은 416 이 아니라 전체 ───────────────────────────────
  {
    const r = await get(fileId, "bytes=0-9,20-29");
    const buf = Buffer.from(await r.arrayBuffer());
    check("R6. 다중 구간은 200 전체로 답한다 (416 이 아니다)", r.status === 200 && buf.length === SIZE, `status=${r.status} len=${buf.length}`);
  }

  // ── R7. 이미지는 탐색할 것이 없다 ─────────────────────────────────────────
  {
    const upImg = await upload("dot.png", "image/png", BODY);
    imageId = await attach(upImg, "dot.png");
    const r = await get(imageId);
    await r.arrayBuffer();
    check("R7. 이미지에는 Accept-Ranges 를 붙이지 않는다", r.headers.get("accept-ranges") === null, String(r.headers.get("accept-ranges")));
    const r2 = await get(imageId, "bytes=0-9");
    const b2 = Buffer.from(await r2.arrayBuffer());
    check("R7. 그래도 요청이 오면 206 으로 답한다", r2.status === 206 && b2.length === 10, `status=${r2.status} len=${b2.length}`);
  }
} catch (e) {
  check("실행", false, String(e).slice(0, 300));
} finally {
  for (const id of madeComments) {
    await fetch(`${BASE}/api/comments/${id}`, { method: "DELETE", headers: H }).catch(() => {});
  }
  await pg.end().catch(() => {});
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
