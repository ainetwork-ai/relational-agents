// Reshape the relationship graph to be REALISTIC: a believable multi-dating
// portfolio (mostly early-stage, one or two serious), stage-consistent dates
// (since / last contact / last date / birthday / events, all today-relative),
// and conversations whose TONE matches the stage — polite small talk at Lv1,
// story-reply flirting at Lv2, careful daily banter at Lv3, label-free comfort
// at Lv4, pet names at Lv5, domestic logistics at Lv6.
//
//   MEMORY_BASE_URL=http://localhost:36625 node scripts/reshape-relationships.mjs [names...]

const BASE_URL = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const AI_URL = (process.env.AI_URL || "http://localhost:8100/v1").replace(/\/$/, "");
const AI_MODEL = process.env.AI_MODEL || "gemma-4-31B-it";
const INDEX_TITLE = "Relationship Records";

const DAY = 86_400_000;
const today = new Date();
const rel = (days, year) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  if (year !== undefined) d.setFullYear(year);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---- the portfolio plan (hand-authored, one entry per girl) -----------------

const PLAN = {
  "Maya Sterling": {
    level: 6, since: -680, lastContact: 0, lastDate: -3,
    birthday: [6, 2000], phone: "+44 7700 900101",
    event: "Her solo exhibition opening", eventOff: 10, acts: 3,
    brief:
      "long-term girlfriend, fully integrated into each other's lives: domestic texts about spare keys, groceries, her cat, " +
      "prepping her exhibition opening; casual intimacy and inside jokes; zero performative romance",
  },
  "Sophie Miller": {
    level: 5, since: -260, lastContact: -1, lastDate: -16,
    birthday: [93, 1997], phone: "+44 7700 900102",
    event: "Her best friend's wedding", eventOff: 20, acts: 3,
    brief:
      "official girlfriend of ~8 months, pet names, she half-jokes half-complains it's been over two weeks since a proper " +
      "date because of both their jobs; they try to pin down a day",
  },
  "Claire Hudson": {
    level: 4, since: -150, lastContact: -2, lastDate: -9,
    birthday: [150, 1995], phone: "+44 7700 900103",
    event: "Her big quarterly presentation", eventOff: 2, acts: 2,
    brief:
      "adult situationship ~5 months: two busy professionals, deliberately label-free, dry flirting, late-night texts, " +
      "she is quietly nervous about her big presentation and pretends not to be",
  },
  "Hannah Brooks": {
    level: 4, since: -120, lastContact: -4, lastDate: -13,
    birthday: [200, 2002], phone: "+44 7700 900104",
    acts: 2,
    brief:
      "casual dating ~4 months, she is buried in PhD fieldwork, replies a day late without apology, dry humor, " +
      "tsundere warmth underneath; nothing defined and neither pushes",
  },
  "Ava Thorne": {
    level: 3, since: -38, lastContact: 0, lastDate: -5,
    birthday: [250, 1998], phone: "+44 7700 900105",
    acts: 2,
    brief:
      "talking stage, met ~5 weeks ago, two dates so far, daily good-morning texts, gentle curiosity about each other's " +
      "routines, tentatively planning a third date; no pet names yet",
  },
  "Zoe Harrison": {
    level: 3, since: -44, lastContact: -1, lastDate: -7,
    birthday: [120, 1999], phone: "+44 7700 900106",
    acts: 2,
    brief:
      "talking stage ~6 weeks: she keeps inventing baking-related excuses to see him ('made too many scones again'), " +
      "warm teasing banter, both clearly interested, nothing said out loud",
  },
  "Mia Collins": {
    level: 3, since: -30, lastContact: -2, lastDate: -8,
    birthday: [300, 2000], phone: "+44 7700 900107",
    event: "Her musical audition", eventOff: 5, acts: 1,
    brief:
      "talking stage ~1 month, theatrical and fun, sends long excited messages, nervous about her audition and " +
      "over-shares about it; one proper date so far",
  },
  "Lily Harper": {
    level: 2, since: -20, lastContact: -1, lastDate: null,
    birthday: [180, 2004], phone: null, acts: 0,
    brief:
      "crush/flirting stage: they met at the gym and follow each other on IG; story replies, gym jokes, emoji-heavy; " +
      "he hasn't actually asked her out yet and the messages dance around it",
  },
  "Riley Vance": {
    level: 2, since: -14, lastContact: -3, lastDate: null,
    birthday: [220, 2001], phone: null, acts: 0,
    brief:
      "crush/flirting at the board-game café she runs shifts at: competitive trash talk about games, DMs about new " +
      "releases, obvious mutual flirting that neither names",
  },
  "Isla Montgomery": {
    level: 1, since: -10, lastContact: -5, lastDate: null,
    birthday: null, phone: null, acts: 0,
    brief:
      "acquaintance from the university chess club: polite, slightly formal small talk about openings and the club " +
      "schedule; he is interested, she is perfectly unreadable; strictly no flirting in the texts",
  },
};

