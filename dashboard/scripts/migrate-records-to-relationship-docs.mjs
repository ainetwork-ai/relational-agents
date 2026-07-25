// Migrate the seeded "Chanho ❤️ …" relationship records into REAL agent
// relationship docs (OKF, file-primary), one per girlfriend:
//   1. a demo user per girlfriend (demo-login `as`) joined to Chanho's workspace
//   2. a 1:1 DM room (consented) seeded with the record's conversation,
//      each line authored by its actual speaker
//   3. the agent write pipeline (real LLM) turns the chat into the doc
//   4. profile facts the chat can't carry (met story, birthday, likes,
//      date memories, upcoming events) are appended to the doc sections
// Idempotent: rooms are reused (directKey), seeded rooms are not re-seeded,
// enriched sections are marked and skipped on rerun.
//
//   MEMORY_BASE_URL=http://localhost:36625 DASH_URL=http://localhost:3110 \
//     node scripts/migrate-records-to-relationship-docs.mjs [names...]

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "..", "..", "app", "package.json"));
const { Client } = require("pg");

const BASE = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const DASH = (process.env.DASH_URL || "http://localhost:3110").replace(/\/$/, "");
const PG_URL =
  process.env.POSTGRES_URL || "postgresql://app_clone:app_clone_dev@localhost:5434/app_clone";
const MARK = "Migrated from the relationship record";

// ---- clone api client (cookie per identity) ---------------------------------

