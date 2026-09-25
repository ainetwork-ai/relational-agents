// Rebuild the "Relationship Records" page as a dashboard made ONLY of the
// clone's own workspace elements — no external iframe, nothing 3110-specific:
//   Overview   → 4 KPI callouts in a 4-column layout
//   Alerts     → colored callouts (one per agent alert)
//   People     → the Relationship Records DATABASE opened on a gallery view
//                (photo covers = uploaded images on a url property)
//   Legend     → a toggle holding the level scale
// Values are snapshotted from the dashboard API at build time.
//
//   node scripts/build-doc-dashboard.mjs

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const BASE = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const DASH = (process.env.DASH_URL || "http://localhost:3110").replace(/\/$/, "");
const PAGE_ID = process.env.RECORDS_PAGE || "b5511267-68ed-4cc7-b2f3-700c103d928e";
const COVER_DIR =
  process.env.COVER_DIR ||
  "/mnt/newdata/comcom_data/tmp/claude-1000/-mnt-newdata-git-app/5e75d067-e0d2-469a-ba7d-7429536fee1a/scratchpad/covers";

let cookie = null;
async function login() {
  const r = await fetch(`${BASE}/api/auth/demo-login`, { method: "POST" });
  cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!r.ok) throw new Error(`login: ${r.status}`);
}
async function api(method, p, body) {
  if (!cookie) await login();
  const r = await fetch(BASE + p, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}
async function upload(file) {
  if (!cookie) await login();
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "image/jpeg" }), path.basename(file));
  const r = await fetch(`${BASE}/api/upload`, { method: "POST", headers: { cookie }, body: form });
  if (!r.ok) throw new Error(`upload ${file}: ${r.status}`);
  return (await r.json()).url;
}

// ---- source snapshot ----------------------------------------------------------

const dash = await (await fetch(`${DASH}/api/dashboard?lang=en`)).json();
if (dash.source !== "memory-pages") throw new Error(`dashboard source is ${dash.source}`);
const rels = dash.relationships;
const alerts = dash.alerts;

// ---- 1) database: Photo covers + gallery view ----------------------------------

const { databases } = await api("GET", "/api/databases");
const dbMeta = databases.find((d) => d.title === "Relationship Records");
if (!dbMeta) throw new Error("Relationship Records database not found — run create-records-db first");
const dbId = dbMeta.id;
let snap = await api("GET", `/api/databases/${dbId}`);

// gallery covers use the FIRST url/files property — Photo must precede Record
const record = snap.properties.find((p) => p.name === "Record");
if (record && !snap.properties.some((p) => p.name === "Photo")) {
  await api("DELETE", `/api/databases/${dbId}/properties/${record.id}`);
  await api("POST", `/api/databases/${dbId}/properties`, { name: "Photo", type: "url" });
  await api("POST", `/api/databases/${dbId}/properties`, { name: "Record", type: "url" });
  snap = await api("GET", `/api/databases/${dbId}`);
}
const prop = (name) => snap.properties.find((p) => p.name === name);
const titleProp = snap.properties.find((p) => p.type === "title");

for (const rel of rels) {
  const row = snap.rows.find((r) => String(r.values[titleProp.id] ?? "").replace(/^[^A-Za-z]+/, "") === rel.name);
  if (!row) continue;
  const cover = path.join(COVER_DIR, `${rel.name.toLowerCase()}.jpg`);
  const values = { [prop("Record").id]: `/p/${rel.rowId}` };
  if (fs.existsSync(cover)) values[prop("Photo").id] = await upload(cover);
  await api("PATCH", `/api/databases/${dbId}/rows/${row.id}`, { values });
  console.log(`  ✓ photo/record ${rel.name}`);
}

// gallery view "Cards": show Level + Since, hide the operational columns
if (!snap.views.some((v) => v.type === "gallery")) {
  const show = new Set([titleProp.id, prop("Level")?.id, prop("Since")?.id].filter(Boolean));
  await api("POST", `/api/databases/${dbId}/views`, {
    type: "gallery",
    name: "Cards",
    config: { hiddenProperties: snap.properties.filter((p) => !show.has(p.id)).map((p) => p.id) },
  });
  console.log("gallery view added");
}

// ---- 2) page rebuild -------------------------------------------------------------

const { blocks: existing } = await api("GET", `/api/pages/${PAGE_ID}/blocks`);
const deletedIds = existing.map((b) => b.id);

const out = [];
let pos = 1;
const add = (type, content, parentBlockId = null) => {
  const b = { id: randomUUID(), type, content, position: pos++, parentBlockId };
  out.push(b);
  return b.id;
};

const urgent = alerts.filter((a) => a.urgency === 0).length;
const bdays = rels.filter((r) => r.birthdayDday !== null && r.birthdayDday <= 7).length;
const anniv = alerts.filter((a) => a.kind === "anniversary").length;

add("heading2", { text: "Overview" });
// 2 columns × 2 callouts: wide enough that every line stays single-line, so
// all four tiles come out the same height (4 narrow columns wrapped unevenly)
const cols = add("column_list", {});
const kpis = [
  { icon: "💘", color: "pink", text: `${rels.length} relationships` },
  { icon: "🎂", color: "yellow", text: `${bdays} birthday${bdays === 1 ? "" : "s"} within 7 days` },
  { icon: "🔥", color: "red", text: `${urgent} need action today` },
  { icon: "💐", color: "purple", text: `${anniv} anniversar${anniv === 1 ? "y" : "ies"} coming up` },
];
for (const pair of [kpis.slice(0, 2), kpis.slice(2)]) {
  const col = add("column", {}, cols);
  for (const k of pair) add("callout", { text: k.text, icon: k.icon, color: k.color }, col);
}

// Alerts intentionally do NOT render in the document — they are delivered to
// the app Inbox as reminder notifications (scripts/push-alert-reminders.mjs).

add("heading2", { text: "Relationships" });
add("database", { databaseId: dbId, initialViewType: "gallery" });

// upcoming 100-day / yearly milestones (💐 rows generated by
// create-anniversaries-db.mjs), opened on their calendar
const annivDb = databases.find((d) => d.title === "Anniversaries");
if (annivDb) {
  add("heading2", { text: "Anniversaries" });
  add("database", { databaseId: annivDb.id, initialViewType: "calendar" });
}

add("divider", {});
const legend = add("toggle", { text: "Relationship levels", expanded: false });
const LEVELS = [
  "Lv.0 🩶 Total Stranger — neither knows the other exists",
  "Lv.1 🤍 Acquaintance — name and face, greetings only",
  "Lv.2 💛 Crush & Flirting — story replies, testing the waters",
  "Lv.3 🧡 Talking Stage — daily texts, first dates, no label",
  "Lv.4 🩷 Situationship — dating without commitment",
  "Lv.5 ❤️ Official Couple — exclusive, DTR done",
  "Lv.6 ❤️‍🔥 Deep Integration — friends, family, a toothbrush at her place",
  "Lv.7 💝 Almost Married — co-living, shared life",
];
for (const l of LEVELS) add("paragraph", { text: l }, legend);

await api("PUT", `/api/pages/${PAGE_ID}/blocks`, { blocks: out, deletedIds });
console.log(`page rebuilt: ${out.length} blocks (replaced ${deletedIds.length}) → ${BASE}/p/${PAGE_ID}`);
