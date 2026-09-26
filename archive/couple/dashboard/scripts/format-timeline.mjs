// Reshape each relationship doc's Timeline section into the formal template:
//
//   # 2026-08-04                  ← one date = one event, chronological
//   ## Belém day — natas at the source, castle at golden hour
//   > 💕 17:46 – 00:31 · 4 moments — caption · caption · …   (callout)
//   ### 17:46 ~
//   ![caption](/uploads/…)        ← time-stamped photos, in order
//
// Agent-recorded lines (the pipeline's bullets + "Sources:" links) are DATA we
// don't touch — they are preserved verbatim under "## From our conversations".
// Rebuild is deterministic and idempotent: template blocks are regenerated
// from the dashboard data each run, agent lines survive every run.
//
//   MEMORY_BASE_URL=http://localhost:36625 DASH_URL=http://localhost:3110 \
//     node scripts/format-timeline.mjs [names...]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "..", "..", "app", "package.json"));
const { Client } = require("pg");

const BASE = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const DASH = (process.env.DASH_URL || "http://localhost:3110").replace(/\/$/, "");
const PG_URL =
  process.env.POSTGRES_URL || "postgresql://notion_clone:notion_clone_dev@localhost:5434/notion_clone";
const PHOTO_DIR = path.join(HERE, "..", "public");
const CACHE_FILE = path.join(HERE, "..", ".uploads-cache.json");
const AGENT_H2 = "From our conversations";

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
async function uploadOnce(rel) {
  const key = path.basename(rel);
  if (cache[key]) return cache[key];
  const abs = path.join(PHOTO_DIR, rel.replace(/^\//, ""));
  if (!fs.existsSync(abs)) return null;
  if (!cookie) await login();
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(abs)], { type: "image/jpeg" }), key);
  const r = await fetch(`${BASE}/api/upload`, { method: "POST", headers: { cookie }, body: form });
  if (!r.ok) throw new Error(`upload ${key}: ${r.status}`);
  cache[key] = (await r.json()).url;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
  return cache[key];
}

const block = (type, content, position, parentBlockId = null, id = randomUUID()) => ({
  id,
  type,
  content,
  position,
  ...(parentBlockId ? { parentBlockId } : {}),
});

/** Blocks this script (or the flat migration) generated — regenerated each
 *  run, so they must not survive as leftovers. Everything else is agent data. */
function isTemplateBlock(b, activitySet) {
  const text = (b.content?.text ?? "").trim();
  if (b.type === "heading1") return /^\d{4}-\d{2}-\d{2}$/.test(text);
  if (b.type === "heading2") return true; // event titles + section headers are ours
  if (b.type === "heading3") return /^\d{2}:\d{2} ~$/.test(text);
  if (b.type === "callout" || b.type === "image" || b.type === "quote") return true;
  if (b.type === "column_list" || b.type === "column") return true; // photo rows are regenerated
  if (b.type === "bulleted_list")
    return (
      activitySet.has(text) || // "Other moments" bullets are regenerated from data
      /^\d{4}-\d{2}-\d{2} — /.test(text) ||
      /^Recently: /.test(text) ||
      /^Other moments/.test(text)
    );
  if (b.type === "paragraph") return /Migrated from the relationship record/.test(text);
  return false;
}

