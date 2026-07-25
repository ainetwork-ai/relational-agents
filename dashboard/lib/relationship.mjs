// ===========================================================================
// Relationship agent core: people are nodes, relationships are edges.
// The girlfriends database is a plain CSV inside the Notion clone's OKF store
// (NOTION_FS_ROOT) — editable as a normal Notion table. This module is the
// pure edge-derivation layer: level scale, D-day math, alerts, and the
// agent's suggested actions. Everything is deterministic w.r.t. (data, today)
// so a derivation can never mix one partner's dates into another edge.
// ===========================================================================

export const LEVELS = [
  {
    level: 0,
    heart: "#ffffff",
    label: { en: "Total Stranger", pt: "Desconhecidos" },
    desc: {
      en: "Neither knows the other exists",
      pt: "Nenhum dos dois sabe que o outro existe",
    },
  },
  {
    level: 1,
    heart: "#ffe4e6",
    label: { en: "Acquaintance", pt: "Conhecidos" },
    desc: {
      en: "Knows name and face, exchanges greetings",
      pt: "Sabe o nome e o rosto, troca cumprimentos",
    },
  },
  {
    level: 2,
    heart: "#fecdd3",
    label: { en: "Crush & Flirting", pt: "Paquera" },
    desc: {
      en: "Story replies and reels, testing the waters",
      pt: "Respondendo stories e reels, sentindo o clima",
    },
  },
  {
    level: 3,
    heart: "#fda4af",
    label: { en: "Talking Stage", pt: "Conversando" },
    desc: {
      en: "Daily texts and one-on-one dates, no label yet",
      pt: "Mensagens diárias e encontros a dois, sem rótulo ainda",
    },
  },
  {
    level: 4,
    heart: "#fb7185",
    label: { en: "Situationship", pt: "Rolo" },
    desc: {
      en: "Dating without commitment, not exclusive",
      pt: "Saindo juntos sem compromisso, não exclusivo",
    },
  },
  {
    level: 5,
    heart: "#f43f5e",
    label: { en: "Official Couple", pt: "Namoro oficial" },
    desc: {
      en: "DTR done, exclusively dating",
      pt: "DR feita, namorando exclusivamente",
    },
  },
  {
    level: 6,
    heart: "#e11d48",
    label: { en: "Deep Integration", pt: "Integração total" },
    desc: {
      en: "Met friends and family, toothbrush at her place",
      pt: "Já conheceu amigos e família, escova de dentes na casa dela",
    },
  },
  {
    level: 7,
    heart: "#be123c",
    label: { en: "Almost Married", pt: "Quase casados" },
    desc: {
      en: "Co-living or engaged, sharing finances and life",
      pt: "Morando juntos ou noivos, dividindo finanças e a vida",
    },
  },
];

export function levelInfo(level) {
  return LEVELS[Math.min(Math.max(Math.round(level) || 0, 0), LEVELS.length - 1)];
}

// ---- agent voice, per language ----------------------------------------------

const T = {
  en: {
    birthdayToday: (r) => `Today is ${r.name}'s birthday! Send her a birthday message right now 🎂`,
    birthdaySoon: (r, d) => `${r.name}'s birthday is in ${d} day${d === 1 ? "" : "s"}. Prepare a gift and a plan 🎁`,
    event: (r, d) => `She has an important event coming up: ${r.event} (D-${d}). Show her you remembered 📅`,
    hundred: (m, d) => `Your ${m}-day anniversary is D-${d}! Plan something special 💐`,
    yearly: (y, d) => `Your anniversary (year ${y}) is D-${d}. Book the restaurant now 🥂`,
    contact: (s) => `Last contact was ${s} days ago. Ask her how she slept 💬`,
    contactLow: (s) => `It's been ${s} days since you last talked — send something light to keep the thread alive 💬`,
    date: (s) => `Your last date was ${s} days ago... Time to schedule the next one 🌹`,
    likes: (l) => `She loves ${l} — plan a little surprise around it 💡`,
    ok: () => "The relationship is smooth sailing. A small check-in today is all it takes ✨",
  },
  pt: {
    birthdayToday: (r) => `Hoje é o aniversário da ${r.name}! Mande uma mensagem agora mesmo 🎂`,
    birthdaySoon: (r, d) => `O aniversário da ${r.name} é em ${d} dia${d === 1 ? "" : "s"}. Prepare um presente e um plano 🎁`,
    event: (r, d) => `Ela tem um evento importante chegando: ${r.event} (D-${d}). Mostre que você lembrou 📅`,
    hundred: (m, d) => `Faltam ${d} dias para o aniversário de ${m} dias juntos! Planeje algo especial 💐`,
    yearly: (y, d) => `Faltam ${d} dias para o aniversário de ${y} ano${y === 1 ? "" : "s"} de vocês. Reserve o restaurante 🥂`,
    contact: (s) => `O último contato foi há ${s} dias. Pergunte como ela dormiu 💬`,
    contactLow: (s) => `Já faz ${s} dias desde a última conversa — mande algo leve pra manter o papo vivo 💬`,
    date: (s) => `O último encontro foi há ${s} dias... Hora de marcar o próximo 🌹`,
    likes: (l) => `Ela adora ${l} — prepare uma surpresinha 💡`,
    ok: () => "O relacionamento vai de vento em popa. Um simples oi hoje já basta ✨",
  },
};


