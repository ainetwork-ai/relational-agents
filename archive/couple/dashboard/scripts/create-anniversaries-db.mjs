// Materialize UPCOMING anniversaries as real dated rows in an "Anniversaries"
// database: for every relationship at talking-stage or beyond, the next two
// 100-day milestones and the next yearly anniversary (computed from Since).
// Titles carry the bouquet: "💐 Maya Sterling · 2nd anniversary".
// Idempotent: rows are wiped and regenerated on every run (dates roll forward).
//
//   node scripts/create-anniversaries-db.mjs

const BASE = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const DASH = (process.env.DASH_URL || "http://localhost:3110").replace(/\/$/, "");
const DB_TITLE = "Anniversaries";
const DAY = 86_400_000;

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

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ord = (n) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/** Upcoming milestones for one relationship (next 2 hundred-day + next yearly). */
function milestonesFor(rel, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rel.met ?? "");
  if (!m) return [];
  const met = new Date(+m[1], m[2] - 1, +m[3]);
  const days = Math.round((today - met) / DAY);
  const out = [];
  for (let i = 1; i <= 2; i++) {
    const milestone = (Math.floor(days / 100) + i) * 100;
    out.push({ label: `${milestone} days`, date: new Date(met.getTime() + milestone * DAY) });
  }
  const next = new Date(today.getFullYear(), met.getMonth(), met.getDate());
  if (next.getTime() <= today.getTime()) next.setFullYear(next.getFullYear() + 1);
  const years = next.getFullYear() - met.getFullYear();
  if (years >= 1) out.push({ label: `${ord(years)} anniversary`, date: next });
  return out;
}

// ---- sources ---------------------------------------------------------------------

const dash = await (await fetch(`${DASH}/api/dashboard?lang=en`)).json();
if (dash.source !== "memory-pages") throw new Error(`dashboard source is ${dash.source}`);
const today = new Date();
const rels = dash.relationships.filter((r) => r.level >= 3 && r.met);

// ---- database (create once) --------------------------------------------------------

const { databases } = await api("GET", "/api/databases");
let dbId = databases.find((d) => d.title === DB_TITLE)?.id;
let snap;
if (!dbId) {
  snap = await api("POST", "/api/databases", { title: DB_TITLE });
  dbId = snap.database.id;
  for (const r of snap.rows) await api("DELETE", `/api/databases/${dbId}/rows/${r.id}`);
  for (const p of snap.properties) {
    if (p.type !== "title") await api("DELETE", `/api/databases/${dbId}/properties/${p.id}`);
  }
  await api("POST", `/api/databases/${dbId}/properties`, { name: "Date", type: "date" });
  await api("POST", `/api/databases/${dbId}/properties`, {
    name: "Milestone",
    type: "select",
    config: {
      options: [
        { id: "hundred", name: "100-day", color: "pink" },
        { id: "yearly", name: "Yearly", color: "purple" },
        { id: "birthday", name: "Birthday", color: "yellow" },
      ],
    },
  });
  await api("POST", `/api/databases/${dbId}/properties`, { name: "Record", type: "url" });
  snap = await api("GET", `/api/databases/${dbId}`);
  // calendar first so the embedded block opens on it; wipe the seeded views
  for (const v of snap.views) await api("DELETE", `/api/databases/${dbId}/views/${v.id}`).catch(() => {});
  await api("POST", `/api/databases/${dbId}/views`, {
    type: "calendar",
    name: "Calendar",
    config: { calendarDatePropertyId: snap.properties.find((p) => p.name === "Date").id },
  });
  await api("POST", `/api/databases/${dbId}/views`, { type: "table", name: "Table" });
  console.log(`database created: ${dbId}`);
}
snap = await api("GET", `/api/databases/${dbId}`);
const prop = (n) => snap.properties.find((p) => p.name === n);
const titleProp = snap.properties.find((p) => p.type === "title");

// pre-birthday DBs miss the Birthday select option — add it in place (same id)
const msProp = prop("Milestone");
const msOptions = msProp.config?.options ?? [];
if (!msOptions.some((o) => o.id === "birthday")) {
  await api("PATCH", `/api/databases/${dbId}/properties/${msProp.id}`, {
    config: { options: [...msOptions, { id: "birthday", name: "Birthday", color: "yellow" }] },
  });
}

// ---- regenerate rows ----------------------------------------------------------------

for (const r of snap.rows) await api("DELETE", `/api/databases/${dbId}/rows/${r.id}`);
let count = 0;
for (const rel of rels) {
  for (const ms of milestonesFor(rel, today)) {
    await api("POST", `/api/databases/${dbId}/rows`, {
      values: {
        [titleProp.id]: `💐 ${rel.name} · ${ms.label}`,
        [prop("Date").id]: ymd(ms.date),
        [prop("Milestone").id]: ms.label.includes("anniversary") ? "yearly" : "hundred",
        [prop("Record").id]: `/p/${rel.rowId}`,
      },
    });
    console.log(`  💐 ${rel.name} · ${ms.label} → ${ymd(ms.date)}`);
    count++;
  }
}
// birthdays: the next occurrence for EVERY relationship that has one (any level)
for (const rel of dash.relationships) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rel.birthday ?? "");
  if (!m) continue;
  const next = new Date(today.getFullYear(), m[2] - 1, +m[3]);
  if (next.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime())
    next.setFullYear(next.getFullYear() + 1);
  await api("POST", `/api/databases/${dbId}/rows`, {
    values: {
      [titleProp.id]: `🎂 ${rel.name} · birthday`,
      [prop("Date").id]: ymd(next),
      [prop("Milestone").id]: "birthday",
      [prop("Record").id]: `/p/${rel.rowId}`,
    },
  });
  console.log(`  🎂 ${rel.name} → ${ymd(next)}`);
  count++;
}
console.log(`done — ${count} anniversaries in db ${dbId}`);
