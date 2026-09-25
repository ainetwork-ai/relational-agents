// Relationship Agent SPA — vanilla JS, hash-routed over /api/dashboard.
// Views: #/dashboard (cards + alerts), #/rel/<rowId> (hero detail), #/messages.
// i18n: data comes localized from the API (?lang=), UI strings from UI[lang].

const STORED_LANG = localStorage.getItem("dash-lang");
const state = {
  data: null,
  lang: ["en", "pt"].includes(STORED_LANG) ? STORED_LANG : "en",
  tab: "dashboard", // "dashboard" | "detail" | "messages"
  detailRow: null,
  focusRow: null, // card highlighted after clicking an alert
  selectedConv: null,
  chats: new Map(), // rowId → [{from:"me"|"her", text}]
  draft: "",
};

const UI = {
  en: {
    nav: { dashboard: "Dashboard", messenger: "Messenger", app: "Workspace data", levels: "Relationship levels" },
    title: "Relationships",
    subtitle: "People are nodes, relationships are edges — live from your workspace.",
    stats: { rels: "Relationships", act: "Act today", bdays: "Birthdays ≤ 7d", anniv: "Anniversaries ≤ 7d" },
    notifications: "Notifications",
    nothing: "Nothing needs your attention 🎉",
    today: "TODAY",
    message: "💬 Message",
    call: "📞 Call",
    back: "← Back to dashboard",
    suggests: "✦ Agent suggests",
    about: "📌 About her",
    things: "🎞️ Things we did",
    memories: "📸 Date memories",
    openApp: "Open in app ↗",
    howWeMet: "How we met",
    likes: "Likes",
    dislikes: "Dislikes",
    upcoming: "Upcoming",
    pills: { together: "Together", met: "met", birthday: "Birthday", contact: "Last contact", date: "Last date" },
    track: ["Stranger", "Almost married"],
    conversations: "Conversations",
    profile: "Profile",
    sayHi: (n) => `Say hi to ${n} — the agent has a suggestion below 👇`,
    placeholder: (n) => `Message ${n}…`,
    use: "Use",
    send: "Send",
    pick: "Pick a conversation",
    ago: (d) => (d === 0 ? "today" : d === null ? "—" : `${d}d ago`),
    replies: [
      "Hey! I was just thinking about you 😊",
      "Aww, that's sweet of you 💕",
      "Haha okay okay, when are we meeting?",
      "You always know what to say 🥰",
    ],
  },
  pt: {
    nav: { dashboard: "Painel", messenger: "Mensagens", app: "Dados do workspace", levels: "Níveis de relacionamento" },
    title: "Relacionamentos",
    subtitle: "Pessoas são nós, relacionamentos são arestas — direto dos seus dados do workspace.",
    stats: { rels: "Relacionamentos", act: "Agir hoje", bdays: "Aniversários ≤ 7d", anniv: "Datas especiais ≤ 7d" },
    notifications: "Notificações",
    nothing: "Nada precisa da sua atenção 🎉",
    today: "HOJE",
    message: "💬 Mensagem",
    call: "📞 Ligar",
    back: "← Voltar ao painel",
    suggests: "✦ O agente sugere",
    about: "📌 Sobre ela",
    things: "🎞️ O que já fizemos",
    memories: "📸 Memórias de encontros",
    openApp: "Abrir no app ↗",
    howWeMet: "Como nos conhecemos",
    likes: "Gosta de",
    dislikes: "Não gosta de",
    upcoming: "Em breve",
    pills: { together: "Juntos", met: "desde", birthday: "Aniversário", contact: "Último contato", date: "Último encontro" },
    track: ["Desconhecidos", "Quase casados"],
    conversations: "Conversas",
    profile: "Perfil",
    sayHi: (n) => `Diga oi para ${n} — o agente tem uma sugestão logo abaixo 👇`,
    placeholder: (n) => `Mensagem para ${n}…`,
    use: "Usar",
    send: "Enviar",
    pick: "Escolha uma conversa",
    ago: (d) => (d === 0 ? "hoje" : d === null ? "—" : `há ${d}d`),
    replies: [
      "Oi! Eu estava justo pensando em você 😊",
      "Ahh, que fofo da sua parte 💕",
      "Haha tá bom, quando a gente se vê?",
      "Você sempre sabe o que dizer 🥰",
    ],
  },
};

const ui = () => UI[state.lang] ?? UI.en;

const view = document.getElementById("view");

// ---- utils -----------------------------------------------------------------

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const HEART_PATH =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";

