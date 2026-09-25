// Generate portraits for the gf-record personas (fetched live from the workspace
// clone), then background-removed cutouts using each portrait as the reference
// image (consistency rule: never regenerate a face from text alone).
//
//   MEMORY_BASE_URL=http://localhost:36625 node scripts/gen-gf-avatars.mjs [names...]
//
// Portraits: gpt-image-2 (generations). Cutouts: gpt-image-1 (edits — the only
// deployment that supports transparent background). Skips files that exist.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGfRelationships } from "../lib/memory-pages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AVA_DIR = path.join(HERE, "..", "public", "avatars");
const BASE_URL = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");

const env = {};
for (const line of fs.readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const ENDPOINT = env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
const KEY = env.AZURE_OPENAI_KEY;
const GEN_DEPLOY = env.AZURE_IMAGE2_DEPLOYMENT || env.AZURE_IMAGE_DEPLOYMENT;
const EDIT_DEPLOY = env.AZURE_IMAGE_DEPLOYMENT || env.AZURE_IMAGE2_DEPLOYMENT;

const CUTOUT_PROMPT =
  "Isolate the person from the photo and remove the background completely. " +
  "Keep the exact same face, hair, pose and clothing. Output the person cut out " +
  "on a fully transparent background, edges cleanly masked.";

function personaPrompt(r) {
  // the doc's `appearance:` field IS the prompt core — hand-authored per person
  // so ten portraits can't converge on the same face/style/scene
  if (r.appearance) {
    return (
      `Photorealistic candid portrait photo, head and shoulders, of a fictional ${r.appearance}. ` +
      `${r.notes ?? ""}. Looking at the camera, shallow depth of field, realistic skin texture, ` +
      "unique face, not a celebrity."
    );
  }
  const likes = (r.likes ?? []).slice(0, 2).join(", ");
  return (
    `Photorealistic candid portrait photo, head and shoulders, of a fictional young woman named ${r.name} ` +
    `(appearance should fit the name), ${r.notes ?? ""}. Her hobbies: ${likes}. ` +
    "Looking at the camera with a natural friendly expression, soft daylight, shallow depth of field, " +
    "clean simple background, realistic skin texture. Unique face, not a celebrity."
  );
}

async function azure(pathAndQuery, init) {
  const res = await fetch(`${ENDPOINT}${pathAndQuery}`, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("no b64_json in response");
  return Buffer.from(b64, "base64");
}

async function generate(r) {
  // files are keyed by the stable Korean name, not the localized display name
  const key = (r.avatarKey ?? r.name).toLowerCase();
  const file = path.join(AVA_DIR, `${key}.png`);
  if (!fs.existsSync(file)) {
    const buf = await azure(`/openai/deployments/${GEN_DEPLOY}/images/generations?api-version=2025-04-01-preview`, {
      method: "POST",
      headers: { "api-key": KEY, "content-type": "application/json" },
      body: JSON.stringify({ prompt: personaPrompt(r), n: 1, size: "1024x1024", quality: "high", output_format: "png" }),
    });
    fs.writeFileSync(file, buf);
    console.log(`✓ portrait ${r.name}`);
  }
  const cut = path.join(AVA_DIR, `${key}-cutout.png`);
  if (!fs.existsSync(cut)) {
    const boundary = "----gf" + r.rowId.slice(0, 8);
    const parts = [];
    for (const [k, v] of Object.entries({
      prompt: CUTOUT_PROMPT,
      size: "1024x1024",
      background: "transparent",
      output_format: "png",
      quality: "high",
    })) {
      parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    parts.push(
      Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="image"; filename="a.png"\r\ncontent-type: image/png\r\n\r\n`),
      fs.readFileSync(file),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    );
    const buf = await azure(`/openai/deployments/${EDIT_DEPLOY}/images/edits?api-version=2025-04-01-preview`, {
      method: "POST",
      headers: { "api-key": KEY, "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(parts),
    });
    fs.writeFileSync(cut, buf);
    console.log(`✓ cutout   ${r.name}`);
  }
}

const got = await fetchGfRelationships(BASE_URL, process.env.GF_INDEX || null, new Date());
if (!got) {
  console.error("gf-records-index not found");
  process.exit(1);
}
const filter = process.argv.slice(2);
const targets = got.relationships.filter(
  (r) => !filter.length || filter.includes(r.name) || filter.includes(r.avatarKey ?? "")
);
console.log(`generating for: ${targets.map((r) => r.name).join(", ")}`);

// small concurrency pool — 20 image calls sequentially would take forever
const queue = [...targets];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        await generate(r);
      } catch (err) {
        console.error(`✗ ${r.name}: ${err.message}`);
      }
    }
  })
);
console.log("done");