// ---- clients -----------------------------------------------------------------

let cookie = null;
async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/demo-login`, { method: "POST" });
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!res.ok) throw new Error(`login: HTTP ${res.status}`);
}
async function api(method, path, body) {
  if (!cookie) await login();
  const opts = { method, headers: { cookie, "content-type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res = await fetch(BASE_URL + path, opts);
  if (res.status === 401) {
    await login();
    opts.headers.cookie = cookie;
    res = await fetch(BASE_URL + path, opts);
  }
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function chat(messages) {
  const res = await fetch(`${AI_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.7, max_tokens: 4096 }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`AI: HTTP ${res.status}`);
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}
const parseJson = (t) => JSON.parse(t.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim());

const SYS = "You are a fiction writer who writes painfully realistic text-message exchanges. Reply with ONLY valid JSON.";

function factSheet(p) {
  const f = [`they met ${-p.since} days ago`, `last text ${-p.lastContact === 0 ? "today" : `${-p.lastContact} days ago`}`];
  if (p.lastDate !== null) f.push(`last in-person date ${-p.lastDate} days ago`);
  else f.push("they have never been on a real date");
  if (p.event) f.push(`upcoming: ${p.event} in ${p.eventOff} days`);
  return f.join("; ");
}

async function genEn(meta, p) {
  const user =
    `Write content for a fictional dating-journal entry. Persona: ${meta.name}, ${meta.age}, ${meta.job}, MBTI ${meta.mbti}, ` +
    `met: ${meta.met_at}. Her likes: ${(meta.likes ?? []).join(", ")}.\n` +
    `Relationship stage: ${p.brief}\nHard facts to respect: ${factSheet(p)}.\n\n` +
    `Return JSON: {"conversation":[{"from":"me"|"her","text":"..."} x8-10], "activities":[string x${p.acts}], "mutual":"..."}.\n` +
    `Rules: the conversation is a REAL-feeling UK text thread — lowercase is fine, imperfect punctuation, varied message length, ` +
    `concrete details (place names, times, small logistics), no greeting-card romance, no exclamation spam. ` +
    `The intimacy level must match the stage EXACTLY — do not write couple-y texts for early stages, no pet names below stage 5. ` +
    `"activities" = things they actually did together (${p.acts === 0 ? "empty array — they haven't done anything together yet" : "short concrete entries"}). ` +
    `"mutual" = one short sentence on shared tastes${p.level <= 2 ? " (what he knows so far, tentative)" : ""}.`;
  const out = parseJson(await chat([{ role: "system", content: SYS }, { role: "user", content: user }]));
  if (!Array.isArray(out.conversation) || out.conversation.length < 6) throw new Error("bad conversation");
  return out;
}

async function genPt(meta, p, en) {
  const user =
    `Transcreate this fictional text thread for a Brazilian persona named ${meta.name_pt} (same person, localized), ` +
    `living in Brazil. Same relationship stage: ${p.brief}. Same facts: ${factSheet(p)}.\n` +
    `Rewrite each message so it reads like REAL Brazilian texting (kkkk, mds, abbreviations), same emotional beat per message, ` +
    `same "from" values, same array length. Adapt places to Brazil. No pet names below stage 5 (stage is ${p.level}).\n\n` +
    JSON.stringify(en);
  const out = parseJson(await chat([{ role: "system", content: SYS }, { role: "user", content: user }]));
  if (!Array.isArray(out.conversation) || out.conversation.length !== en.conversation.length) throw new Error("bad pt");
  return out;
}

// ---- doc surgery ----------------------------------------------------------------

const text = (b) => (typeof b.content?.text === "string" ? b.content.text : "");
const REPLACE_HEADINGS = new Set([
  "Conversation", "Activities", "What we both like",
  "Conversa", "Atividades", "O que nós gostamos",
]);

