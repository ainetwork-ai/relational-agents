// i18n for the e2e checks.
//
// The dev server renders the ko locale, and the Notion golden set was captured
// from Korean Notion, so the checks expect Korean UI text. The code here only
// names the English source key; the Korean comes from the dictionary:
//
//   import { ko, content, fixture } from "./i18n.mjs";
//   await page.getByText(ko("Edit property")).click();
//   const { TABLE_GRIP: C } = content;          // Korean demo data / IME inputs
//   const G = fixture("notion-table-grip.json"); // measured Notion values
//
// The dictionary is src/i18n/ko.ts merged with src/i18n/ko-parts/*.ts (parts
// that have not been folded into ko.ts yet). Plain `node` (22.18+) loads the
// .ts files directly by stripping types; no build step or generated JSON.
//
// Demo data that is Korean by nature (file names, people, typed text) lives in
// src/i18n/content/e2e.ts, and the Notion captures in
// src/i18n/content/e2e-fixtures/*.json, because no Korean is kept outside
// src/i18n.

import fs from "node:fs";

// Loading a .ts file under a package.json without "type" makes node print a
// MODULE_TYPELESS_PACKAGE_JSON warning on every run. It is harmless; hide it.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const code = typeof rest[0] === "object" ? rest[0]?.code : rest[1];
  if (code === "MODULE_TYPELESS_PACKAGE_JSON") return;
  return emitWarning.call(this, warning, ...rest);
};

const I18N = new URL("../src/i18n/", import.meta.url);

/** English key → Korean, from ko.ts plus any ko-parts not merged yet. */
export const KO = { ...(await import(new URL("ko.ts", I18N).href)).ko };
const partsDir = new URL("ko-parts/", I18N);
if (fs.existsSync(partsDir)) {
  for (const f of fs.readdirSync(partsDir).filter((f) => f.endsWith(".ts")).sort()) {
    const { part } = await import(new URL(f, partsDir).href);
    for (const [k, v] of Object.entries(part ?? {})) if (!(k in KO)) KO[k] = v;
  }
}

/** The Korean the ko locale shows for English key `key`, with `{name}` vars
 *  filled in. Throws on a missing key: a check that silently compared against
 *  the English text would pass or fail for the wrong reason. */
export function ko(key, vars) {
  const s = KO[key];
  if (s == null) throw new Error(`e2e/i18n: no Korean for key ${JSON.stringify(key)} (add it to src/i18n/ko.ts)`);
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Korean demo data and inputs for the checks (src/i18n/content/e2e.ts). */
export const content = await import(new URL("content/e2e.ts", I18N).href);

/** Absolute path of a Notion golden-set capture. */
export function fixturePath(name) {
  return new URL(`content/e2e-fixtures/${name}`, I18N).pathname;
}

/** A Notion golden-set capture, parsed. */
export function fixture(name) {
  return JSON.parse(fs.readFileSync(fixturePath(name), "utf8"));
}
