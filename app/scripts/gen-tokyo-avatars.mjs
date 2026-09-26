// Generate the "Tokyo Trip" demo avatars: six fictional humans (five friends, one of
// whom has a second account) plus an emblem for the room's AI treasurer.
// Output: public/demo/tokyo/<name>.jpg, square 512px JPEG, quality ~85, < 120 KB.
//
//   node scripts/gen-tokyo-avatars.mjs [names...]        (default: all seven)
//   node scripts/gen-tokyo-avatars.mjs --resize-only [names...]
//
// Zero npm deps. Images come from Azure OpenAI (images/generations; alex2 uses
// images/edits with alex's photo as the reference so it is the same face). The final
// downscale shells out to python3 + Pillow.
//
// Credentials are read from <repo>/dashboard/.env (override with AZURE_ENV_FILE):
// AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_IMAGE2_DEPLOYMENT or AZURE_IMAGE_DEPLOYMENT.
// The 1024px PNG masters go to TOKYO_AVATARS_RAW_DIR (default <os tmpdir>/tokyo-avatars-raw),
// never into public/.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "public", "avatars", "tokyo");
const RAW_DIR = process.env.TOKYO_AVATARS_RAW_DIR || path.join(os.tmpdir(), "tokyo-avatars-raw");
const ENV_FILE = process.env.AZURE_ENV_FILE || path.join(HERE, "..", "..", "dashboard", ".env");
const API_VERSION = "2025-04-01-preview";
const MAX_KB = 120;

// ---- prompts ---------------------------------------------------------------------------

// One shared photographic style so the five friends read as one group.
const PHOTO_STYLE =
  "Photorealistic candid head-and-shoulders portrait photo of a fictional person, " +
  "centered in the frame with some space around the head so it crops cleanly into a circle, " +
  "looking at the camera with a natural, friendly, relaxed expression. " +
  "Soft natural daylight from a window, gentle shadows, plain warm off-white wall behind, slightly out of focus. " +
  "Shot on a mirrorless camera with an 85mm lens, shallow depth of field, realistic skin texture, true-to-life colors. " +
  "A software developer on a hackathon trip to Tokyo with friends. " +
  "Exactly one person, natural hands out of frame, no text, no logos, no watermark. ";

const ALEX =
  "He is a man in his late 20s with short dark-brown hair, neatly cut and slightly tousled on top, " +
  "light stubble, warm brown eyes, an oval face with a defined jaw, fair skin with a light tan. " +
  "He wears a plain navy-blue hoodie with no print.";

const CHARACTERS = {
  alex: { kind: "photo", prompt: PHOTO_STYLE + ALEX },
  bea: {
    kind: "photo",
    prompt:
      PHOTO_STYLE +
      "She is a woman in her mid 20s with shoulder-length curly auburn hair, light freckles, green eyes, " +
      "and round thin-framed tortoiseshell glasses. She wears a mustard-yellow knit cardigan over a white t-shirt. Warm smile.",
  },
  chris: {
    kind: "photo",
    prompt:
      PHOTO_STYLE +
      "He is an East Asian man in his early 30s with neat short black hair, clean-shaven, " +
      "wearing a plain heather-grey crewneck sweatshirt. A friendly, open grin.",
  },
  dana: {
    kind: "photo",
    prompt:
      PHOTO_STYLE +
      "She is a Black woman in her late 20s with long box braids tied up in a high bun, small gold stud earrings, " +
      "wearing an olive-green utility jacket over a black top. Confident, warm smile.",
  },
  eli: {
    kind: "photo",
    prompt:
      PHOTO_STYLE +
      "He is a South Asian man in his mid 20s with wavy black hair of medium length, a trimmed short beard, " +
      "wearing a light-blue denim button-up shirt. Easygoing smile.",
  },
  // Same human as alex, "in disguise" for his second account — edited from alex's photo.
  alex2: {
    kind: "edit",
    ref: "alex",
    prompt:
      "The same man as in the reference photo: keep his face, facial features, eyes, skin tone, stubble and jawline " +
      "exactly the same so he is clearly recognisable as the same person. Now he is 'in disguise': he wears a plain black " +
      "baseball cap with no logo, dark sunglasses, and a burgundy zip-up windbreaker jacket instead of the navy hoodie. " +
      "Same photographic style, soft daylight, plain warm off-white wall background, same head-and-shoulders framing, " +
      "centered. A slight playful smirk. Exactly one person, no text, no logos.",
    // used only if images/edits is unavailable
    fallback:
      PHOTO_STYLE +
      ALEX.replace("He wears a plain navy-blue hoodie with no print.", "") +
      " He is 'in disguise': a plain black baseball cap with no logo, dark sunglasses, and a burgundy zip-up windbreaker jacket. " +
      "A slight playful smirk.",
  },
  agent: {
    kind: "emblem",
    prompt:
      "A clean, minimal flat vector emblem used as the avatar of an AI treasurer: a rounded vault safe seen from the front, " +
      "with a round combination dial and a short handle on its door, and one subtle small four-pointed sparkle just above " +
      "its top-right corner. Emerald green shapes (two or three shades of emerald, no gradients) on a plain very light " +
      "mint-white background. The safe is centered and fills about 60% of the frame so it still reads at 24 pixels inside a " +
      "circle. Simple geometric shapes, soft rounded corners. Not a character: no face, no eyes, no mouth. " +
      "No text, no letters, no numbers, no border, no shadow, no 3D.",
  },
};

// ---- env -------------------------------------------------------------------------------

