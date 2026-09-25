// Seed the trading workspace as PURE data + view config — the dashboard is a
// configuration of general product features, not a bespoke screen.
import { api, databaseByTitle } from "./app-api.js";

const opt = (id, name, color) => ({ id, name, color });

async function ensureDb(title) {
  const existing = await databaseByTitle(title);
  if (existing) return existing;
  const snap = await api("POST", "/api/databases", { title, shape: "minimal" });
  return { ...snap, id: snap.database?.id ?? snap.id, props: Object.fromEntries(snap.properties.map((p) => [p.name, p])) };
}

async function ensureProp(db, name, type, config = {}) {
  if (db.props[name]) return db.props[name];
  const { property } = await api("POST", `/api/databases/${db.id}/properties`, { name, type, config });
  db.props[name] = property;
  return property;
}

async function main() {
  // ---- Swap Journal ---------------------------------------------------------
  const journal = await ensureDb("Swap Journal");
  await ensureProp(journal, "Date", "date");
  await ensureProp(journal, "Token", "select", { options: [
    opt("weth", "WETH", "blue"), opt("usdc", "USDC", "green"),
  ]});
  await ensureProp(journal, "Side", "select", { options: [opt("buy", "Buy", "green"), opt("sell", "Sell", "red")] });
  await ensureProp(journal, "Route", "select", { options: [opt("aqua-xyc", "Aqua · XYC", "blue"), opt("external", "External", "gray")] });
  await ensureProp(journal, "Amount", "number");
  await ensureProp(journal, "Fill price", "number");
  await ensureProp(journal, "Expected out", "number");
  await ensureProp(journal, "Executed out", "number");
  await ensureProp(journal, "Slippage %", "number");
  await ensureProp(journal, "Gas ETH", "number");
  await ensureProp(journal, "Tx", "url");
  await ensureProp(journal, "Day", "select", { options: [] });
  await ensureProp(journal, "Entry reason", "text");
  await ensureProp(journal, "Review", "select", { options: [
    opt("pending", "Pending", "yellow"), opt("done", "Done", "green"),
  ]});
  await ensureProp(journal, "PnL", "number");
  await ensureProp(journal, "Tag", "select", { options: [
    opt("liq500k", "Liquidity > $500K", "green"), opt("breakout", "Entry: Breakout", "blue"),
    opt("pullback", "Entry: Pullback", "purple"), opt("meme-lowliq", "Meme + low liquidity", "red"),
  ]});

  // dashboard view = counters w1×4 / bars w2×2 / table w4 — the final mock, as config
  const fresh = await api("GET", `/api/databases/${journal.id}`);
  const hasDash = fresh.views.some((v) => v.type === "dashboard");
  if (!hasDash) {
    const P = (n) => journal.props[n].id;
    await api("POST", `/api/databases/${journal.id}/views`, {
      type: "dashboard",
      name: "Dashboard",
      config: { widgets: [
        { id: "w-pnl", kind: "counter", width: 1, aggregate: "sum", aggregatePropertyId: P("PnL"), title: "Realized PnL" },
        { id: "w-fills", kind: "counter", width: 1, aggregate: "count", title: "Fills" },
        { id: "w-gas", kind: "counter", width: 1, aggregate: "sum", aggregatePropertyId: P("Gas ETH"), title: "Gas spent (ETH)" },
        { id: "w-vol", kind: "counter", width: 1, aggregate: "sum", aggregatePropertyId: P("Amount"), title: "Volume" },
        { id: "w-day", kind: "bar", width: 2, groupByPropertyId: P("Day"), aggregate: "sum", aggregatePropertyId: P("PnL"), title: "Daily PnL" },
        { id: "w-tag", kind: "bar", width: 2, groupByPropertyId: P("Tag"), aggregate: "sum", aggregatePropertyId: P("PnL"), title: "PnL by hypothesis tag" },
        { id: "w-side", kind: "donut", width: 1, groupByPropertyId: P("Side"), aggregate: "sum", aggregatePropertyId: P("Amount"), title: "Flow by side" },
        { id: "w-recent", kind: "table", width: 3, limit: 5, title: "Recent fills" },
      ]},
    });
  }

  // ---- Token DB -------------------------------------------------------------
  const tokens = await ensureDb("Token DB");
  await ensureProp(tokens, "Contract", "text");
  await ensureProp(tokens, "Chain", "select", { options: [opt("base", "Base", "blue")] });
  await ensureProp(tokens, "Price", "number");
  await ensureProp(tokens, "Liquidity", "number");
  await ensureProp(tokens, "Volume 24h", "number");
  await ensureProp(tokens, "Top10 %", "number");
  await ensureProp(tokens, "LP locked", "checkbox");
  await ensureProp(tokens, "Risk", "select", { options: [
    opt("low", "Low*", "green"), opt("mid", "Medium", "yellow"), opt("high", "High", "red"),
  ]});
  await ensureProp(tokens, "Status", "select", { options: [
    opt("watch", "Watching", "gray"), opt("entry", "Entry review", "blue"),
    opt("hold", "Holding", "green"), opt("banned", "Excluded", "red"),
  ]});
  const tokRows = await api("GET", `/api/databases/${tokens.id}`);
  if (tokRows.rows.length === 0) {
    const T = (n) => tokens.props[n].id;
    const titleId = tokens.properties.find((p) => p.type === "title").id;
    const seedTokens = [
      ["WETH", "0x4200000000000000000000000000000000000006", 2030, 8000000, 4900000, 18, true, "low", "hold"],
      ["USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 1, 12000000, 9100000, 12, true, "low", "hold"],
    ];
    for (const [sym, addr, price, liq, vol, top10, locked, risk, status] of seedTokens) {
      await api("POST", `/api/databases/${tokens.id}/rows`, { values: {
        [titleId]: sym, [T("Contract")]: addr, [T("Chain")]: "base", [T("Price")]: price,
        [T("Liquidity")]: liq, [T("Volume 24h")]: vol, [T("Top10 %")]: top10,
        [T("LP locked")]: locked, [T("Risk")]: risk, [T("Status")]: status,
      }});
    }
  }

  console.log(`seeded: Swap Journal ${journal.id} · Token DB ${tokens.id}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
