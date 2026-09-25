// Generate photorealistic (fictional) profile photos for the demo characters
// via Azure OpenAI image generation. Zero deps — reads ../.env itself.
//
//   node scripts/gen-avatars.mjs [names...]   (default: all five)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "public", "avatars");

const env = {};
for (const line of fs.readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const ENDPOINT = env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
const KEY = env.AZURE_OPENAI_KEY;
const DEPLOYMENT = process.env.AZURE_IMAGE_DEPLOYMENT || env.AZURE_IMAGE2_DEPLOYMENT || env.AZURE_IMAGE_DEPLOYMENT;
if (!ENDPOINT || !KEY || !DEPLOYMENT) {
  console.error("missing AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY / AZURE_IMAGE2_DEPLOYMENT in .env");
  process.exit(1);
}

const BASE_STYLE =
  "Photorealistic candid portrait photo, head and shoulders, of a fictional young woman, " +
  "looking at the camera with a natural friendly expression, soft daylight, shallow depth of field, " +
  "clean background, shot on a mirrorless camera with a 85mm lens, realistic skin texture. ";

const CHARACTERS = {
  emma: "She is in her late 20s with long wavy light-brown hair, warm hazel eyes, wearing a cozy beige knit sweater. Cheerful, comfortable, girlfriend-next-door vibe.",
  olivia: "She is in her late 20s with shoulder-length blonde hair, blue eyes, wearing a white blouse with minimal gold jewelry. Elegant and composed with a soft smile.",
  mia: "She is in her mid 20s with a dark brown sleek bob haircut, brown eyes, wearing a black turtleneck. Slightly mysterious, playful half-smile.",
  sophia: "She is an East Asian woman in her mid 20s with long straight black hair, wearing a light blue cardigan. Bright, friendly, energetic smile.",
  luna: "She is in her early 20s with copper-red hair in a loose ponytail, green eyes, light freckles, wearing a denim jacket. Casual, a bit shy smile.",
};

const names = process.argv.slice(2).map((s) => s.toLowerCase());
const targets = names.length ? names : Object.keys(CHARACTERS);
fs.mkdirSync(OUT_DIR, { recursive: true });

async function generate(name) {
  const prompt = BASE_STYLE + CHARACTERS[name];
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/generations?api-version=2025-04-01-preview`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ prompt, n: 1, size: "1024x1024", quality: "high", output_format: "png" }),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${name}: no b64_json in response`);
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  console.log(`✓ ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}

for (const name of targets) {
  if (!CHARACTERS[name]) {
    console.error(`unknown character: ${name}`);
    continue;
  }
  await generate(name);
}
