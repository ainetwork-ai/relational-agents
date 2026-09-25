// The review agent: reads the Swap Journal + the aindrive trade records,
// computes what actually happened (FIFO round-trips, slippage, gas), writes
// realized PnL back into the journal (the dashboard lights up), and asks the
// workspace model for a narrative "which trades were good and why".
// Pure API consumer — the same surface the notion-mcp server exposes.
//
//   node --experimental-strip-types? no: plain JS, run with `npm run review`
//   env: APP_URL, AINDRIVE_DIR, AI_URL / AI_MODEL (optional narrative)

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { api, databaseByTitle } from "./app-api.js";

const RECORDS_DIR = process.env.AINDRIVE_DIR ?? join(process.env.HOME, "aindrive-web3-trading", "03_trade-records");
const REVIEWS_DIR = process.env.REVIEWS_DIR ?? join(dirname(RECORDS_DIR), "04_reviews");
const AI_URL = process.env.AI_URL ?? "http://localhost:8100/v1";
const AI_MODEL = process.env.AI_MODEL ?? "gemma-4-31B-it";

// ---- 1. pull the journal ----------------------------------------------------
const db = await databaseByTitle("Swap Journal");
const P = (n) => db.props[n]?.id;
const titleId = db.properties.find((p) => p.type === "title").id;
const V = (r, n) => r.values[P(n)];

const fills = db.rows
  .map((r) => ({
    id: r.id,
    title: r.values[titleId],
    date: V(r, "Date"),
    side: V(r, "Side"),
    amountUsd: Number(V(r, "Amount")) || 0,
    price: Number(V(r, "Fill price")) || 0,
    executedOut: Number(V(r, "Executed out")) || 0,
    slippagePct: V(r, "Slippage %") == null ? null : Number(V(r, "Slippage %")),
    gasEth: Number(V(r, "Gas ETH")) || 0,
    tag: V(r, "Tag") ?? null,
    day: V(r, "Day") ?? null,
    tx: String(V(r, "Tx") ?? ""),
  }))
  .filter((f) => (f.side === "buy" || f.side === "sell") && f.price > 0)
  .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

if (fills.length === 0) {
  console.log("journal is empty — nothing to review");
  process.exit(0);
}

// ---- 2. FIFO round-trips: every sell realizes PnL against the oldest lots ---
const lots = []; // open buys: { qty, costUsd } — qty in token units
const closed = []; // sells with realized pnl
for (const f of fills) {
  if (f.side === "buy") {
    lots.push({ qty: f.executedOut, costUsd: f.amountUsd, fill: f });
    continue;
  }
  // sell: proceeds in USD, qty sold = proceeds / price
  let qty = f.price ? f.amountUsd / f.price : 0;
  let cost = 0;
  while (qty > 1e-12 && lots.length) {
    const lot = lots[0];
    const take = Math.min(qty, lot.qty);
    cost += (take / lot.qty) * lot.costUsd;
    lot.costUsd -= (take / lot.qty) * lot.costUsd;
    lot.qty -= take;
    qty -= take;
    if (lot.qty <= 1e-12) lots.shift();
  }
  const pnl = Number((f.amountUsd - cost).toFixed(2));
  closed.push({ ...f, pnl, cost: Number(cost.toFixed(2)) });
}
const openCost = lots.reduce((a, l) => a + l.costUsd, 0);
const openQty = lots.reduce((a, l) => a + l.qty, 0);

// ---- 3. write the verdicts back: PnL on closing fills, Review=done ----------
for (const c of closed) {
  await api("PATCH", `/api/databases/${db.id}/rows/${c.id}`, {
    values: { [P("PnL")]: c.pnl, [P("Review")]: "done" },
  });
}
for (const f of fills.filter((x) => x.side === "buy")) {
  await api("PATCH", `/api/databases/${db.id}/rows/${f.id}`, {
    values: { [P("Review")]: "done" },
  });
}

// ---- 4. the numbers ----------------------------------------------------------
const realized = Number(closed.reduce((a, c) => a + c.pnl, 0).toFixed(2));
const wins = closed.filter((c) => c.pnl > 0).length;
const gas = Number(fills.reduce((a, f) => a + f.gasEth, 0).toFixed(6));
const volume = Number(fills.reduce((a, f) => a + f.amountUsd, 0).toFixed(2));
const slips = fills.filter((f) => f.slippagePct != null).map((f) => f.slippagePct);
const avgSlip = slips.length ? Number((slips.reduce((a, s) => a + s, 0) / slips.length).toFixed(4)) : null;
const best = closed.length ? closed.reduce((a, c) => (c.pnl > a.pnl ? c : a)) : null;
const worstCand = closed.length ? closed.reduce((a, c) => (c.pnl < a.pnl ? c : a)) : null;
const worst = worstCand && worstCand !== best ? worstCand : null;
const byTag = new Map();
for (const c of closed) byTag.set(c.tag ?? "untagged", Number(((byTag.get(c.tag ?? "untagged") ?? 0) + c.pnl).toFixed(2)));

