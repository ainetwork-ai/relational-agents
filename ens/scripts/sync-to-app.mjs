// ens/scripts/sync-to-app.mjs
// Copy ens/src into app/src/lib/ens-family (the production image builds from app/ only).
//   node scripts/sync-to-app.mjs          write the copies
//   node scripts/sync-to-app.mjs --check  exit 1 if a copy differs from ens/src
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../src");
const dst = path.resolve(here, "../../app/src/lib/ens-family");
const check = process.argv.includes("--check");
const header = (f) => `// GENERATED from ens/src/${f} by ens/scripts/sync-to-app.mjs — edit it there, then re-run the script.\n`;

let stale = 0;
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".ts")).sort()) {
  const want = header(f) + fs.readFileSync(path.join(src, f), "utf8");
  const out = path.join(dst, f);
  const have = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
  if (have === want) continue;
  stale++;
  if (check) console.log(`out of sync: app/src/lib/ens-family/${f}`);
  else fs.writeFileSync(out, want);
}
for (const f of fs.readdirSync(dst)) {
  if (!fs.existsSync(path.join(src, f))) {
    stale++;
    if (check) console.log(`not in ens/src: app/src/lib/ens-family/${f}`);
    else fs.rmSync(path.join(dst, f));
  }
}
console.log(check ? (stale ? `${stale} file(s) out of sync` : "in sync") : `synced (${stale} changed)`);
process.exit(check && stale ? 1 : 0);
