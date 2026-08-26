// Which Korean source keys does the UI use, and which are missing from en.ts?
//
//   node scripts/i18n-keys.mjs           # summary + missing keys
//   node scripts/i18n-keys.mjs --json    # { keys, missing }
//
// Keys are whatever is passed as the first argument to t("…") / getT()("…")
// with a string literal (docs/i18n-plan.md §3 D3). Dynamic keys (t(x.label))
// are not seen here — cover their sources by listing the constant's values.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../src");
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|mts)$/.test(e.name) && !p.includes("/i18n/")) files.push(p);
  }
})(root);

const keys = new Map(); // key → first file
const re = /\bt\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) {
    const k = m[2].replace(/\\(["'`])/g, "$1");
    if (!keys.has(k)) keys.set(k, path.relative(root, f));
  }
}

const enSrc = fs.readFileSync(path.join(root, "i18n/en.ts"), "utf8");
const enKeys = new Set();
for (const m of enSrc.matchAll(/^\s*(?:"((?:\\.|[^"\\])*)"|([\p{L}\p{N}_ ()]+))\s*:/gmu)) enKeys.add((m[1] ?? m[2]).replace(/\\"/g, '"').trim());

const missing = [...keys.keys()].filter((k) => !enKeys.has(k)).sort();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ keys: [...keys.keys()].sort(), missing }, null, 2));
} else {
  console.log(`keys in use: ${keys.size} · in en.ts: ${enKeys.size} · missing from en.ts: ${missing.length}`);
  for (const k of missing) console.log(`  ${k}   ← ${keys.get(k)}`);
}
process.exit(missing.length ? 1 : 0);