function parseYamlish(y) {
  const meta = {};
  let listKey = null;
  for (const raw of y.split("\n")) {
    const li = raw.match(/^\s*-\s+(.+)$/);
    if (li && listKey) meta[listKey].push(li[1].trim());
    else {
      const kv = raw.match(/^([^\s:#][^:]*):\s*(.*)$/);
      if (kv) {
        if (kv[2].trim()) {
          meta[kv[1].trim()] = kv[2].trim();
          listKey = null;
        } else meta[(listKey = kv[1].trim())] = [];
      }
    }
  }
  return meta;
}

/** Rewrite scalar keys in the yaml text (add if missing), preserving order. */
function patchYaml(yaml, sets, removes = []) {
  let lines = yaml.split("\n").filter((l) => l.trim() !== "");
  for (const key of removes) {
    lines = lines.filter((l) => !new RegExp(`^${key}:`).test(l));
  }
  for (const [key, value] of Object.entries(sets)) {
    if (value === null || value === undefined) {
      lines = lines.filter((l) => !new RegExp(`^${key}:`).test(l));
      continue;
    }
    const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    const line = `${key}: ${value}`;
    if (i >= 0) lines[i] = line;
    else {
      // insert scalars right after `since` (or after name) to keep the yaml tidy
      const anchor = lines.findIndex((l) => /^since:/.test(l));
      lines.splice(anchor >= 0 ? anchor + 1 : 1, 0, line);
    }
  }
  return lines.join("\n") + "\n";
}

async function processPage(page) {
  const name = page.title.replace(/^gf-\d+-/, "");
  const p = PLAN[name];
  if (!p) {
    console.log(`? ${page.title} — no plan entry`);
    return;
  }
  const { blocks } = await api("GET", `/api/pages/${page.id}/blocks`);
  const codeBlock = blocks.find((b) => b.type === "code");
  const meta = parseYamlish(text(codeBlock));

  console.log(`… ${name} (Lv${p.level}): writing EN thread`);
  const en = await genEn(meta, p);
  console.log(`… ${name}: transcreating PT thread`);
  const pt = await genPt(meta, p, en);

  // yaml: stage + operational fields (today-relative dates, absolute in the doc)
  const newYaml = patchYaml(text(codeBlock), {
    level: p.level,
    since: rel(p.since),
    birthday: p.birthday ? rel(...p.birthday) : null,
    last_contact: rel(p.lastContact),
    last_date: p.lastDate !== null ? rel(p.lastDate) : null,
    phone: p.phone,
    event: p.event ?? null,
    event_date: p.event ? rel(p.eventOff) : null,
  });

  // delete every replaced section (heading + its blocks); keep "Places we've
  // been" only for stages that have actually been places together
  const deletedIds = [];
  let inReplaced = false;
  let inPlaces = false;
  for (const b of blocks) {
    if (/^heading/.test(b.type)) {
      const h = text(b).trim();
      inReplaced = REPLACE_HEADINGS.has(h);
      inPlaces = h === "Places we've been";
      if (inReplaced || (inPlaces && p.level <= 2)) deletedIds.push(b.id);
      continue;
    }
    if (inReplaced || (inPlaces && p.level <= 2)) deletedIds.push(b.id);
  }

  let pos = Math.max(...blocks.map((b) => b.position)) + 1;
  const add = [];
  const push = (type, t) => add.push({ type, content: { text: t }, position: pos++ });
  const first = (n) => String(n ?? "").split(" ")[0];

  push("heading2", "Conversation");
  for (const m of en.conversation) push("paragraph", `${m.from === "me" ? "Me" : first(meta.name)}: ${m.text}`);
  if (en.activities?.length) {
    push("heading2", "Activities");
    for (const a of en.activities) push("bulleted_list", a);
  }
  if (en.mutual) {
    push("heading2", "What we both like");
    push("paragraph", en.mutual);
  }
  push("heading2", "Conversa");
  for (const m of pt.conversation) push("paragraph", `${m.from === "me" ? "Eu" : first(meta.name_pt)}: ${m.text}`);
  if (pt.activities?.length) {
    push("heading2", "Atividades");
    for (const a of pt.activities) push("bulleted_list", a);
  }
  if (pt.mutual) {
    push("heading2", "O que nós gostamos");
    push("paragraph", pt.mutual);
  }

  await api("PUT", `/api/pages/${page.id}/blocks`, {
    blocks: [{ id: codeBlock.id, type: "code", content: { text: newYaml }, position: codeBlock.position }, ...add],
    deletedIds,
  });
  console.log(`✓ ${name} — Lv${p.level}, since ${rel(p.since)} (deleted ${deletedIds.length}, added ${add.length})`);
}

// ---- main ---------------------------------------------------------------------------

const { pages } = await api("GET", "/api/pages");
const index = pages.find((pg) => pg.title === INDEX_TITLE && !pg.isArchived);
if (!index) throw new Error("gf-records-index not found");
const kids = pages
  .filter((pg) => pg.parentPageId === index.id && !pg.isArchived)
  .sort((a, b) => a.title.localeCompare(b.title));
const filter = process.argv.slice(2);
for (const pg of kids) {
  if (filter.length && !filter.some((f) => pg.title.toLowerCase().includes(f.toLowerCase()))) continue;
  try {
    await processPage(pg);
  } catch (err) {
    console.error(`✗ ${pg.title}: ${err.message}`);
  }
}
console.log("done");
