// Thin client for the workspace app — the watcher and seed are ordinary API
// consumers; journaling needs zero app changes.
export const APP_URL = process.env.APP_URL ?? "http://localhost:36625";

let cookie = null;
export async function login() {
  const r = await fetch(`${APP_URL}/api/auth/demo-login`, { method: "POST" });
  if (!r.ok) throw new Error(`app login failed: ${r.status}`);
  cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

export async function api(method, path, body) {
  if (!cookie) await login();
  const r = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}

/** Find a database by title, with its property map (name → property). */
export async function databaseByTitle(title) {
  const { databases } = await api("GET", "/api/databases");
  const hit = databases.find((d) => d.title === title);
  if (!hit) return null;
  const snap = await api("GET", `/api/databases/${hit.id}`);
  const props = Object.fromEntries(snap.properties.map((p) => [p.name, p]));
  return { ...snap, id: snap.database?.id ?? hit.id, props };
}