function levelOf(level) {
  return state.data.levels[Math.min(Math.max(level, 0), 7)];
}
const levelLabel = (l) => l.label[state.lang] ?? l.label.en;
const levelDesc = (l) => l.desc[state.lang] ?? l.desc.en;

function heartSvg(level, size, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-label="Level ${level}">
    <path d="${HEART_PATH}" fill="${levelOf(level).heart}" stroke="rgba(136,19,55,.45)" stroke-width="1.4"/></svg>`;
}

/** Pastel tint of the level heart color, for photo-tile / hero backgrounds. */
function levelTint(level, pct = 26) {
  return `color-mix(in srgb, ${levelOf(level).heart} ${pct}%, var(--bg-side))`;
}

/** Small round avatar with a level-heart badge (messenger); heart fallback. */
function faceHtml(rel, size) {
  if (!rel.avatar) return heartSvg(rel.level, size);
  return `<span class="face" style="width:${size + 8}px;height:${size + 8}px">
    <img src="${esc(rel.avatar)}" alt="${esc(rel.name)}" />
    <span class="face-badge">${heartSvg(rel.level, Math.max(14, Math.round(size * 0.42)))}</span>
  </span>`;
}

// ---- routing -----------------------------------------------------------------

function navigate(where, arg) {
  if (where === "messages") location.hash = `#/messages${arg ? `?to=${arg}` : ""}`;
  else if (where === "detail") location.hash = `#/rel/${arg}`;
  else location.hash = "#/dashboard";
}

