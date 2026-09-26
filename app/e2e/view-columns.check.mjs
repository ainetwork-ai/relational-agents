// The table's columns — which ones, in what order, how wide.
//
// A dropped drag in dev is enough to lose this: Assignee sat at 327 instead of
// 469 and the title column had swapped ahead of TL, which quietly changes how
// everything else reads (a menu that is the original's exact 240px looks bulky
// next to a column that is 142px too narrow). The numbers here are Notion's
// own `format.table_properties`, not screen readings.
//
//   [BASE_URL=http://localhost:3110] [DB_ID=…] [USER_ID=…] node e2e/view-columns.check.mjs
//
// Read-only: one GET.

import fs from "node:fs";
import { sealData } from "iron-session";

const BASE = process.env.BASE_URL ?? "http://localhost:3110";
const DB_ID = process.env.DB_ID ?? "cc027bcc-f38e-4521-9e63-731371148eab"; // Projects
const USER_ID = process.env.USER_ID ?? "0be606ed-3a1a-4a9b-bc76-630628555f61";

const G = JSON.parse(
  fs.readFileSync(new URL("../src/i18n/content/e2e-fixtures/notion-view-columns.json", import.meta.url), "utf8"),
);
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret =
  env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim() || "dev-secret-change-in-production-32ch";
const cookie = await sealData({ userId: USER_ID }, { password: secret, ttl: 0 });

const res = await fetch(`${BASE}/api/databases/${DB_ID}`, { headers: { cookie: `rm-session=${cookie}` } });
if (!res.ok) {
  console.error(`GET /api/databases/${DB_ID}: ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const props = data.properties ?? data.database?.properties ?? [];
const views = data.views ?? data.database?.views ?? [];
const view = views.find((v) => v.name === G.view);
if (!view) {
  console.error(`no view "${G.view}" (present: ${views.map((v) => v.name).join(", ")})`);
  process.exit(1);
}
const name = Object.fromEntries(props.map((p) => [p.id, p.name]));
const hidden = view.config?.hiddenProperties ?? [];
const widths = view.config?.widths ?? {};
const ours = (view.config?.propertyOrder ?? [])
  .filter((id) => !hidden.includes(id) && name[id])
  .map((id) => ({ name: name[id], width: widths[id] }));

const diffs = [];
G.columns.forEach((want, i) => {
  const got = ours[i];
  if (!got) return diffs.push(`#${i} ${want.name}: ours (missing) / Notion ${want.width}px`);
  if (got.name !== want.name) diffs.push(`#${i} order: ours ${got.name} / Notion ${want.name}`);
  else if (Math.round(Number(got.width)) !== want.width)
    diffs.push(`${want.name} width: ours ${got.width} / Notion ${want.width}`);
});
if (ours.length > G.columns.length)
  diffs.push(`more visible columns than the original: ${ours.slice(G.columns.length).map((c) => c.name).join(", ")}`);

if (diffs.length) {
  console.error("\n  ┌─ The table columns differ from the original ─────────────");
  for (const d of diffs) console.error(`  │ ${d}`);
  console.error("  │");
  console.error("  │ reference: src/i18n/content/e2e-fixtures/notion-view-columns.json");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
}
console.log(`all ${ours.length} columns match the original in order and width (${G.view})`);