// entry reasons from the aindrive records (frontmatter tx → quote line)
const reasons = [];
if (existsSync(RECORDS_DIR)) {
  for (const f of readdirSync(RECORDS_DIR).filter((n) => n.endsWith(".md"))) {
    const md = readFileSync(join(RECORDS_DIR, f), "utf8");
    const reason = md.match(/^> Entry reason: (.+)$/m)?.[1]?.trim();
    if (reason && !reason.startsWith("_write it now")) reasons.push({ tx: f.replace(/\.md$/, ""), reason });
  }
}

const stats = { fills: fills.length, closed: closed.length, realized, wins, volume, gas, avgSlip, openQty: Number(openQty.toFixed(6)), openCost: Number(openCost.toFixed(2)) };

// ---- 5. the narrative (optional — the workspace model may be offline) --------
let narrative = null;
try {
  const facts = [
    `Fills: ${stats.fills} (${closed.length} closing). Realized PnL: $${realized}. Wins ${wins}/${closed.length}.`,
    `Volume $${volume}, gas ${gas} ETH, avg slippage ${avgSlip ?? "n/a"}%.`,
    `Open position: ${stats.openQty} token @ cost $${stats.openCost}.`,
    best ? `Best close: ${best.title} → $${best.pnl}.` : "",
    worst ? `Worst close: ${worst.title} → $${worst.pnl}.` : "",
    [...byTag].map(([t, v]) => `tag ${t}: $${v}`).join(", "),
    reasons.length ? `Entry reasons on record: ${reasons.map((r) => `"${r.reason}"`).join("; ")}` : "No entry reasons were written down.",
  ].filter(Boolean).join("\n");
  const res = await fetch(`${AI_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        { role: "system", content: "You are a trading-journal review coach. Given the computed facts of a session, say plainly which trades were good, which were bad, and one habit to change. No hedging, no financial advice disclaimer, ≤160 words, markdown bullets." },
        { role: "user", content: facts },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.ok) narrative = (await res.json()).choices?.[0]?.message?.content?.trim() ?? null;
} catch {
  /* stats-only review below */
}

// ---- 6. the review document: aindrive markdown + a workspace page ------------
const today = new Date().toISOString().slice(0, 10);
const md = `---
type: TradeReview
date: ${today}
fills: ${stats.fills}
realizedPnl: ${realized}
---
# Trade review — ${today}

- Realized PnL: **$${realized}** across ${closed.length} closing fills (${wins} wins)
- Volume $${volume} · gas ${gas} ETH · avg slippage ${avgSlip ?? "n/a"}%
- Open: ${stats.openQty} token at $${stats.openCost} cost basis
${best ? `- Best: ${best.title} → $${best.pnl}` : ""}
${worst ? `- Worst: ${worst.title} → $${worst.pnl}` : ""}
- PnL by tag: ${[...byTag].map(([t, v]) => `${t} $${v}`).join(" · ") || "n/a"}

## Coach's read

${narrative ?? "_narrative model offline — numbers only this time._"}

## Entry reasons on file

${reasons.length ? reasons.map((r) => `- ${r.reason} (\`${r.tx.slice(0, 12)}…\`)`).join("\n") : "- none written — that IS the finding."}
`;
mkdirSync(REVIEWS_DIR, { recursive: true });
const mdPath = join(REVIEWS_DIR, `review-${today}.md`);
writeFileSync(mdPath, md);

// the same review as a page in the workspace, next to the journal
const { page } = await api("POST", "/api/pages", { title: `Trade review — ${today}`, icon: "🧾" });
const pageId = page?.id;
if (pageId) {
  const blocks = [
    ["heading2", "Session numbers"],
    ["bulleted_list", `Realized PnL $${realized} across ${closed.length} closing fills (${wins} wins)`],
    ["bulleted_list", `Volume $${volume} · gas ${gas} ETH · avg slippage ${avgSlip ?? "n/a"}%`],
    ["bulleted_list", `Open position ${stats.openQty} @ $${stats.openCost} cost`],
    ...(best ? [["bulleted_list", `Best close: ${best.title} → $${best.pnl}`]] : []),
    ...(worst ? [["bulleted_list", `Worst close: ${worst.title} → $${worst.pnl}`]] : []),
    ["heading2", "Coach's read"],
    ...(narrative ?? "Narrative model offline — numbers only this time.")
      .split(/\n+/).filter(Boolean).map((line) => ["paragraph", line.replace(/^[-*]\s*/, "• ")]),
    ["heading2", "Entry reasons on file"],
    ...(reasons.length
      ? reasons.map((r) => ["bulleted_list", `${r.reason} (${r.tx.slice(0, 12)}…)`])
      : [["callout", "No entry reasons were written down — that IS the finding."]]),
  ];
  for (const [type, text] of blocks)
    await api("POST", `/api/pages/${pageId}/blocks`, { type, content: { text } });
}

console.log(`reviewed ${fills.length} fills → realized $${realized} (${wins}/${closed.length} wins)`);
console.log(`journal updated: ${closed.length} PnL values, Review=done on all fills`);
console.log(`review md: ${mdPath}`);
if (pageId) console.log(`review page: /p/${pageId}`);
if (!narrative) console.log("(narrative model offline — stats-only review)");
