// The clip on the comment input row — does it open the same way as the original, and do the chosen files attach to the comment?
//
// What was measured on the original (file chooser intercepted over CDP, so nothing was actually picked):
// clicking the clip opens the **native file chooser** straight away with no menu, mode is
// selectMultiple, and the input has no accept restriction (any file).
//
//   [BASE_URL=…] [ROW_PAGE_ID=…] [USER_ID=…] node e2e/comment-attachment.check.mjs
//
// Creates comments and /uploads files in the dev DB — removes them at the end.

import fs from "node:fs";
import path from "node:path";
import { sealData } from "iron-session";
import { chromium } from "@playwright/test";
import zlib from "node:zlib";
import { Client } from "pg";
import { ko } from "./i18n.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const PAGE_ID = process.env.ROW_PAGE_ID ?? "27b5c5e5-467c-4620-bde7-8d087e8a9875";
const USER_ID = process.env.USER_ID ?? "8ccf17a7-24fb-4ae9-974c-94bf5db0cf85";

const F = JSON.parse(
  fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-row-comments.json", import.meta.url), "utf8")
);

/** A real w×h PNG — seeing a tall image get boxed at 240 needs actual pixels. */
function tallPng(w, h) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const pgUrl = env.match(/^POSTGRES_URL=(.*)$/m)[1].trim();
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const pg = new Client({ connectionString: pgUrl });
await pg.connect();
const { rows: has } = await pg.query(
  "select 1 from information_schema.tables where table_name='files'"
);
if (!has.length) {
  console.error("\n  No files table — push the schema to this DB first.\n");
  await pg.end();
  process.exit(1);
}

 // Files to upload: one image plus the others below
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "cmt-"));
// A very tall image — the original boxes these at 240 high (2048x2731 → 180.5x240)
const png = path.join(tmp, "tall.png");
fs.writeFileSync(png, tallPng(60, 400));
// Extensions actually attached to comments in the original
// Extensions actually attached to comments in the original, at their size range — back when the cap was 10MB
// the large ones were silently rejected, which looked like "only images attach".
const OTHERS = [
  ["report.pdf", 12 * 1024 * 1024],
  ["sheet.xlsx", 13 * 1024],
  ["deck.pptx", 2 * 1024 * 1024], // under the old 10MB cap — control
  ["doc.hwp", 11 * 1024 * 1024],
  ["bundle.zip", 13 * 1024 * 1024],
];
const others = OTHERS.map(([n, bytes]) => {
  const f = path.join(tmp, n);
  fs.writeFileSync(f, Buffer.alloc(bytes, 7));
  return f;
});
// html attaches but **must not execute on our origin**: public/uploads is the same
// origin, so a running <script> is stored XSS in itself. We used to block it by
// renaming the extension to .txt; now next.config.ts adds
// `Content-Security-Policy: sandbox` + `nosniff` to /uploads/* — so the extension
// can stay. That header is the premise for allowed-types permitting html/svg.
// Executables are left out of the list — the client must block them before any round trip
const blocked = path.join(tmp, "payload.js");
fs.writeFileSync(blocked, "alert(1)");
const html = path.join(tmp, "report.html");
fs.writeFileSync(html, "<h1>hi</h1><script>window.__ran = 1</script>");
others.push(html);
OTHERS.push(["report.html", 0]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: "rm-session", value: cookie, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
page.on("response", async (r) => {
  if (!/\/comments$|\/api\/upload$/.test(new URL(r.url()).pathname)) return;
  if (r.status() >= 400)
    console.error("  request failed:", r.status(), new URL(r.url()).pathname,
      (await r.text().catch(() => "")).slice(0, 120));
});
await page.goto(`${BASE}/p/${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("[data-testid='comment-composer-input']", { timeout: 120_000 });
await page.waitForTimeout(1200);

const d = [];

 // 1) Does the clip open a file chooser — with multiple and no accept restriction?
const input = page.locator("[data-testid='comment-file-input']");
if (!(await input.count())) d.push("No file input for the clip");
else {
  const attrs = await input.evaluate((el) => ({ multiple: el.multiple, accept: el.getAttribute("accept") }));
  if (!attrs.multiple) d.push("Cannot pick several — the original is selectMultiple");
  if (attrs.accept) d.push(`accept="${attrs.accept}" is set — the original has no restriction`);
}
// Uploads go over tus — catch a regression to one buffered shot (POST /api/upload)
const tusHits = { create: 0, patch: 0, buffered: 0 };
page.on("request", (r) => {
  const p2 = new URL(r.url()).pathname;
  if (p2 === "/api/upload" && r.method() === "POST") tusHits.buffered++;
  else if (p2 === "/api/upload/tus" && r.method() === "POST") tusHits.create++;
  else if (p2.startsWith("/api/upload/tus/") && r.method() === "PATCH") {
    tusHits.patch++;
   // The last PATCH body is the url the browser ends up holding — it must not be a storage token
    r.response().then((res) => res?.text()).then((body) => {
      if (!body) return;
      try {
        const j = JSON.parse(body);
        if (typeof j.url === "string" && !/^\/(api\/files\/key\/files\/[0-9a-f]{64}\.[a-z0-9]{1,8}|uploads\/[A-Za-z0-9._-]+)$/.test(j.url))
          tusHits.badUrl = j.url;
        if ("storageUrl" in j) tusHits.badUrl = `storageUrl exposed: ${j.storageUrl}`;
      } catch { /* not the finish body */ }
    }).catch(() => {});
  }
});
const chooser = page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
await page.click(`[aria-label='${ko("Attach file")}']`);
const fc = await chooser;
if (!fc) d.push("Clicking the clip does not open a file chooser");
else if (!fc.isMultiple()) d.push("The chooser is single-select — the original is selectMultiple");

 // 2) Do the chosen files show as chips, and attach to the comment when sent?
if (fc) {
  await fc.setFiles([png, ...others]);
  await page.waitForSelector("[data-testid='attachment-chip']", { timeout: 60_000 });
 // Big files take a while to upload — wait until the count is reached
  await page
    .waitForFunction(
      (n) => document.querySelectorAll("[data-testid='attachment-chip']").length >= n,
      1 + others.length,
      { timeout: 120_000 }
    )
    .catch(() => {});
  const chips = await page.locator("[data-testid='attachment-chip']").count();
  if (chips !== 1 + others.length) d.push(`Picked ${1 + others.length} files but there are ${chips} chips`);

 // Must be sendable with files only, no body
  const sendDisabled = await page.locator("[data-testid='comment-composer-submit']").isDisabled();
  if (sendDisabled) d.push("Send is disabled with only files attached — files alone make a comment");
  await page.click("[data-testid='comment-composer-submit']");
  await page.waitForTimeout(2500);

  const saved = await pg.query(
    `select f.file_name as name, f.file_url as url, f.file_size as size, f.mime_type
       from files f join comments c on c.id = f.comment_id
      where c.page_id = $1`,
    [PAGE_ID]
  );
  const att = saved.rows.map((r) => ({ ...r, size: r.size ?? undefined }));
  if (att.length !== 1 + others.length)
    d.push(`${att.length} attachments saved — should be ${1 + others.length}`);
  for (const a of att)
    if (typeof a.size !== "number") d.push(`"${a.name}" has no size — the original shows it like 12.7 KiB`);
 // Images via stream, everything else via download — the client never holds the storage key
  const srcs = await page.evaluate(() => ({
    imgs: [...document.querySelectorAll("[data-testid='comment-attachment-image']")].map((e) => e.getAttribute("src")),
    links: [...document.querySelectorAll("[data-testid='comment-attachment-file']")].map((e) => e.getAttribute("href")),
  }));
  for (const u of srcs.imgs)
    if (!/^\/api\/files\/[0-9a-f-]{36}\/stream$/.test(u ?? ""))
      d.push(`image src is ${u} — should be /api/files/<id>/stream`);
  for (const u of srcs.links)
    if (!/^\/api\/files\/[0-9a-f-]{36}\/download$/.test(u ?? ""))
      d.push(`file link is ${u} — should be /api/files/<id>/download`);
 // The stored location must be one of two — a content address in object storage,
 // or a disk file name from before the migration. Anything else is not a url we made.
  for (const a of att)
    if (!/^s3:\/\/[^/]+\/files\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/.test(a.url) &&
        !/^\/uploads\/[A-Za-z0-9._-]+$/.test(a.url))
      d.push(`odd attachment url: ${a.url}`);

  const R = F.clip.attachmentRendering;
 // Is html not served as an executable document?
  const htmlAtt = att.find((a) => a.name === "report.html");
  if (!htmlAtt) d.push("report.html was not attached — html must attach too");
  else {
 // This line of defence only applies to the pre-migration (disk) path. After moving to s3://
 // the proxy route takes that role, and its contract is checked by file-routes.check.mjs.
  if (!/^\/uploads\//.test(htmlAtt.url)) {
    console.log(`· report.html is at ${htmlAtt.url.slice(0, 12)}…, so the proxy route blocks it instead of the /uploads CSP`);
  } else {
    const r = await page.request.get(`${BASE}${htmlAtt.url}`);
    const h = r.headers();
    if ((h["content-security-policy"] ?? "") !== "sandbox")
      d.push(`CSP on the /uploads response is "${h["content-security-policy"] ?? "(none)"}" — should be sandbox. Without it attached html/svg runs on our origin`);
    if ((h["x-content-type-options"] ?? "") !== "nosniff")
      d.push(`No nosniff on the /uploads response — bypassable via MIME confusion`);
    }
  }

 // Extensions not on the allow list must not attach (no upload request may go out at all)
  let uploadedBlocked = false;
  const onUpload = (r) => {
    if (r.method() === "POST" && /\/api\/upload$/.test(new URL(r.url()).pathname)) uploadedBlocked = true;
  };
  const before = await page.locator("[data-testid='attachment-chip']").count();
  page.on("request", onUpload);
  uploadedBlocked = false;
  const fc2 = page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
 // (the click below opens that chooser)
  await page.click(`[aria-label='${ko("Attach file")}']`);
  const c2 = await fc2;
  if (!c2) d.push("The second clip click did not open a chooser — this check ran idle");
  else await c2.setFiles([blocked]);
  await page.waitForTimeout(2500);
  page.off("request", onUpload);
  const after = await page.locator("[data-testid='attachment-chip']").count();
  if (after !== before) d.push("payload.js was attached — executables are not on the allow list");
  if (uploadedBlocked) d.push("An upload request went out for payload.js — the client must block it before the round trip");

  const shown = await page.evaluate(() => {
    const px = (v) => +Number(v).toFixed(1);
    const img = document.querySelector("[data-testid='comment-attachment-image']");
    const name = document.querySelector("[data-testid='comment-attachment-name']");
    const size = document.querySelector("[data-testid='comment-attachment-size']");
    const st = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el), r = el.getBoundingClientRect();
      return { w: px(r.width), h: px(r.height), fs: c.fontSize, fw: c.fontWeight,
               lh: c.lineHeight, color: c.color, maxW: c.maxWidth, maxH: c.maxHeight,
               fit: c.objectFit, radius: c.borderRadius, text: (el.innerText || "").trim() };
    };
    return {
      images: document.querySelectorAll("[data-testid='comment-attachment-image']").length,
      files: document.querySelectorAll("[data-testid='comment-attachment-file']").length,
      chips: document.querySelectorAll("[data-testid='attachment-chip']").length,
      img: st(img), name: st(name), size: st(size),
      icons: document.querySelectorAll("[data-testid='comment-attachment-file'] svg").length,
    };
  });
  if (shown.images !== 1) d.push(`${shown.images} images drawn in the comment — should be 1`);
  if (shown.files !== others.length)
    d.push(`${shown.files} file rows drawn in the comment — should be ${others.length} (${OTHERS.map((o) => o[0]).join(", ")})`);
  if (shown.chips) d.push("Chips remain in the input row after sending");

 // Image: must be boxed at 240 — a tall one must not stretch to its real size
  if (shown.img) {
    if (shown.img.maxW !== R.image.maxWidth) d.push(`image max-width: ours ${shown.img.maxW} / Notion ${R.image.maxWidth}`);
    if (shown.img.maxH !== R.image.maxHeight) d.push(`image max-height: ours ${shown.img.maxH} / Notion ${R.image.maxHeight}`);
    if (shown.img.fit !== R.image.objectFit) d.push(`image object-fit: ours ${shown.img.fit} / Notion ${R.image.objectFit}`);
    if (shown.img.radius !== R.image.borderRadius) d.push(`image radius: ours ${shown.img.radius} / Notion ${R.image.borderRadius}`);
    if (shown.img.h > 240.5) d.push(`The tall image was drawn at ${shown.img.h}px — must not exceed 240`);
    if (shown.img.w > 240.5) d.push(`The image was drawn at ${shown.img.w}px — must not exceed 240`);
  }
 // File: a name line + a size line, no icon
  if (shown.name) {
    if (shown.name.fs !== R.file.name.fs || shown.name.fw !== R.file.name.fw || shown.name.lh !== R.file.name.lh)
      d.push(`file name type: ours ${shown.name.fs}/${shown.name.fw}/${shown.name.lh} / Notion ${R.file.name.fs}/${R.file.name.fw}/${R.file.name.lh}`);
    if (shown.name.color !== R.file.name.color) d.push(`file name color: ours ${shown.name.color} / Notion ${R.file.name.color}`);
  } else d.push("No file name line");
  if (shown.size) {
    if (shown.size.fs !== R.file.size.fs || shown.size.lh !== R.file.size.lh)
      d.push(`size type: ours ${shown.size.fs}/${shown.size.lh} / Notion ${R.file.size.fs}/${R.file.size.lh}`);
    if (shown.size.color !== R.file.size.color) d.push(`size color: ours ${shown.size.color} / Notion ${R.file.size.color}`);
    if (!/^\d+(\.\d+)? (B|KiB|MiB|GiB)$/.test(shown.size.text))
      d.push(`size reads "${shown.size.text}" — the original uses binary units like 12.7 KiB`);
  } else d.push("No size line — the original writes the size under the name");
  if (shown.icons) d.push(`${shown.icons} icons in the file rows — the original has none`);

 // Did it actually take the resumable path? A 13MB file in 8MB chunks needs two or more PATCHes.
  if (tusHits.buffered) d.push(`${tusHits.buffered} uploads went via the buffered path (POST /api/upload) — attachments must use tus`);
  if (tusHits.badUrl) d.push(`The upload response gave the browser ${tusHits.badUrl} — the client should only hold the serving path (the storage key is the server's)`);
  if (tusHits.create !== 1 + others.length)
    d.push(`${tusHits.create} tus creations — should equal the file count (${1 + others.length})`);
  if (tusHits.patch <= tusHits.create)
    d.push(`Only ${tusHits.patch} tus PATCHes — with 8MB chunks the one 13MB file alone should produce more (chunks were not split)`);
}

await browser.close();
const { rows: gone } = await pg.query(
  `with removed as (
     select f.file_url from files f join comments c on c.id = f.comment_id
      where c.page_id = $1 and c.author_id = $2)
   select file_url from removed`,
  [PAGE_ID, USER_ID]
);
await pg.query("delete from comments where page_id=$1 and author_id=$2", [PAGE_ID, USER_ID]);
await pg.end();
for (const r of gone) {
  if (/^\/uploads\//.test(r.file_url))
    fs.rmSync(path.join(process.cwd(), "public", r.file_url.replace(/^\//, "")), { force: true });
 // Leave what went to storage — other comments may reference the same bytes
 // (content-addressed, so shared); orphan cleanup is a separate concern
}
fs.rmSync(tmp, { recursive: true, force: true });

if (d.length) {
  console.error("\n  ┌─ The comment clip differs from the original ─────────────────");
  for (const l of d) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ Reference: src/i18n/content/e2e-fixtures/notion-row-comments.json (clip)");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(
  `Clip matches the original — multi-select, no restriction; ${OTHERS.map((o) => o[0]).join(" · ")} and a tall png attach:` +
    ` image in the 240 box, files as two lines of name+size (cleaned up ${gone.length} files)`
);
