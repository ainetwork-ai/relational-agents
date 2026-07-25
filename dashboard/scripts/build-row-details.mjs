// Fill each Relationship Records ROW PAGE ("Open as page") with the detail
// view's content, built from the clone's own blocks:
//   photo + level/stat callouts (2-column) → agent suggestions (callouts) →
//   about (bullets) → date memories (photo grids with captions) → link to the
//   full record document.
// Row body pages are created lazily (same path the UI uses: values.__page).
// Date photos are uploaded once and cached in .uploads-cache.json.
//
//   node scripts/build-row-details.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const DASH = (process.env.DASH_URL || "http://localhost:3110").replace(/\/$/, "");
const PHOTO_DIR = path.join(HERE, "..", "public", "date", "web");
const CACHE_FILE = path.join(HERE, "..", ".uploads-cache.json");
// port-relative by default — the button resolves it against whatever host the
// viewer is on (localhost tunnel, LAN IP), so no address is baked in
const FACETIME = (process.env.FACETIME_URL ?? ":3111").replace(/\/$/, "");

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
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${(await r.text()).slice(0, 150)}`);
  return r.json().catch(() => ({}));
}

const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {};
async function uploadOnce(file) {
  const key = path.basename(file);
  if (cache[key]) return cache[key];
  if (!cookie) await login();
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "image/jpeg" }), key);
  const r = await fetch(`${BASE}/api/upload`, { method: "POST", headers: { cookie }, body: form });
  if (!r.ok) throw new Error(`upload ${key}: ${r.status}`);
  cache[key] = (await r.json()).url;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
  return cache[key];
}

// ---- sources -------------------------------------------------------------------

const dash = await (await fetch(`${DASH}/api/dashboard?lang=en`)).json();
if (dash.source !== "memory-pages") throw new Error(`dashboard source is ${dash.source}`);

const { databases } = await api("GET", "/api/databases");
const dbId = databases.find((d) => d.title === "Relationship Records")?.id;
if (!dbId) throw new Error("Relationship Records db not found");
const snap = await api("GET", `/api/databases/${dbId}`);
const titleProp = snap.properties.find((p) => p.type === "title");
const photoProp = snap.properties.find((p) => p.name === "Photo");

const ago = (d) => (d === 0 ? "today" : d === null || d === undefined ? "—" : `${d}d ago`);
const SUGG_ICON = { birthday: "🎂", event: "📅", contact: "💬", date: "🌹", anniversary: "💐", ok: "🌿" };

for (const rel of dash.relationships) {
  const row = snap.rows.find((r) => String(r.values[titleProp.id] ?? "").replace(/^[^A-Za-z]+/, "") === rel.name);
  if (!row) continue;

  // row body page — same lazy-create path the UI uses
  let pageId = row.values["__page"];
  if (typeof pageId !== "string") {
    pageId = (await api("POST", "/api/pages", { title: rel.name })).page.id;
    await api("PATCH", `/api/databases/${dbId}/rows/${row.id}`, { values: { __page: pageId } });
  }

  const { blocks: existing } = await api("GET", `/api/pages/${pageId}/blocks`);
  const out = [];
  let pos = 1;
  const add = (type, content, parentBlockId = null) => {
    const b = { id: randomUUID(), type, content, position: pos++, parentBlockId };
    out.push(b);
    return b.id;
  };

  // --- hero: photo | level + stat pills -----------------------------------------
  const cols = add("column_list", {});
  const left = add("column", {}, cols);
  const photoUrl = photoProp ? row.values[photoProp.id] : null;
  if (typeof photoUrl === "string" && photoUrl) add("image", { url: photoUrl, width: 280 }, left);
  const right = add("column", {}, cols);
  add("callout", { text: `Lv.${rel.level} ${rel.levelInfo.label.en} — ${rel.levelInfo.desc.en}`, icon: "💘", color: "pink" }, right);
  const pills = [
    rel.daysTogether !== null && rel.daysTogether >= 0 ? `Together: D+${rel.daysTogether}${rel.met ? ` (since ${rel.met})` : ""}` : null,
    rel.birthdayDday !== null ? `Birthday: D-${rel.birthdayDday}${rel.birthday ? ` (${rel.birthday.slice(5)})` : ""}` : null,
    `Last contact: ${ago(rel.daysSinceContact)}`,
    `Last date: ${ago(rel.daysSinceDate)}`,
  ].filter(Boolean);
  for (const p of pills) add("bulleted_list", { text: p }, right);
  // FaceTime button — a real workspace BUTTON block whose action chain deep-links
  // into the FaceTime app (?call=<first name> auto-starts the call)
  const first = rel.name.split(" ")[0];
  add(
    "button",
    {
      text: `FaceTime ${first}`,
      icon: "📞",
      actions: [{ type: "open_url", url: `${FACETIME}/?call=${encodeURIComponent(first.toLowerCase())}` }],
    },
    right
  );

  // --- agent suggestions ----------------------------------------------------------
  add("heading2", { text: "Agent suggests" });
  for (const s of rel.suggestions) {
    add("callout", { text: s.text, icon: SUGG_ICON[s.kind] ?? "✦", color: s.urgency === 0 ? "red" : s.urgency === 1 ? "yellow" : "gray" });
  }

  // --- about ----------------------------------------------------------------------
  add("heading2", { text: "About her" });
  if (rel.notes) add("bulleted_list", { text: rel.notes });
  if (rel.metAt) add("bulleted_list", { text: `How we met: ${rel.metAt}` });
  if (rel.likes?.length) add("bulleted_list", { text: `Likes: ${rel.likes.join(", ")}` });
  if (rel.dislikes?.length) add("bulleted_list", { text: `Dislikes: ${rel.dislikes.join(", ")}` });
  if (rel.mutual) add("paragraph", { text: rel.mutual });

  // --- date memories ---------------------------------------------------------------
  if (rel.dates?.length) {
    add("heading2", { text: "Date memories" });
    for (const course of rel.dates) {
      add("heading3", { text: `${course.title} · ${course.date}` });
      // photo grid: captions travel with each image. Row sizes come from the
      // course's `rows` layout hint (subject grouping, e.g. food vs scenery),
      // falling back to rows of 4.
      const sizes = Array.isArray(course.rows) && course.rows.length ? [...course.rows] : [];
      let i = 0;
      while (i < course.photos.length) {
        const take = sizes.shift() ?? 4;
        const rowCols = add("column_list", {});
        for (const p of course.photos.slice(i, i + take)) {
          const col = add("column", {}, rowCols);
          const url = await uploadOnce(path.join(PHOTO_DIR, path.basename(p.url)));
          add("image", { url, caption: `${p.time} — ${p.caption}` }, col);
        }
        i += take;
      }
    }
  }

  // --- full record link ---------------------------------------------------------------
  add("divider", {});
  add("link_to_page", { childPageId: rel.rowId });

  await api("PUT", `/api/pages/${pageId}/blocks`, { blocks: out, deletedIds: existing.map((b) => b.id) });
  console.log(`✓ ${rel.name} → /p/${pageId} (${out.length} blocks, ${rel.dates?.length ?? 0} courses)`);
}
console.log("done");