const args = process.argv.slice(2);
const resizeOnly = args.includes("--resize-only");
const names = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());
// Keep CHARACTERS order so a reference (alex) is always queued before its edit (alex2).
const targets = names.length ? Object.keys(CHARACTERS).filter((n) => names.includes(n)) : Object.keys(CHARACTERS);
for (const n of names) {
  if (!CHARACTERS[n]) {
    console.error(`unknown name: ${n} (known: ${Object.keys(CHARACTERS).join(", ")})`);
    process.exit(1);
  }
}

function readEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

let ENDPOINT, KEY, DEPLOYMENT;
if (!resizeOnly) {
  const env = readEnv(ENV_FILE);
  ENDPOINT = env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
  KEY = env.AZURE_OPENAI_KEY;
  DEPLOYMENT = process.env.AZURE_IMAGE_DEPLOYMENT || env.AZURE_IMAGE2_DEPLOYMENT || env.AZURE_IMAGE_DEPLOYMENT;
  if (!ENDPOINT || !KEY || !DEPLOYMENT) {
    console.error(`missing AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY / AZURE_IMAGE(2)_DEPLOYMENT in ${ENV_FILE}`);
    process.exit(1);
  }
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

// ---- Azure calls -----------------------------------------------------------------------

const rawPath = (name) => path.join(RAW_DIR, `${name}.png`);
const outPath = (name) => path.join(OUT_DIR, `${name}.jpg`);

async function call(url, init, label) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) {
      const b64 = (await res.json()).data?.[0]?.b64_json;
      if (!b64) throw new Error(`${label}: no b64_json in response`);
      return Buffer.from(b64, "base64");
    }
    const text = (await res.text()).slice(0, 300);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = Number(res.headers.get("retry-after")) || 15 * attempt;
      console.warn(`… ${label}: HTTP ${res.status}, retrying in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const err = new Error(`${label}: HTTP ${res.status} — ${text}`);
    err.status = res.status;
    throw err;
  }
}

function generate(name, prompt) {
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/generations?api-version=${API_VERSION}`;
  return call(
    url,
    {
      method: "POST",
      headers: { "api-key": KEY, "content-type": "application/json" },
      body: JSON.stringify({ prompt, n: 1, size: "1024x1024", quality: "high", output_format: "png" }),
    },
    name
  );
}

function multipart(fields, fileField, filePath) {
  const boundary = "----tokyo" + Math.random().toString(36).slice(2);
  const mime = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="${fileField}"; filename="${path.basename(filePath)}"\r\n` +
        `content-type: ${mime}\r\n\r\n`
    ),
    fs.readFileSync(filePath),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

function edit(name, prompt, refFile) {
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/edits?api-version=${API_VERSION}`;
  const { body, type } = multipart(
    { prompt, n: 1, size: "1024x1024", quality: "high", output_format: "png" },
    "image",
    refFile
  );
  return call(url, { method: "POST", headers: { "api-key": KEY, "content-type": type }, body }, `${name} (edit)`);
}

// ---- downscale (python3 + Pillow) ------------------------------------------------------

const RESIZE_PY = `
import os, sys
from PIL import Image
src, dst, max_bytes = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src)
if im.mode in ("RGBA", "LA", "P"):
    im = im.convert("RGBA")
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.split()[-1])
    im = bg
else:
    im = im.convert("RGB")
w, h = im.size
s = min(w, h)
im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((512, 512), Image.LANCZOS)
q = 85
while True:
    im.save(dst, "JPEG", quality=q, optimize=True, progressive=True)
    if os.path.getsize(dst) <= max_bytes or q <= 60:
        break
    q -= 5
print(q)
`;

function toJpeg(name) {
  const src = rawPath(name);
  if (!fs.existsSync(src)) throw new Error(`${name}: no master at ${src} — generate it first`);
  const r = spawnSync("python3", ["-c", RESIZE_PY, src, outPath(name), String(MAX_KB * 1024)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${name}: python3/Pillow resize failed — ${r.stderr || r.error}`);
  const kb = Math.round(fs.statSync(outPath(name)).size / 1024);
  console.log(`✓ ${path.relative(process.cwd(), outPath(name))}  512x512  q${r.stdout.trim()}  ${kb} KB`);
}

// ---- run -------------------------------------------------------------------------------

async function make(name) {
  const c = CHARACTERS[name];
  let png;
  if (c.kind === "edit") {
    const ref = [rawPath(c.ref), outPath(c.ref)].find((f) => fs.existsSync(f));
    if (!ref) throw new Error(`${name}: needs ${c.ref} first (no ${rawPath(c.ref)} or ${outPath(c.ref)})`);
    try {
      png = await edit(name, c.prompt, ref);
    } catch (e) {
      if (!(e.status >= 400 && e.status < 500) || e.status === 429) throw e;
      console.warn(`… ${name}: images/edits unavailable (${e.message}); generating from the shared description`);
      png = await generate(name, c.fallback);
    }
  } else {
    png = await generate(name, c.prompt);
  }
  fs.writeFileSync(rawPath(name), png);
  toJpeg(name);
}

if (resizeOnly) {
  for (const n of targets) toJpeg(n);
} else {
  // Independent images in parallel; an edit waits for its reference when both are requested.
  const jobs = {};
  for (const n of targets) {
    const ref = CHARACTERS[n].ref;
    const before = ref && jobs[ref] ? jobs[ref] : Promise.resolve();
    jobs[n] = before.then(() => make(n));
  }
  const results = await Promise.allSettled(Object.values(jobs));
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) console.error(`✗ ${f.reason?.message || f.reason}`);
  if (failed.length) process.exit(1);
}
