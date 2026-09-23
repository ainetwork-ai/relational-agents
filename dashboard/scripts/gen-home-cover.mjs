// Generate /home dashboard covers with the image2 deployment. Zero deps —
// reads ../.env itself. Output: ../../app/public/covers/.
//
//   node scripts/gen-home-cover.mjs [default|chanho...]   (no args: both)
//
// default → home-cover.png        — text-prompt abstract banner in the
//           workspacesManagement mood (warm off-white/beige, floating cards).
// chanho  → home-cover-chanho.png — public/source/ethGlobalLisbon.webp goes in
//           as the actual input image (images/edits) and is repainted as a
//           text-free azulejo-style illustration with the same mood, not a copy.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "..", "app", "public", "covers");

const env = {};
for (const line of fs.readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const ENDPOINT = env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
const KEY = env.AZURE_OPENAI_KEY;
const DEPLOYMENT = env.AZURE_IMAGE2_DEPLOYMENT;
if (!ENDPOINT || !KEY || !DEPLOYMENT) {
  console.error("missing AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY / AZURE_IMAGE2_DEPLOYMENT in .env");
  process.exit(1);
}

const DEFAULT_PROMPT =
  "Abstract minimal background illustration for a productivity app dashboard header. " +
  "Warm off-white and soft beige palette with gentle light-gray accents, a few floating " +
  "rounded-rectangle card shapes and small circles drifting across the canvas, very subtle " +
  "soft shadows, flat clean modern SaaS aesthetic, calm airy negative space, soft diffused " +
  "daylight. Strictly no text, no letters, no numbers, no logos, no UI labels, no words of " +
  "any kind. Wide banner composition.";

const CHANHO_PROMPT =
  "Repaint this poster as a decorative background banner in the same illustration style and " +
  "mood, but a different scene and composition — NOT a copy. Keep the Portuguese azulejo " +
  "ceramic-tile aesthetic: cobalt blue and white ornamental tile borders, warm yellow sunburst " +
  "sky, hand-drawn storybook coastal town vignettes, orange fruit and flower accents, flowing " +
  "patterned waves. Invent new tile patterns and new scenery. Remove ALL text, letters, numbers, " +
  "logos, buttons and labels — no words of any kind anywhere. Wide banner composition.";

function multipart(fields, fileField, filePath) {
  const boundary = "----cover" + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="${fileField}"; filename="${path.basename(filePath)}"\r\ncontent-type: image/webp\r\n\r\n`
    ),
    fs.readFileSync(filePath),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

async function callImages(op, init) {
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/${op}?api-version=2025-04-01-preview`;
  const res = await fetch(url, { method: "POST", ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 400)}`);
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64) throw new Error("no b64_json in response");
  return Buffer.from(b64, "base64");
}

async function genDefault() {
  const png = await callImages("generations", {
    headers: { "api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ prompt: DEFAULT_PROMPT, n: 1, size: "1536x1024", quality: "high", output_format: "png" }),
  });
  return { file: "home-cover.png", png };
}

async function genChanho() {
  const src = path.join(HERE, "..", "public", "source", "ethGlobalLisbon.webp");
  const { body, type } = multipart(
    { prompt: CHANHO_PROMPT, size: "1536x1024", quality: "high", output_format: "png" },
    "image",
    src
  );
  const png = await callImages("edits", { headers: { "api-key": KEY, "content-type": type }, body });
  return { file: "home-cover-chanho.png", png };
}

const GEN = { default: genDefault, chanho: genChanho };
const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(GEN);
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const t of targets) {
  if (!GEN[t]) {
    console.error(`unknown target: ${t} (expected: ${Object.keys(GEN).join(", ")})`);
    continue;
  }
  const { file, png } = await GEN[t]();
  const out = path.join(OUT_DIR, file);
  fs.writeFileSync(out, png);
  console.log(`✓ ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
}
