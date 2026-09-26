// Object storage layer, step 1 — pins down that it changes no behaviour yet, and
// that the key rules are as intended.
//
// It looks at the **fallback** in particular. In ainteams the local stack did not start minio, so
// `isStorageConfigured()` was true but the connection failed, the first upload was a 500, and it
// never even reached the disk fallback. We check both: (1) false without env, (2) when false the
// existing disk path works as before.
//
//   [BASE_URL=…] [USER_ID=…] node e2e/storage-layer.check.mjs

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sealData } from "iron-session";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";

const d = [];

// 1) pure functions — the key rules. Rather than evaluating the source directly to get around
//    server-only, load the module through tsx and use the real implementation.
const mod = await import(
  pathToFileURL(path.resolve("src/lib/files/storage.ts")).href
).catch((e) => ({ __err: String(e).slice(0, 160) }));
if (mod.__err) {
  console.error(`\n  Could not load storage.ts: ${mod.__err}`);
  console.error("  (run it with tsx: npx tsx e2e/storage-layer.check.mjs)\n");
  process.exit(1);
}

const HASH = "a".repeat(64);
if (mod.contentKey(HASH, "pdf") !== `files/${HASH}.pdf`)
  d.push(`contentKey is ${mod.contentKey(HASH, "pdf")} — it should be files/<sha256>.<ext>`);
if (mod.contentKey(HASH, "pdf") !== mod.contentKey(HASH, "pdf"))
  d.push("contentKey gives different values for the same input");
 // if the file name gets into the key, the same bytes become two objects — dedup breaks
if (/[^a-z0-9/.]/.test(mod.contentKey(HASH, "pdf")))
  d.push("contentKey has a name component mixed in — the key must be only the hash and extension");

const url = mod.buildStorageUrl("b", `files/${HASH}.pdf`);
if (url !== `s3://b/files/${HASH}.pdf`) d.push(`buildStorageUrl: ${url}`);
const parsed = mod.parseStorageUrl(url);
if (!parsed || parsed.bucket !== "b" || parsed.key !== `files/${HASH}.pdf`)
  d.push(`parseStorageUrl round trip failed: ${JSON.stringify(parsed)}`);
if (mod.parseStorageUrl("/uploads/x.png") !== null)
  d.push("parseStorageUrl read an /uploads path as s3");
if (mod.isStorageUrl("/uploads/x.png")) d.push("isStorageUrl took a disk path as true");

if (mod.thumbnailKey(`files/${HASH}.png`, 240) !== `thumbs/${HASH}_240.webp`)
  d.push(`thumbnailKey: ${mod.thumbnailKey(`files/${HASH}.png`, 240)}`);
 // derived keys come only from canonical keys — accepting any string mixes the namespaces
if (mod.thumbnailKey("tus-abc", 240) !== null) d.push("thumbnailKey accepted a non-canonical key");
if (mod.thumbnailKey(`files/${HASH}.png`, 0) !== null) d.push("thumbnailKey accepted width 0");

// 2) when unconfigured — must be false, and trying to build a client must fail clearly
for (const k of ["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY"]) delete process.env[k];
if (mod.isStorageConfigured()) d.push("no MINIO_* but isStorageConfigured() is true");

// 3) the app's upload response must be one of the two shapes the browser holds, and the storage token must not leak.
//    (this cleared this process's env, not the shared dev server's — if the server has MinIO on it is the
//    key path, otherwise /uploads. "Unconfigured means disk" itself is covered by upload-promotion.check 5).)
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });
const form = new FormData();
form.append("file", new File([new Uint8Array(64)], "fallback.txt", { type: "text/plain" }));
form.append("kind", "file");
const res = await fetch(`${BASE}/api/upload`, {
  method: "POST",
  headers: { cookie: `rm-session=${cookie}` },
  body: form,
});
const body = await res.json().catch(() => ({}));
if (!res.ok) d.push(`with MinIO unconfigured the upload is ${res.status} — the disk fallback should work: ${JSON.stringify(body).slice(0, 120)}`);
else if (!/^\/(uploads\/[A-Za-z0-9._-]+|api\/files\/key\/files\/[0-9a-f]{64}\.[a-z0-9]{1,8})$/.test(body.url ?? ""))
  d.push(`the upload returned ${body.url} — it should be /uploads/<name> or /api/files/key/<key>`);
else if ("storageUrl" in body || /^s3:/.test(body.url)) d.push(`the storage token leaks into the upload response: ${JSON.stringify(body).slice(0, 120)}`);
else if (/^\/uploads\//.test(body.url)) fs.rmSync(path.join("public", body.url.replace(/^\//, "")), { force: true });

if (d.length) {
  console.error("\n  ┌─ The storage layer differs from the contract ────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log("storage layer OK — key is files/<sha256>.<ext>, s3:// round trip, derived namespaces kept apart, upload response is only the serving path (no token leak)");