// ---- date math (all on local YYYY-MM-DD strings) --------------------------

const DAY = 86_400_000;

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function midnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole days from `from` (YYYY-MM-DD) to `to` (Date); positive = past. */
export function daysBetween(from, to) {
  const f = parseYmd(from);
  if (!f) return null;
  return Math.round((midnight(to) - f.getTime()) / DAY);
}

/** Days until the next occurrence of `dateStr`'s month/day (0 = today). */
export function daysUntilAnnual(dateStr, today) {
  const d = parseYmd(dateStr);
  if (!d) return null;
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next.getTime() < midnight(today)) next.setFullYear(next.getFullYear() + 1);
  return Math.round((next.getTime() - midnight(today)) / DAY);
}

/** Days until the next 100-day milestone since `met` (100th, 200th, ...). */
export function nextHundredDay(met, today) {
  const together = daysBetween(met, today);
  if (together === null || together < 0) return null;
  const milestone = (Math.floor(together / 100) + 1) * 100;
  return { dday: milestone - together, milestone };
}

// ---- the agent: per-edge suggested actions --------------------------------
// urgency: 0 = act today, 1 = soon, 2 = ambient

export function suggestFor(rel, today, lang = "en") {
  const t = T[lang] ?? T.en;
  const out = [];
  if (rel.birthday) {
    const dday = daysUntilAnnual(rel.birthday, today);
    if (dday !== null && dday <= 7) {
      out.push({
        kind: "birthday",
        urgency: dday === 0 ? 0 : 1,
        text: dday === 0 ? t.birthdayToday(rel) : t.birthdaySoon(rel, dday),
      });
    }
  }
  if (rel.event && rel.eventDate) {
    const ed = parseYmd(rel.eventDate);
    const until = ed ? Math.round((ed.getTime() - midnight(today)) / DAY) : null;
    if (until !== null && until >= 0 && until <= 7) {
      out.push({ kind: "event", urgency: until <= 1 ? 0 : 1, text: t.event(rel, until) });
    }
  }
  // anniversaries only make sense once the relationship is actually a thing
  if (rel.met && rel.level >= 4) {
    const hundred = nextHundredDay(rel.met, today);
    if (hundred && hundred.dday <= 7) {
      out.push({ kind: "anniversary", urgency: 1, text: t.hundred(hundred.milestone, hundred.dday) });
    }
    // yearly anniversary of the day you met
    const yearly = daysUntilAnnual(rel.met, today);
    const years = Math.round((midnight(today) - (parseYmd(rel.met)?.getTime() ?? 0)) / DAY / 365);
    if (yearly !== null && yearly > 0 && yearly <= 14 && years >= 1) {
      out.push({ kind: "anniversary", urgency: 1, text: t.yearly(years, yearly) });
    }
  }
  // how long a text-silence is "too long" depends on the stage: a couple
  // notices 2 days, a talking stage 3, a crush/acquaintance only after ~6
  if (rel.lastContact) {
    const since = daysBetween(rel.lastContact, today);
    const threshold = rel.level >= 5 ? 2 : rel.level >= 3 ? 3 : 6;
    if (since !== null && since >= threshold) {
      const wording = rel.level <= 2 ? t.contactLow ?? t.contact : t.contact;
      out.push({ kind: "contact", urgency: since >= threshold + 2 ? 0 : 1, text: wording(since) });
    }
  }
  // "schedule a date" nudges only once you're actually dating
  if (rel.lastDate && rel.level >= 3) {
    const since = daysBetween(rel.lastDate, today);
    if (since !== null && since >= 14) {
      out.push({ kind: "date", urgency: 1, text: t.date(since) });
    }
  }
  if (out.length === 0 && Array.isArray(rel.likes) && rel.likes.length) {
    out.push({ kind: "ok", urgency: 2, text: t.likes(rel.likes[0]) });
  }
  if (out.length === 0) {
    out.push({ kind: "ok", urgency: 2, text: t.ok() });
  }
  return out.sort((a, b) => a.urgency - b.urgency);
}