async function login(as) {
  const r = await fetch(`${BASE}/api/auth/demo-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(as ? { as } : {}),
  });
  if (!r.ok) throw new Error(`login(${as ?? "demo"}): ${r.status}`);
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const { user } = await r.json();
  return { cookie, user };
}

async function api(session, method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}

// ---- doc section append (same semantics as lib/agent/okf-docs appendOkfLines) --

const block = (type, text, position) => ({ id: randomUUID(), type, content: { text }, position });

async function appendSection(session, relPath, lines) {
  if (!lines.length) return false;
  const { node } = await api(session, "GET", `/api/okf/node?path=${encodeURIComponent(relPath)}`);
  if (!node || node.kind !== "page") return false;
  const existing = node.blocks ?? [];
  if (existing.some((b) => (b.content?.text ?? "").includes(MARK))) return false; // already enriched
  let pos = existing.reduce((m, b) => Math.max(m, b.position ?? 0), 0);
  const added = lines
    .filter((l) => l.text?.trim())
    .map((l) => block(l.type ?? "bulleted_list", l.text, ++pos));
  added.push(block("paragraph", `${MARK}.`, ++pos));
  await api(session, "PUT", "/api/okf/page", {
    path: relPath,
    title: node.title,
    meta: node.meta ?? {},
    blocks: [...existing, ...added],
  });
  return true;
}

/** Fallback when the dashboard parser missed the conversation (merged-marker
 *  bug): pull `Me:`/`<First>:` paragraphs straight off the record page. */
async function conversationFromRecord(session, rel) {
  const first = rel.name.split(" ")[0];
  const speaker = new RegExp(`^(Me|${first}):\\s+(.*)$`);
  const { blocks } = await api(session, "GET", `/api/pages/${rel.rowId}/blocks`);
  const out = [];
  for (const b of blocks ?? []) {
    const m = typeof b.content?.text === "string" && b.content.text.match(speaker);
    if (m) out.push({ from: m[1] === "Me" ? "me" : "her", text: m[2] });
  }
  return out;
}

const toId = (relPath) => Buffer.from(relPath, "utf8").toString("base64url");

/** Older doc roots list the sections as dead text bullets — turn them into
 *  links to the section pages so the root actually navigates. Idempotent. */
async function fixRootIndex(session, rootPath, sectionPaths) {
  const { node } = await api(session, "GET", `/api/okf/node?path=${encodeURIComponent(rootPath)}`);
  if (!node || node.kind !== "page") return false;
  const byTitle = new Map(
    Object.values(sectionPaths).map((p) => [p.replace(/^.*\//, "").replace(/\.md$/, ""), p])
  );
  let changed = false;
  const blocks = (node.blocks ?? []).map((b) => {
    const text = b.content?.text ?? "";
    const rel = b.type === "bulleted_list" && !b.content?.html && byTitle.get(text.trim());
    if (!rel) return b;
    changed = true;
    return { ...b, content: { text: `[${text.trim()}](/p/${toId(rel)})` } };
  });
  if (!changed) return false;
  await api(session, "PUT", "/api/okf/page", {
    path: rootPath,
    title: node.title,
    meta: node.meta ?? {},
    blocks,
  });
  return true;
}

// ---- per-section content from the record data --------------------------------

function sectionLines(rel) {
  const li = (text) => ({ type: "bulleted_list", text });
  const overview = [
    li(`Relationship level: Lv.${rel.level}${rel.levelInfo?.name ? ` — ${rel.levelInfo.name}` : ""}`),
    rel.met && li(`Together since ${rel.met}${rel.daysTogether != null ? ` (D+${rel.daysTogether})` : ""}`),
    rel.lastContact && li(`Last contact: ${rel.lastContact} · last date: ${rel.lastDate ?? "—"}`),
    rel.mutual && li(`What we both like: ${rel.mutual}`),
  ];
  const people = [
    rel.notes && li(rel.notes),
    rel.metAt && li(`How we met: ${rel.metAt}`),
    rel.birthday && li(`Birthday: ${rel.birthday}`),
    rel.phone && li(`Phone: ${rel.phone}`),
    rel.likes?.length && li(`Likes: ${rel.likes.join(", ")}`),
    rel.dislikes?.length && li(`Dislikes: ${rel.dislikes.join(", ")}`),
  ];
  const timeline = [
    rel.met && rel.metAt && li(`${rel.met} — first met: ${rel.metAt}`),
    ...(rel.dates ?? []).map((d) => li(`${d.date} — ${d.title}`)),
    ...(rel.activities ?? []).map((a) => li(`Recently: ${a}`)),
  ];
  const decisions = [
    rel.nextMilestone?.label &&
      li(`Upcoming: ${rel.nextMilestone.label}${rel.nextMilestone.date ? ` (${rel.nextMilestone.date})` : ""}`),
  ];
  const openTopics = (rel.suggestions ?? []).map((s) => li(typeof s === "string" ? s : s.text ?? ""));
  return { overview, people, timeline, decisions, "open-topics": openTopics };
}

// ---- main ---------------------------------------------------------------------

const only = process.argv.slice(2).map((s) => s.toLowerCase());
const pg = new Client({ connectionString: PG_URL });
await pg.connect();

const me = await login(); // DemoUser (Chanho)
const myWorkspaces = (
  await pg.query("select workspace_id from workspace_members where user_id=$1", [me.user.id])
).rows.map((r) => r.workspace_id);

const dash = await (await fetch(`${DASH}/api/dashboard?lang=en`)).json();
const rels = dash.relationships.filter(
  (r) => only.length === 0 || only.includes(r.name.toLowerCase())
);
console.log(`${rels.length} relationship(s) to migrate`);

for (const rel of rels) {
  console.log(`\n── ${rel.name}`);
  const her = await login(rel.name);

  // she must share Chanho's workspace before a DM room can include her
  for (const ws of myWorkspaces)
    await pg.query(
      "insert into workspace_members (workspace_id, user_id) values ($1,$2) on conflict do nothing",
      [ws, her.user.id]
    );

  const { room } = await api(me, "POST", "/api/dm/rooms", {
    memberIds: [her.user.id],
    name: rel.name,
  });
  console.log(`  room ${room.id.slice(0, 8)} (${room.name || rel.name})`);

  // seed the recorded conversation, each line by its real author (idempotent:
  // a room that already has messages keeps them)
  const detail = await api(me, "GET", `/api/dm/rooms/${room.id}`);
  if ((detail.messages ?? []).length === 0) {
    if (!rel.conversation?.length) rel.conversation = await conversationFromRecord(me, rel);
    for (const line of rel.conversation ?? []) {
      const author = line.from === "me" ? me : her;
      await api(author, "POST", `/api/dm/rooms/${room.id}/messages`, { text: line.text });
    }
    console.log(`  seeded ${rel.conversation?.length ?? 0} messages`);
  } else {
    console.log(`  messages already present (${detail.messages.length}) — not re-seeding`);
  }

  // run the agent write pipeline (real LLM) — retry once on flaky output
  let run;
  for (let attempt = 1; attempt <= 3 && !run; attempt++) {
    try {
      run = await api(me, "POST", `/api/agent/rooms/${room.id}/run`);
    } catch (err) {
      console.log(`  pipeline attempt ${attempt} failed: ${String(err).slice(0, 120)}`);
      if (attempt === 3) throw err;
    }
  }
  console.log(`  pipeline: processed=${run.processed} edits=${run.edits} → ${run.rootPageId}`);

  // enrich sections with record facts the conversation doesn't carry
  const { rows } = await pg.query(
    "select root_okf_path, section_okf_paths from agent_room_states where room_id=$1",
    [room.id]
  );
  const state = rows[0];
  if (!state?.root_okf_path) {
    console.log("  !! no doc tree — skipping enrichment");
    continue;
  }
  if (await fixRootIndex(me, state.root_okf_path, state.section_okf_paths ?? {}))
    console.log("  + root index links");
  const lines = sectionLines(rel);
  for (const [key, relPath] of Object.entries(state.section_okf_paths ?? {})) {
    const content = (lines[key] ?? []).filter(Boolean);
    if (await appendSection(me, relPath, content)) console.log(`  + ${key} (${content.length})`);
  }
}

await pg.end();
console.log("\ndone");