async function formatTimeline(rel, timelinePath) {
  const { node } = await api("GET", `/api/okf/node?path=${encodeURIComponent(timelinePath)}`);
  if (!node || node.kind !== "page") return false;

  const activitySet = new Set((rel.activities ?? []).map((a) => a.trim()));
  const agentBlocks = (node.blocks ?? []).filter((b) => !isTemplateBlock(b, activitySet));

  const out = [];
  let pos = 0;
  const add = (type, content) => out.push(block(type, content, ++pos));

  // events: first-met, then every recorded date, chronological
  const events = [];
  if (rel.met)
    events.push({
      date: rel.met,
      title: "First met",
      detail: rel.metAt || "Where it all started",
      icon: "💘",
      photos: [],
    });
  for (const d of rel.dates ?? []) {
    const captions = (d.photos ?? []).map((p) => p.caption).filter(Boolean);
    events.push({
      date: d.date,
      title: d.title,
      detail:
        `${d.timeRange ?? ""}${d.timeRange ? " · " : ""}${(d.photos ?? []).length} moment${(d.photos ?? []).length === 1 ? "" : "s"}` +
        (captions.length ? ` — ${captions.join(" · ")}`.slice(0, 400) : ""),
      icon: "💕",
      photos: d.photos ?? [],
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  for (const ev of events) {
    add("heading1", { text: ev.date });
    add("heading2", { text: ev.title });
    add("callout", { icon: ev.icon, text: ev.detail });
    // several shots of the same place ride under ONE time heading — consecutive
    // photos sharing a `spot` (or the exact same time) belong to one moment,
    // and a multi-photo moment lays its shots out SIDE BY SIDE (column layout)
    const moments = [];
    for (const p of ev.photos) {
      const key = p.spot ?? p.time ?? Math.random();
      const cur = moments[moments.length - 1];
      if (cur && cur.key === key) cur.photos.push(p);
      else moments.push({ key, time: p.time, photos: [p] });
    }
    for (const g of moments) {
      if (g.time) add("heading3", { text: `${g.time} ~` });
      const ups = [];
      for (const p of g.photos) {
        const url = await uploadOnce(p.url);
        if (url) ups.push({ url, caption: p.caption });
        else if (p.caption) add("paragraph", { text: p.caption });
      }
      if (ups.length >= 2) {
        const listId = randomUUID();
        out.push(block("column_list", {}, ++pos, null, listId));
        ups.forEach((u, j) => {
          const colId = randomUUID();
          out.push(block("column", {}, j + 1, listId, colId));
          out.push(
            block("image", { url: u.url, ...(u.caption ? { caption: u.caption } : {}) }, 1, colId)
          );
        });
      } else if (ups.length === 1) {
        add("image", { url: ups[0].url, ...(ups[0].caption ? { caption: ups[0].caption } : {}) });
      }
    }
  }

  if (rel.activities?.length) {
    add("heading2", { text: "Other moments together" });
    for (const a of rel.activities) add("bulleted_list", { text: a });
  }

  if (agentBlocks.length) {
    add("heading2", { text: AGENT_H2 });
    for (const b of agentBlocks) out.push({ ...b, position: ++pos });
  }

  await api("PUT", "/api/okf/page", {
    path: timelinePath,
    title: node.title,
    meta: node.meta ?? {},
    blocks: out,
  });
  return { events: events.length, agent: agentBlocks.length };
}

// ---- main ----------------------------------------------------------------------

const only = process.argv.slice(2).map((s) => s.toLowerCase());
const dash = await (await fetch(`${DASH}/api/dashboard?lang=en`)).json();
// `spot` (same-place grouping) comes straight from dates.json — the running
// dashboard may predate the passthrough in server.mjs
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(HERE, "..", "public", "date", "dates.json"), "utf8")
  );
  const spotByFile = new Map(
    (manifest.courses ?? []).flatMap((c) => c.photos.map((p) => [p.file, p.spot]))
  );
  for (const r of dash.relationships)
    for (const d of r.dates ?? [])
      for (const p of d.photos ?? []) p.spot ??= spotByFile.get(path.basename(p.url));
} catch {
  // no manifest — photos simply keep one heading each
}
const rels = dash.relationships.filter((r) => only.length === 0 || only.includes(r.name.toLowerCase()));

const pg = new Client({ connectionString: PG_URL });
await pg.connect();

for (const rel of rels) {
  const { rows } = await pg.query(
    `select s.section_okf_paths from agent_room_states s
       join chat_rooms r on r.id = s.room_id
      where r.name = $1 and s.root_okf_path is not null
      order by s.updated_at desc limit 1`,
    [rel.name]
  );
  const timelinePath = rows[0]?.section_okf_paths?.timeline;
  if (!timelinePath) {
    console.log(`── ${rel.name}: no relationship doc — skipped`);
    continue;
  }
  const res = await formatTimeline(rel, timelinePath);
  console.log(`── ${rel.name}: ${res ? `${res.events} events, ${res.agent} agent lines kept` : "failed"}`);
}
await pg.end();
console.log("done");