/** Dashboard notification feed: every non-ambient suggestion across edges. */
export function buildAlerts(rels, today, lang = "en") {
  const alerts = [];
  for (const rel of rels) {
    for (const s of suggestFor(rel, today, lang)) {
      if (s.kind === "ok") continue;
      alerts.push({ ...s, id: `${rel.rowId}-${s.kind}`, rowId: rel.rowId, name: rel.name });
    }
  }
  return alerts.sort((a, b) => a.urgency - b.urgency);
}

// ---- mapping a parsed CSV grid → relationships -----------------------------

const PROP_MATCHERS = [
  ["name", /^name$/i],
  ["level", /^level$/i],
  ["met", /^met/i],
  ["birthday", /^birthday$/i],
  ["lastContact", /^last ?contact$/i],
  ["lastDate", /^last ?date$/i],
  ["phone", /^phone/i],
  ["event", /^(upcoming ?event|event)$/i],
  ["eventDate", /^event ?date$/i],
  ["notes", /^notes?$/i],
];

export function relationshipsFromGrid(grid) {
  if (!grid.length) return [];
  const headers = grid[0].map((h) => h.trim());
  const col = {};
  for (const [key, re] of PROP_MATCHERS) {
    const idx = headers.findIndex((h) => re.test(h));
    if (idx >= 0) col[key] = idx;
  }
  if (col.name === undefined) col.name = 0; // title column leads in OKF CSVs
  const get = (row, key) => (col[key] === undefined ? "" : String(row[col[key]] ?? "").trim());
  return grid
    .slice(1)
    .map((row, i) => ({
      rowId: `row${i}`,
      name: get(row, "name") || "Untitled",
      level: Number(get(row, "level")) || 0,
      met: get(row, "met") || undefined,
      birthday: get(row, "birthday") || undefined,
      lastContact: get(row, "lastContact") || undefined,
      lastDate: get(row, "lastDate") || undefined,
      phone: get(row, "phone") || undefined,
      event: get(row, "event") || undefined,
      eventDate: get(row, "eventDate") || undefined,
      notes: get(row, "notes") || undefined,
    }))
    .filter((r) => r.name !== "Untitled" || r.level > 0);
}

/** Full dashboard model for one edge. */
export function decorate(rel, today, lang = "en") {
  return {
    ...rel,
    levelInfo: levelInfo(rel.level),
    daysTogether: rel.met ? daysBetween(rel.met, today) : null,
    birthdayDday: rel.birthday ? daysUntilAnnual(rel.birthday, today) : null,
    daysSinceContact: rel.lastContact ? daysBetween(rel.lastContact, today) : null,
    daysSinceDate: rel.lastDate ? daysBetween(rel.lastDate, today) : null,
    nextMilestone: rel.met ? nextHundredDay(rel.met, today) : null,
    suggestions: suggestFor(rel, today, lang),
  };
}

// ---- demo seed: dates are RELATIVE to today so the demo always fires -------

export const RELATIONSHIPS_DB_RE = /relationship|girlfriend/i;

export function seedRelationshipsCsv(today) {
  const rel = (days, year) => {
    const d = new Date(midnight(today) + days * DAY);
    if (year !== undefined) d.setFullYear(year);
    return ymd(d);
  };
  const header = "Name,Level,Met,Birthday,Last Contact,Last Date,Phone,Upcoming Event,Event Date,Notes";
  const rows = [
    // Emma: deep integration, birthday in 4 days → birthday alert
    `Emma,6,${rel(-620)},${rel(4, 1998)},${rel(-1)},${rel(-5)},010-2384-1123,Jeju trip,${rel(14)},Already close with her family. Toothbrush at her place`,
    // Olivia: official couple, 200-day anniversary in 6 days → anniversary alert
    `Olivia,5,${rel(-194)},${rel(40, 1997)},${rel(-2)},${rel(-11)},010-9911-3020,Friend's wedding,${rel(9)},Asked her out on Christmas. Soft launched on IG`,
    // Mia: situationship, 3-day contact gap + 18-day date gap → contact + date alerts
    `Mia,4,${rel(-131)},${rel(100, 1999)},${rel(-3)},${rel(-18)},010-4471-8852,,,Not exclusive yet. Reading the room`,
    // Sophia: talking stage, her mom's birthday in 2 days → event alert
    `Sophia,3,${rel(-43)},${rel(150, 2000)},${rel(0)},${rel(-2)},010-7733-0912,Her mom's birthday,${rel(2)},Texting daily. Third date next week`,
    // Luna: crush, 4-day contact gap → contact alert
    `Luna,2,${rel(-22)},${rel(200, 2001)},${rel(-4)},,010-5210-6674,,,She replies to reels but still DM stage`,
  ];
  return [header, ...rows].join("\n") + "\n";
}
