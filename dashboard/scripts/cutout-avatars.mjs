// Make background-removed (transparent PNG) versions of the avatar photos via
// Azure OpenAI images/edits, keeping the same face as avatars/<name>.png.
// Zero deps — hand-built multipart body.
//
//   node scripts/cutout-avatars.mjs [names...]   (default: every avatars/*.png)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AVA_DIR = path.join(HERE, "..", "public", "avatars");

const env = {};
for (const line of fs.readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const ENDPOINT = env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
const KEY = env.AZURE_OPENAI_KEY;
// gpt-image-2 rejects transparent background — use the gpt-image-1 deployment
const DEPLOYMENT = env.AZURE_IMAGE_DEPLOYMENT || env.AZURE_IMAGE2_DEPLOYMENT;

const PROMPT =
  "Isolate the person from the photo and remove the background completely. " +
  "Keep the exact same face, hair, pose and clothing. Output the person cut out " +
  "on a fully transparent background, edges cleanly masked.";

function multipart(fields, fileField, filePath) {
  const boundary = "----cutout" + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="${fileField}"; filename="${path.basename(filePath)}"\r\ncontent-type: image/png\r\n\r\n`
    ),
    fs.readFileSync(filePath),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

async function cutout(name) {
  const src = path.join(AVA_DIR, `${name}.png`);
  const { body, type } = multipart(
    { prompt: PROMPT, size: "1024x1024", background: "transparent", output_format: "png", quality: "high" },
    "image",
    src
  );
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/edits?api-version=2025-04-01-preview`;
  const res = await fetch(url, { method: "POST", headers: { "api-key": KEY, "content-type": type }, body });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} — ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${name}: no b64_json`);
  const out = path.join(AVA_DIR, `${name}-cutout.png`);
  fs.writeFileSync(out, Buffer.from(b64, "base64"));
  console.log(`✓ ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
}

const names = process.argv.slice(2).length
  ? process.argv.slice(2).map((s) => s.toLowerCase())
  : fs.readdirSync(AVA_DIR).filter((f) => /^[a-z]+\.png$/.test(f)).map((f) => f.replace(".png", ""));

for (const n of names) await cutout(n);
