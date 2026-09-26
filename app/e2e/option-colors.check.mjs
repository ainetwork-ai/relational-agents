// Do our select/status options carry the colours the original stores?
//
//   node e2e/option-colors.check.mjs            # 0 = same, 1 = differs
//   node e2e/option-colors.check.mjs --write    # fix our rows to match
//
// The chip can be pixel-perfect and still show the wrong colour if the option
// itself was imported wrong: the seed mapped Notion's palette onto ours while
// ours had no brown (`brown: "orange"`), so "Need Improvement" and "Hanyang Univ." came
// in orange. This compares our stored options against the original's schema
// (src/i18n/content/e2e-fixtures/notion-option-colors.json, from a read-only loadPageChunk).
import fs from "node:fs";
import pg from "pg";

const FIX = JSON.parse(fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-option-colors.json", import.meta.url)));
const WRITE = process.argv.includes("--write");
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^POSTGRES_URL=(.+)$/m)?.[1]?.trim();

/** Notion's palette → ours, 1:1 since the property editor landed: `default`
 * and `gray` are separate stored colours there (two rows in its colour menu,
 * ✓ on the one the option carries), even though their chips paint alike. */
const MAP = {
  default: "default", gray: "gray", brown: "brown", orange: "orange", yellow: "yellow",
  green: "green", blue: "blue", purple: "purple", pink: "pink", red: "red",
};

const client = new pg.Client({ connectionString: url });
await client.connect();
// the Projects database only — a dev DB has other databases with a "Status"
// property of their own, and those are nobody's parity target
const { rows: target } = await client.query(
  `select database_id from db_properties where name = 'Evaluation' and type = 'select' limit 1`
);
if (!target.length) {
  console.error("this dev DB has no Projects database (no Evaluation property) — nothing to compare");
  await client.end();
  process.exit(1);
}
const { rows } = await client.query(
  `select id, name, type, config from db_properties
    where database_id = $1 and type in ('select','status','multi_select') order by name`,
  [target[0].database_id]
);

const diffs = [];
const fixes = [];
for (const [propName, want] of Object.entries(FIX.properties)) {
  const mine = rows.filter((r) => r.name === propName && r.type === want.type);
  if (!mine.length) {
    diffs.push(`${propName}: we have no ${want.type} property by that name`);
    continue;
  }
  for (const row of mine) {
    const options = row.config?.options ?? [];
    let touched = false;
    for (const [value, notionColor] of Object.entries(want.options)) {
      const ours = options.find((o) => o.name === value);
      if (!ours) {
        diffs.push(`${propName} "${value}": missing on our side`);
        continue;
      }
      const expect = MAP[notionColor] ?? "gray";
      if (ours.color !== expect) {
        diffs.push(`${propName} "${value}": ${ours.color} ≠ ${expect} (notion: ${notionColor})`);
        ours.color = expect;
        touched = true;
      }
    }
    if (touched && WRITE) fixes.push([row.id, JSON.stringify(row.config)]);
  }
}

if (WRITE && fixes.length) {
  for (const [id, config] of fixes)
    await client.query("update db_properties set config = $2::jsonb where id = $1", [id, config]);
  console.log(`Fixed — matched the option colours of ${fixes.length} properties to the original.`);
}
await client.end();

const total = Object.values(FIX.properties).reduce((n, p) => n + Object.keys(p.options).length, 0);
console.log(`compared ${total} options across ${Object.keys(FIX.properties).length} properties`);
if (diffs.length && !WRITE) {
  console.error("\n  ┌─ Option colours differ from the original ───────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ fix: node e2e/option-colors.check.mjs --write");
  console.error("  └────────────────────────────────────────────────\n");
  process.exit(1);
}
if (!diffs.length) console.log("0 diffs — option colours match the original.");
