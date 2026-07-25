// Push the agent's current alerts into the clone's inbox as REMINDER
// notifications (generic type — same inbox as mentions/comments/invites).
// Each reminder deep-links to that girlfriend's record page. Server-side
// dedupe keeps re-runs from spamming: identical unread reminders are skipped.
//
//   node scripts/push-alert-reminders.mjs

const BASE = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const DASH = (process.env.DASH_URL || "http://localhost:3110").replace(/\/$/, "");

let cookie = null;
async function login() {
  const r = await fetch(`${BASE}/api/auth/demo-login`, { method: "POST" });
  cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!r.ok) throw new Error(`login: ${r.status}`);
}

const dash = await (await fetch(`${DASH}/api/dashboard?lang=en`)).json();
if (dash.source !== "memory-pages") throw new Error(`dashboard source is ${dash.source}`);
await login();

for (const a of dash.alerts) {
  const r = await fetch(`${BASE}/api/notifications`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: "reminder", body: `${a.name} — ${a.text}`, pageId: a.rowId }),
  });
  const data = await r.json();
  console.log(`${data.deduped ? "↷ dup " : "✓ sent"} [${a.kind}] ${a.name}: ${a.text.slice(0, 60)}`);
}
console.log("done");
