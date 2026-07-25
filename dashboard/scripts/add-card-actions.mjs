// Add per-card action buttons to Relationship Records: "Call" (FaceTime
// deep-link, port-relative) and "Message" (placeholder → the record document
// until the messenger ships). Gallery cards render visible url properties as
// footer buttons, so this is pure data + view config.
//
//   node scripts/add-card-actions.mjs

const BASE = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const DASH = (process.env.DASH_URL || "http://localhost:3110").replace(/\/$/, "");
const FACETIME = (process.env.FACETIME_URL ?? ":3111").replace(/\/$/, "");

let cookie = null;
async function login() {
  const r = await fetch(`${BASE}/api/auth/demo-login`, { method: "POST" });
  cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!r.ok) throw new Error(`login: ${r.status}`);
}
async function api(m, p, body) {
  if (!cookie) await login();
  const r = await fetch(BASE + p, {
    method: m,
    headers: { cookie, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${(await r.text()).slice(0, 150)}`);
  return r.json().catch(() => ({}));
}

const dash = await (await fetch(`${DASH}/api/dashboard?lang=en`)).json();
const { databases } = await api("GET", "/api/databases");
const dbId = databases.find((d) => d.title === "Relationship Records")?.id;
let snap = await api("GET", `/api/databases/${dbId}`);
const titleProp = snap.properties.find((p) => p.type === "title");

for (const name of ["Call", "Message"]) {
  if (!snap.properties.some((p) => p.name === name)) {
    await api("POST", `/api/databases/${dbId}/properties`, { name, type: "url" });
    console.log(`property added: ${name}`);
  }
}
snap = await api("GET", `/api/databases/${dbId}`);
const prop = (n) => snap.properties.find((p) => p.name === n);

for (const rel of dash.relationships) {
  const row = snap.rows.find(
    (r) => String(r.values[titleProp.id] ?? "").replace(/^[^A-Za-z]+/, "") === rel.name
  );
  if (!row) continue;
  const first = rel.name.split(" ")[0].toLowerCase();
  await api("PATCH", `/api/databases/${dbId}/rows/${row.id}`, {
    values: {
      [prop("Call").id]: `${FACETIME}/?call=${encodeURIComponent(first)}`,
      // messenger is still in development — route to the record doc for now
      [prop("Message").id]: `/p/${rel.rowId}`,
    },
  });
  console.log(`  ✓ ${rel.name}`);
}

// Cards view: keep Call/Message VISIBLE (they render as buttons), everything
// else except Level/Since hidden
const cards = snap.views.find((v) => v.type === "gallery");
if (cards) {
  const show = new Set([titleProp.id, prop("Level")?.id, prop("Since")?.id, prop("Call")?.id, prop("Message")?.id].filter(Boolean));
  await api("PATCH", `/api/databases/${dbId}/views/${cards.id}`, {
    config: { ...cards.config, hiddenProperties: snap.properties.filter((p) => !show.has(p.id)).map((p) => p.id) },
  });
  console.log("Cards view updated");
}
console.log("done");
