// Materialize "Relationship Records" as a REAL database in the workspace app:
// one row per girlfriend, typed properties, and Board / Calendar / Dashboard
// views over the same collection. Rows deep-link to the existing record pages.
// Source of truth for values = the dashboard API (already parses the docs).
//
//   MEMORY_BASE_URL=http://localhost:36625 DASH_URL=http://localhost:3110 \
//     node scripts/create-records-db.mjs

const BASE = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const DASH = (process.env.DASH_URL || "http://localhost:3110").replace(/\/$/, "");
const INDEX_TITLE = "Relationship Records";

let cookie = null;
async function login() {
  const r = await fetch(`${BASE}/api/auth/demo-login`, { method: "POST" });
  cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!r.ok) throw new Error(`login: ${r.status}`);
}
async function api(method, path, body) {
  if (!cookie) await login();
  const r = await fetch(BASE + path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}

const LEVELS = [
  { name: "Lv.0 Total Stranger", color: "gray" },
  { name: "Lv.1 Acquaintance", color: "blue" },
  { name: "Lv.2 Crush & Flirting", color: "green" },
  { name: "Lv.3 Talking Stage", color: "yellow" },
  { name: "Lv.4 Situationship", color: "orange" },
  { name: "Lv.5 Official Couple", color: "purple" },
  { name: "Lv.6 Deep Integration", color: "pink" },
  { name: "Lv.7 Almost Married", color: "red" },
];
const levelOptions = LEVELS.map((l, i) => ({ id: `lv${i}`, ...l }));

// ---- source rows from the dashboard API -------------------------------------

const dash = await (await fetch(`${DASH}/api/dashboard?lang=en`)).json();
if (dash.source !== "memory-pages") throw new Error(`dashboard source is ${dash.source} — clone unreachable?`);
const rels = dash.relationships;
console.log(`source: ${rels.length} relationships`);

// ---- create the database ------------------------------------------------------

const snap = await api("POST", "/api/databases", { title: INDEX_TITLE });
const dbId = snap.database.id;
console.log(`database created: ${dbId}`);

// clear the "Tasks" starter seed (rows + non-title properties)
for (const r of snap.rows) await api("DELETE", `/api/databases/${dbId}/rows/${r.id}`);
for (const p of snap.properties) {
  if (p.type !== "title") await api("DELETE", `/api/databases/${dbId}/properties/${p.id}`);
}
const titleProp = snap.properties.find((p) => p.type === "title");

const mk = async (name, type, config) =>
  (await api("POST", `/api/databases/${dbId}/properties`, { name, type, config })).property;

const pLevel = await mk("Level", "select", { options: levelOptions });
const pSince = await mk("Since", "date");
const pBirthday = await mk("Birthday", "date");
const pContact = await mk("Last contact", "date");
const pDate = await mk("Last date", "date");
const pPhone = await mk("Phone", "phone");
const pJob = await mk("Job", "text");
const pEvent = await mk("Upcoming event", "text");
const pEventDate = await mk("Event date", "date");
const pRecord = await mk("Record", "url");
console.log("properties created");

// ---- rows ----------------------------------------------------------------------

// level gauge hearts — cold → warm (matches the doc's "Relationship levels")
const HEART = ["🩶", "🤍", "💛", "🧡", "🩷", "❤️", "❤️‍🔥", "💝"];

for (const r of rels) {
  const job = (r.notes ?? "").split(" · ")[1] ?? "";
  const lv = Math.min(Math.max(r.level, 0), 7);
  await api("POST", `/api/databases/${dbId}/rows`, {
    values: {
      [titleProp.id]: `${HEART[lv]} ${r.name}`,
      [pLevel.id]: `lv${Math.min(Math.max(r.level, 0), 7)}`,
      ...(r.met ? { [pSince.id]: r.met } : {}),
      ...(r.birthday ? { [pBirthday.id]: r.birthday } : {}),
      ...(r.lastContact ? { [pContact.id]: r.lastContact } : {}),
      ...(r.lastDate ? { [pDate.id]: r.lastDate } : {}),
      ...(r.phone ? { [pPhone.id]: r.phone } : {}),
      ...(job ? { [pJob.id]: job } : {}),
      ...(r.event ? { [pEvent.id]: r.event } : {}),
      ...(r.eventDate ? { [pEventDate.id]: r.eventDate } : {}),
      [pRecord.id]: `/p/${r.rowId}`,
    },
  });
  console.log(`  ✓ row ${r.name} (Lv${r.level})`);
}

// ---- views ----------------------------------------------------------------------

await api("POST", `/api/databases/${dbId}/views`, {
  type: "board",
  name: "By level",
  config: { groupByPropertyId: pLevel.id },
});
await api("POST", `/api/databases/${dbId}/views`, {
  type: "calendar",
  name: "Birthdays",
  config: { calendarDatePropertyId: pBirthday.id },
});
await api("POST", `/api/databases/${dbId}/views`, { type: "dashboard", name: "Dashboard" });
console.log("views: table / board(by level) / calendar(birthdays) / dashboard");

// ---- embed into the Relationship Records index page ------------------------------

const { pages } = await api("GET", "/api/pages");
const index = pages.find((p) => p.title === INDEX_TITLE && !p.isArchived && !p.parentPageId);
if (index) {
  await api("POST", `/api/pages/${index.id}/blocks`, {
    type: "database",
    content: { databaseId: dbId },
  });
  console.log(`embedded into page "${index.title}" (${index.id})`);
} else {
  console.log("index page not found — database left standalone");
}
console.log(`done → database ${dbId}`);
