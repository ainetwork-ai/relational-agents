// Proxy routes — the only door bytes go out through.
//
// These two branches are the **grounds** for allowing html/svg in the upload allowlist:
//   download  always Content-Disposition: attachment · generic type
//   stream    inline only for media that passes isStreamableMedia, 415 for the rest
// If this breaks, an attached html renders as a document on our origin and the session is stolen.
//
// Access follows comment → page. Someone else's file must be **404**, not 403
// (existence is not revealed).
//
//   [BASE_URL=…] [ROW_PAGE_ID=…] [USER_ID=…] [OTHER_USER_ID=…] node e2e/file-routes.check.mjs

import fs from "node:fs";
import path from "node:path";
import { sealData } from "iron-session";
import { Client } from "pg";
import { content } from "./i18n.mjs";

const C = content.FILE_ROUTES;

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.ROW_PAGE_ID ?? "27b5c5e5-467c-4620-bde7-8d087e8a9875";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const pg = new Client({ connectionString: pgUrl });
await pg.connect();
const { rows: hasTable } = await pg.query(
  "select 1 from information_schema.tables where table_name='files'"
);
if (!hasTable.length) {
  console.error("\n  There is no files table — push the schema to this DB first.\n");
  await pg.end();
  process.exit(1);
}

 // put real bytes on disk (the pre-migration path) and make a files row pointing at them
const dir = path.join(process.cwd(), "public", "uploads");
fs.mkdirSync(dir, { recursive: true });
const made = [];
async function addFile(name, bytes, mime, commentId) {
  const stored = `check-${crypto.randomUUID()}${path.extname(name)}`;
  fs.writeFileSync(path.join(dir, stored), bytes);
  made.push(path.join(dir, stored));
  const { rows } = await pg.query(
    "insert into files (comment_id, user_id, file_name, file_url, file_size, mime_type) values ($1,$2,$3,$4,$5,$6) returning id",
    [commentId, USER_ID, name, `/uploads/${stored}`, bytes.length, mime]
  );
  return rows[0].id;
}

const { rows: cRows } = await pg.query(
  "insert into comments (page_id, block_id, parent_id, author_id, body) values ($1,null,null,$2,$3) returning id",
  [PAGE_ID, USER_ID, C.commentBody]
);
const commentId = cRows[0].id;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const pngId = await addFile("shot.png", PNG, "image/png", commentId);
const htmlId = await addFile(
  "report.html",
  Buffer.from("<script>window.__ran=1</script>"),
  "text/html",
  commentId
);

const get = (url) => fetch(`${BASE}${url}`, { headers: { cookie: `rm-session=${cookie}` }, redirect: "manual" });
const d = [];

 // 1) download — anything, only as an attachment
for (const [label, id] of [["png", pngId], ["html", htmlId]]) {
  const r = await get(`/api/files/${id}/download`);
  if (!r.ok) { d.push(`${label} download is ${r.status}`); continue; }
  const cd = r.headers.get("content-disposition") ?? "";
  const ct = r.headers.get("content-type") ?? "";
  if (!/^attachment/.test(cd)) d.push(`${label} download disposition is "${cd}" — it should be attachment`);
  if (/text\/html|image\/svg/.test(ct)) d.push(`${label} download goes out as ${ct} — it could render as a document`);
  if ((r.headers.get("x-content-type-options") ?? "") !== "nosniff") d.push(`${label} download has no nosniff`);
}

 // 2) stream — media only
const sPng = await get(`/api/files/${pngId}/stream`);
if (!sPng.ok) d.push(`png stream is ${sPng.status} — images must be inline`);
else {
  if ((sPng.headers.get("content-type") ?? "") !== "image/png") d.push(`png stream type is ${sPng.headers.get("content-type")}`);
  if ((sPng.headers.get("content-disposition") ?? "") !== "inline") d.push("png stream is not inline");
}
const sHtml = await get(`/api/files/${htmlId}/stream`);
if (sHtml.status !== 415)
  d.push(`html stream is ${sHtml.status} — it should be 415. Served inline, it runs on our origin`);

 // 3) a missing id, and a request without login
const missing = await get(`/api/files/${crypto.randomUUID()}/download`);
if (missing.status !== 404) d.push(`a missing file is ${missing.status} — it should be 404`);
const anon = await fetch(`${BASE}/api/files/${pngId}/download`, { redirect: "manual" });
if (anon.status < 400) d.push(`a logged-out request got through with ${anon.status}`);

 // 4) deleting the comment takes the file rows with it (so orphans can be found in one query)
await pg.query("delete from comments where id=$1", [commentId]);
const { rows: left } = await pg.query("select count(*)::int n from files where comment_id=$1", [commentId]);
if (left[0].n !== 0) d.push(`the comment was deleted but ${left[0].n} files rows remain — there should be a cascade`);
const after = await get(`/api/files/${pngId}/download`);
if (after.status !== 404) d.push(`the row is gone but it still downloads with ${after.status}`);

await pg.end();
for (const f of made) fs.rmSync(f, { force: true });

if (d.length) {
  console.error("\n  ┌─ The file proxy routes differ from the contract ─────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ This contract is the grounds for allowing html/svg in allowed-types");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("proxy routes OK — download is always attachment, stream is media only (html 415), logged-out/missing id is 404, cascade on comment delete");

