// Girlfriend-records source: reads the team's gf documents straight from the
// workspace app’s REST API (the pages under "Relationship Records"). Each page is:
//   [code]  YAML-ish metadata (name/age/job/mbti/met_at/since/likes/dislikes…)
//   [h2] chat log      → chat paragraphs "speaker: text"
//   [h2] places         → table
//   [h2] activities      → bullets
//   [h2] mutual likes    → paragraphs
// The section-name and speaker-label string literals below are DATA matchers
// against Korean-authored source docs, not UI — kept as-is on purpose.
// Zero deps; auth = demo-login iron-session cookie, kept in memory.

const INDEX_TITLE = "Relationship Records";

let cookie = null;

async function login(baseUrl) {
  const res = await fetch(`${baseUrl}/api/auth/demo-login`, { method: "POST" });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length) cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!res.ok) throw new Error(`clone login failed: HTTP ${res.status}`);
}

async function getJson(baseUrl, apiPath) {
  if (!cookie) await login(baseUrl);
  let res = await fetch(baseUrl + apiPath, { headers: { cookie } });
  if (res.status === 401) {
    await login(baseUrl);
    res = await fetch(baseUrl + apiPath, { headers: { cookie } });
  }
  if (!res.ok) throw new Error(`GET ${apiPath}: HTTP ${res.status}`);
  return res.json();
}

/** Tiny YAML-ish parser: `key: value` lines + `- item` lists (1-level). */
function parseYamlish(text) {
  const out = {};
  let listKey = null;
  for (const raw of String(text).split("\n")) {
    const li = raw.match(/^\s*-\s+(.+)$/);
    if (li && listKey) {
      out[listKey].push(li[1].trim());
      continue;
    }
    const kv = raw.match(/^([^\s:#][^:]*):\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim();
      const val = kv[2].trim();
      if (val) {
        out[key] = val;
        listKey = null;
      } else {
        out[key] = [];
        listKey = key;
      }
    }
  }
  return out;
}

/** Relationship level from how long you've been together — used only when the
 *  document doesn't declare `level:` itself. */
function levelFromDuration(sinceYmd, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(sinceYmd ?? "");
  if (!m) return 3;
  const days = Math.round((today - new Date(+m[1], m[2] - 1, +m[3])) / 86_400_000);
  if (days < 90) return 2;
  if (days < 240) return 3;
  if (days < 450) return 4;
  if (days < 700) return 5;
  if (days < 1000) return 6;
  return 7;
}

function blockText(b) {
  const t = b.content?.text;
  return typeof t === "string" ? t : "";
}

/** Split blocks into sections keyed by their h2/h3 heading text. */
function sections(blocks) {
  const out = new Map();
  let cur = null;
  for (const b of blocks) {
    if (b.type === "heading1" || b.type === "heading2" || b.type === "heading3") {
      cur = blockText(b).trim();
      out.set(cur, []);
    } else if (cur) {
      out.get(cur).push(b);
    }
  }
  return out;
}

// Per-language document layout: which sections and speaker label mean what.
// Persona yaml has an EN base with *_pt Portuguese overrides; val() falls back
// from the suffixed key to the base so any doc keeps working.
const LANGS = {
  en: { suffix: "_en", me: "Me", conv: "Conversation", acts: "Activities", mutual: "What we both like", age: (a) => `Age ${a}` },
  pt: { suffix: "_pt", me: "Eu", conv: "Conversa", acts: "Atividades", mutual: "O que nós gostamos", age: (a) => `${a} anos` },
};

function parseGfPage(page, blocks, today, lang = "en") {
  const meta = parseYamlish(blockText(blocks.find((b) => b.type === "code") ?? {}));
  const sec = sections(blocks);
  const L = LANGS[lang] ?? LANGS.en;
  const val = (key) => meta[key + L.suffix] ?? meta[key];

  const convBlocks = sec.get(L.conv) ?? [];
  const conversation = convBlocks
    .filter((b) => b.type === "paragraph" && blockText(b).trim())
    .map((b) => {
      const m = blockText(b).match(/^([^:]{1,20}):\s*(.+)$/s);
      if (!m) return { from: "her", text: blockText(b).trim() };
      const speaker = m[1].trim();
      return { from: speaker === L.me ? "me" : "her", text: m[2].trim() };
    });

  const actBlocks = sec.get(L.acts) ?? [];
  const activities = actBlocks.filter((b) => /list/.test(b.type)).map(blockText).filter(Boolean);

  const mutualBlocks = sec.get(L.mutual) ?? [];
  const mutual = mutualBlocks
    .filter((b) => b.type === "paragraph")
    .map(blockText)
    .filter(Boolean)
    .join(" ");

  const name = val("name") || meta.name || page.title.replace(/^gf-\d+-/, "");
  const likesLoc = Array.isArray(val("likes")) ? val("likes") : [];
  const noteBits = [meta.age ? L.age(meta.age) : "", val("job") ?? "", meta.mbti ?? ""].filter(Boolean);

  return {
    rowId: page.id,
    name,
    avatarKey: koName, // avatar files are keyed by the Korean name
    level: meta.level !== undefined ? Number(meta.level) : levelFromDuration(meta.since, today),
    met: meta.since || undefined,
    birthday: meta.birthday || undefined,
    lastContact: meta.last_contact || undefined,
    lastDate: meta.last_date || undefined,
    phone: meta.phone || undefined,
    event: val("event") || undefined,
    eventDate: meta.event_date || undefined,
    notes: noteBits.join(" · ") || undefined,
    appearance: meta.appearance || undefined,
    metAt: val("met_at") || undefined,
    likes: likesLoc,
    dislikes: Array.isArray(val("dislikes")) ? val("dislikes") : [],
    activities,
    mutual: mutual || undefined,
    conversation,
  };
}

/** Fetch every gf record under the index page. Returns null when the index
 *  page doesn't exist (caller falls back to the CSV source). */
export async function fetchGfRelationships(baseUrl, indexId, today, lang = "en") {
  const { pages } = await getJson(baseUrl, "/api/pages");
  const index = indexId
    ? pages.find((p) => p.id === indexId)
    : pages.find((p) => p.title === INDEX_TITLE && !p.isArchived);
  if (!index) return null;

  // The index page's summary table defines the display order: its name cells
  // are `[Name](/p/<id>)` links, one row per record. Pages not referenced
  // there sort after the linked ones, by title.
  const idxBlocks = (await getJson(baseUrl, `/api/pages/${index.id}/blocks`)).blocks;
  const linkOrder = [];
  for (const b of idxBlocks) {
    const cells = b.content?.table?.cells ?? [];
    for (const row of cells) {
      for (const cell of row) {
        for (const m of String(cell).matchAll(/\(\/p\/([0-9a-fA-F-]{36})\)/g)) linkOrder.push(m[1]);
      }
    }
  }
  const rank = (p) => {
    const i = linkOrder.indexOf(p.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const kids = pages
    .filter((p) => p.parentPageId === index.id && !p.isArchived)
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));

  const rels = await Promise.all(
    kids.map(async (p) => {
      const { blocks } = await getJson(baseUrl, `/api/pages/${p.id}/blocks`);
      return parseGfPage(p, blocks, today, lang);
    })
  );
  return { indexId: index.id, relationships: rels };
}
