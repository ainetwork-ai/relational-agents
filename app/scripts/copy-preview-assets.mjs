// Self-host the runtime assets the file-preview renderers (src/components/previews)
// load by URL — pdf.js worker/CMaps/fonts/wasm, the libarchive.js worker + wasm,
// dxf-viewer's text font. Bundlers can't inline workers/wasm for these
// libraries, and a CDN would break under any `worker-src 'self'` CSP.
//
// Runs from the `dev` / `build` scripts (pnpm doesn't run pre* hooks). The
// Dockerfile calls `next build` directly, so it must run this first too.
// Output under public/preview-assets is a gitignored build artifact,
// re-copied when a source package version changes. Ported from aindrive.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nm = (p) => resolve(appRoot, "node_modules", p);
const outRoot = resolve(appRoot, "public/preview-assets");

// [package, [source-in-package, dest-under-outRoot]...]
const ASSETS = [
  ["pdfjs-dist", [
    ["build/pdf.worker.min.mjs", "pdfjs/pdf.worker.min.mjs"],
    ["cmaps", "pdfjs/cmaps"],            // CJK text in PDFs needs these
    ["standard_fonts", "pdfjs/standard_fonts"],
    ["wasm", "pdfjs/wasm"],              // JPX/JBIG2 image decoders
  ]],
  ["libarchive.js", [
    ["dist/worker-bundle.js", "libarchive/worker-bundle.js"],
    ["dist/libarchive.wasm", "libarchive/libarchive.wasm"],
  ]],
  // dxf-viewer draws TEXT/MTEXT only with a TTF it can fetch. Liberation Sans
  // (Latin/Greek/Cyrillic; GPLv2 + font exception, redistributable — pdf.js
  // already ships it, see standard_fonts/LICENSE_LIBERATION).
  ["pdfjs-dist", [
    ["standard_fonts/LiberationSans-Regular.ttf", "dxf/fonts/LiberationSans-Regular.ttf"],
    ["standard_fonts/LICENSE_LIBERATION", "dxf/fonts/LICENSE_LIBERATION"],
  ]],
];

const versionOf = (pkg) => JSON.parse(readFileSync(nm(`${pkg}/package.json`), "utf8")).version;
const stamp = ASSETS.map(([pkg]) => `${pkg}@${versionOf(pkg)}`).join(" ");
const stampFile = resolve(outRoot, ".version");
if (existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) {
  console.log(`[copy-preview-assets] up to date (${stamp})`);
  process.exit(0);
}

rmSync(outRoot, { recursive: true, force: true });
for (const [pkg, files] of ASSETS) {
  for (const [from, to] of files) {
    const src = nm(`${pkg}/${from}`);
    if (!existsSync(src)) {
      console.error(`[copy-preview-assets] missing ${src} — run \`pnpm install\` first.`);
      process.exit(1);
    }
    const dest = resolve(outRoot, to);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
}
writeFileSync(stampFile, stamp);
console.log(`[copy-preview-assets] copied ${stamp} → public/preview-assets`);