function applyHash() {
  const h = location.hash;
  const rel = h.match(/^#\/rel\/([^/?]+)/);
  if (rel) {
    state.tab = "detail";
    state.detailRow = rel[1];
  } else if (h.startsWith("#/messages")) {
    state.tab = "messages";
    const to = /[?&]to=([^&]+)/.exec(h)?.[1];
    if (to) state.selectedConv = to;
  } else {
    state.tab = "dashboard";
  }
  render();
}

// ---- dashboard view ----------------------------------------------------------

function alertHtml(a) {
  return `<button class="alert u${a.urgency}" data-alert="${esc(a.rowId)}">
    <span class="alert-head">
      <span class="who">${esc(a.name)}</span>
      ${a.urgency === 0 ? `<span class="badge">${ui().today}</span>` : ""}
    </span>
    <span class="what">${esc(a.text)}</span>
  </button>`;
}

function cardHtml(r) {
  const photo = r.cutout
    ? `<img class="cut" src="${esc(r.cutout)}" alt="${esc(r.name)}" />`
    : r.avatar
      ? `<img class="full" src="${esc(r.avatar)}" alt="${esc(r.name)}" />`
      : `<span class="heart-fallback">${heartSvg(r.level, 56)}</span>`;
  const chip = r.daysSinceContact !== null ? `<span class="chip">${ui().ago(r.daysSinceContact)}</span>` : "";
  const top = r.suggestions[0];
  const call = r.phone
    ? `<a class="act secondary" data-stop href="tel:${esc(r.phone)}">${ui().call}</a>`
    : `<span class="act secondary" aria-disabled="true">${ui().call}</span>`;

  return `<article class="card ${state.focusRow === r.rowId ? "focused" : ""}" id="card-${esc(r.rowId)}" data-open="${esc(r.rowId)}">
    <div class="card-photo" style="background:${levelTint(r.level)}">
      ${chip}
      <span class="lvl-heart">${heartSvg(r.level, 22)}</span>
      ${photo}
    </div>
    <div class="card-body">
      <div class="name">${esc(r.name)}${r.daysTogether !== null && r.daysTogether >= 0 ? ` <span style="color:var(--text-3);font-weight:600;font-size:12px">· D+${r.daysTogether}</span>` : ""}</div>
      <span class="level-chip">Lv.${r.level} · ${esc(levelLabel(r.levelInfo))}</span>
      ${top ? `<p class="card-note">${esc(top.text)}</p>` : ""}
      <div class="card-acts">
        <button class="act primary" data-stop data-msg="${esc(r.rowId)}">${ui().message}</button>
        ${call}
      </div>
    </div>
  </article>`;
}

function renderDashboard() {
  const d = state.data;
  const t = ui();
  const urgent = d.alerts.filter((a) => a.urgency === 0).length;
  const bdays = d.relationships.filter((r) => r.birthdayDday !== null && r.birthdayDday <= 7).length;
  const anniv = d.relationships.filter((r) => r.nextMilestone && r.nextMilestone.dday <= 7).length;

  view.innerHTML = `<div class="dash">
    <div class="dash-main">
      <h1 class="page-title">${t.title}</h1>
      <p class="page-sub">${t.subtitle}</p>
      <div class="stats">
        <div class="stat a"><div class="sv">${d.relationships.length}</div><div class="sk">${t.stats.rels}</div></div>
        <div class="stat c"><div class="sv">${urgent}</div><div class="sk">${t.stats.act}</div></div>
        <div class="stat b"><div class="sv">${bdays}</div><div class="sk">${t.stats.bdays}</div></div>
        <div class="stat d"><div class="sv">${anniv}</div><div class="sk">${t.stats.anniv}</div></div>
      </div>
      <div class="cards">${d.relationships.map(cardHtml).join("")}</div>
    </div>
    <aside class="dash-side">
      <h2 class="section-title">🔔 ${t.notifications} (${d.alerts.length})</h2>
      <div class="alerts">${d.alerts.length ? d.alerts.map(alertHtml).join("") : `<p class="alerts-empty">${t.nothing}</p>`}</div>
    </aside>
  </div>`;

  view.querySelectorAll("[data-alert]").forEach((el) =>
    el.addEventListener("click", () => {
      state.focusRow = el.dataset.alert;
      render();
      document.getElementById(`card-${state.focusRow}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    })
  );
  view.querySelectorAll("[data-msg]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      navigate("messages", el.dataset.msg);
    })
  );
  view.querySelectorAll("[data-stop]").forEach((el) => el.addEventListener("click", (e) => e.stopPropagation()));
  view.querySelectorAll("[data-open]").forEach((el) =>
    el.addEventListener("click", () => navigate("detail", el.dataset.open))
  );
}

// ---- detail view (hero + cutout, reference style) ------------------------------

function renderDetail() {
  const d = state.data;
  const t = ui();
  const r = d.relationships.find((x) => x.rowId === state.detailRow);
  if (!r) {
    navigate("dashboard");
    return;
  }
  const cut = r.cutout || r.avatar;
  const segs = d.levels
    .map((l) => `<div class="seg ${l.level <= r.level ? "on" : ""}" title="Lv.${l.level} ${esc(levelLabel(l))}"></div>`)
    .join("");
  const call = r.phone ? `<a class="act secondary" href="tel:${esc(r.phone)}">${t.call} ${esc(r.phone)}</a>` : "";

  view.innerHTML = `<div class="detail">
    <button class="back" id="back">${t.back}</button>
    <section class="hero" style="background:linear-gradient(135deg, ${levelTint(r.level, 38)}, ${levelTint(r.level, 16)})">
      <div class="hero-kicker">Lv.${r.level} · ${esc(levelLabel(r.levelInfo))}</div>
      <h1>${esc(r.name)}</h1>
      <div class="hero-sub">${esc(levelDesc(r.levelInfo))}${r.met ? ` — ${esc(t.pills.met)} ${esc(r.met)}` : ""}</div>
      <div class="level-track" style="max-width:340px">${segs}</div>
      <div class="level-cap" style="max-width:340px"><span>${t.track[0]}</span><span>${t.track[1]}</span></div>
      ${cut ? `<img class="hero-cut" src="${esc(cut)}" alt="${esc(r.name)}" />` : `<span class="lvl-heart-big">${heartSvg(r.level, 64)}</span>`}
    </section>
    <div class="pills">
      <div class="pill a"><div class="pv">${r.daysTogether !== null && r.daysTogether >= 0 ? `D+${r.daysTogether}` : "—"}</div><div class="pk">${t.pills.together}${r.met ? ` · ${esc(r.met)}` : ""}</div></div>
      <div class="pill c"><div class="pv">${r.birthdayDday !== null ? `D-${r.birthdayDday}` : "—"}</div><div class="pk">${t.pills.birthday}${r.birthday ? ` · ${esc(r.birthday.slice(5))}` : ""}</div></div>
      <div class="pill b"><div class="pv">${t.ago(r.daysSinceContact)}</div><div class="pk">${t.pills.contact}</div></div>
      <div class="pill d"><div class="pv">${t.ago(r.daysSinceDate)}</div><div class="pk">${t.pills.date}</div></div>
    </div>
    <section class="detail-sec">
      <h2 class="section-title">${t.suggests}</h2>
      <ul>${r.suggestions.map((s) => `<li><span class="si">${s.urgency === 0 ? "🔥" : s.urgency === 1 ? "⏳" : "🌿"}</span>${esc(s.text)}</li>`).join("")}</ul>
    </section>
    ${
      r.event || r.notes || r.metAt || r.likes?.length || r.dislikes?.length
        ? `<section class="detail-sec">
            <h2 class="section-title">${t.about}</h2>
            <p class="detail-note">
              ${r.notes ? `${esc(r.notes)}<br/>` : ""}
              ${r.metAt ? `<b>${t.howWeMet}:</b> ${esc(r.metAt)}<br/>` : ""}
              ${r.likes?.length ? `<b>${t.likes}:</b> ${esc(r.likes.join(", "))}<br/>` : ""}
              ${r.dislikes?.length ? `<b>${t.dislikes}:</b> ${esc(r.dislikes.join(", "))}<br/>` : ""}
              ${r.event ? `<b>${t.upcoming}:</b> ${esc(r.event)}${r.eventDate ? ` (${esc(r.eventDate)})` : ""}` : ""}
            </p>
          </section>`
        : ""
    }
    ${
      r.dates?.length
        ? `<section class="detail-sec">
            <h2 class="section-title">${t.memories}</h2>
            ${r.dates
              .map(
                (c) => `<div class="course">
                  <div class="course-head">
                    <span class="course-title">${esc(c.title)}</span>
                    <span class="course-meta">${esc(c.date)} · ${esc(c.timeRange)}</span>
                  </div>
                  <div class="strip">
                    ${c.photos
                      .map(
                        (p) => `<figure class="shot">
                          <img src="${esc(p.url)}" alt="${esc(p.caption)}" title="${esc(p.time)} — ${esc(p.caption)}" loading="lazy" />
                          <figcaption>${esc(p.caption)}</figcaption>
                        </figure>`
                      )
                      .join("")}
                  </div>
                </div>`
              )
              .join("")}
          </section>`
        : ""
    }
    ${
      r.activities?.length
        ? `<section class="detail-sec">
            <h2 class="section-title">${t.things}</h2>
            <ul>${r.activities.map((a) => `<li><span class="si">•</span>${esc(a)}</li>`).join("")}</ul>
          </section>`
        : ""
    }
    <div class="detail-acts">
      <button class="act primary" id="d-msg">${t.message}</button>
      ${call}
      <a class="act secondary" href="${esc(r.appUrl)}" target="_blank" rel="noopener">${t.openApp}</a>
    </div>
  </div>`;

  document.getElementById("back").addEventListener("click", () => navigate("dashboard"));
  document.getElementById("d-msg").addEventListener("click", () => navigate("messages", r.rowId));
}

// ---- messenger view -----------------------------------------------------------

/** Full conversation = the document's chat log + anything typed locally. */
function chatFor(r) {
  return [...(r.conversation ?? []), ...(state.chats.get(r.rowId) ?? [])];
}

function convHtml(r) {
  const last = chatFor(r).at(-1)?.text;
  return `<button class="conv ${state.selectedConv === r.rowId ? "active" : ""}" data-conv="${esc(r.rowId)}">
    ${faceHtml(r, 30)}
    <span class="cmeta">
      <span class="cname">${esc(r.name)}</span>
      <span class="cprev">${esc(last ?? levelLabel(r.levelInfo))}</span>
    </span>
  </button>`;
}

function renderMessenger() {
  const d = state.data;
  const t = ui();
  if (!state.selectedConv || !d.relationships.some((r) => r.rowId === state.selectedConv)) {
    state.selectedConv = d.relationships[0]?.rowId ?? null;
  }
  const cur = d.relationships.find((r) => r.rowId === state.selectedConv) ?? null;
  const msgs = cur ? chatFor(cur) : [];
  const suggestion = cur?.suggestions[0];

  const log = msgs.length
    ? msgs.map((m) => `<div class="bubble ${m.from}">${esc(m.text)}</div>`).join("")
    : `<div class="chat-empty">${t.sayHi(esc(cur?.name ?? ""))}</div>`;

  view.innerHTML = `<div class="msgr">
    <aside class="convs">
      <h2 class="section-title">${t.conversations}</h2>
      ${d.relationships.map(convHtml).join("")}
    </aside>
    <section class="chat">
      ${
        cur
          ? `<header class="chat-head">
              ${faceHtml(cur, 28)}
              <div><div class="cname">${esc(cur.name)}</div>
              <div class="clevel">Lv.${cur.level} · ${esc(levelLabel(cur.levelInfo))}</div></div>
              <div class="spacer"></div>
              <button class="hbtn" data-profile="${esc(cur.rowId)}">${t.profile}</button>
              ${cur.phone ? `<a class="hbtn" href="tel:${esc(cur.phone)}">${t.call}</a>` : ""}
            </header>
            <div class="chat-log" id="chat-log">${log}</div>
            ${
              suggestion
                ? `<div class="suggest-bar">✦ <span class="sx">${esc(suggestion.text)}</span>
                    <button id="use-suggest">${t.use}</button></div>`
                : ""
            }
            <footer class="chat-input">
              <input id="chat-draft" placeholder="${t.placeholder(esc(cur.name))}" value="${esc(state.draft)}" autocomplete="off" />
              <button class="send" id="chat-send" ${state.draft.trim() ? "" : "disabled"}>${t.send}</button>
            </footer>`
          : `<div class="chat-empty">${t.pick}</div>`
      }
    </section>
  </div>`;

  view.querySelectorAll("[data-conv]").forEach((el) =>
    el.addEventListener("click", () => {
      state.selectedConv = el.dataset.conv;
      state.draft = "";
      navigate("messages", state.selectedConv);
    })
  );
  view.querySelector("[data-profile]")?.addEventListener("click", (e) => navigate("detail", e.currentTarget.dataset.profile));

  const logEl = document.getElementById("chat-log");
  if (logEl) logEl.scrollTop = logEl.scrollHeight;

  const input = document.getElementById("chat-draft");
  const sendBtn = document.getElementById("chat-send");
  if (input && sendBtn && cur) {
    input.addEventListener("input", () => {
      state.draft = input.value;
      sendBtn.disabled = !state.draft.trim();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) send(cur.rowId);
    });
    sendBtn.addEventListener("click", () => send(cur.rowId));
    input.focus();
  }
  document.getElementById("use-suggest")?.addEventListener("click", () => {
    state.draft = suggestion.text;
    render();
  });
}

function send(rowId) {
  const text = state.draft.trim();
  if (!text) return;
  const replies = ui().replies;
  const chat = state.chats.get(rowId) ?? [];
  chat.push({ from: "me", text });
  state.chats.set(rowId, chat);
  state.draft = "";
  render();
  // the real messenger backend lands later — a canned reply keeps the demo alive
  setTimeout(() => {
    chat.push({ from: "her", text: replies[text.length % replies.length] });
    render();
  }, 700);
}

// ---- shell ---------------------------------------------------------------------

function renderShell() {
  const t = ui();
  document.querySelector("#nav-dashboard .nl").textContent = t.nav.dashboard;
  document.querySelector("#nav-messages .nl").textContent = t.nav.messenger;
  document.querySelector("#open-app .nl").textContent = t.nav.data;
  document.querySelector(".nav-caption").textContent = t.nav.levels;
  document.querySelectorAll(".lang-switch button").forEach((b) => b.classList.toggle("active", b.dataset.lang === state.lang));
  const legend = document.getElementById("side-legend");
  legend.innerHTML = state.data.levels
    .map((l) => `<div class="legend-item">${heartSvg(l.level, 15)}<span><b>Lv.${l.level}</b> ${esc(levelLabel(l))}</span></div>`)
    .join("");
}

function render() {
  if (!state.data) return;
  const navTab = state.tab === "messages" ? "messages" : "dashboard";
  document.getElementById("nav-dashboard").classList.toggle("active", navTab === "dashboard");
  document.getElementById("nav-messages").classList.toggle("active", navTab === "messages");
  document.getElementById("open-app").href = state.data.dbAppUrl;
  renderShell();
  if (state.tab === "messages") renderMessenger();
  else if (state.tab === "detail") renderDetail();
  else renderDashboard();
}

async function load() {
  try {
    const res = await fetch(`/api/dashboard?lang=${state.lang}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    render();
  } catch (err) {
    view.innerHTML = `<div class="loading">Couldn't load data — is the OKF store reachable? (${esc(err.message)})</div>`;
  }
}

function setLang(lang) {
  state.lang = lang;
  localStorage.setItem("dash-lang", lang);
  void load();
}

document.querySelectorAll(".nav-item[data-tab]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.tab)));
document.querySelectorAll(".lang-switch button").forEach((el) => el.addEventListener("click", () => setLang(el.dataset.lang)));
window.addEventListener("hashchange", applyHash);
window.addEventListener("focus", load);
setInterval(load, 30_000);

await load();
applyHash();
