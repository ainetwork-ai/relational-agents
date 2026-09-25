// Seed the family's side of the capsule: the sealed letter page and the
// Vault Ledger database with its dashboard — pure data + view config on
// general workspace features (chart/counter/donut/table widgets).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { api, databaseByTitle } from "./app-api.js";

const WS_STATE = new URL("../.state/workspace.json", import.meta.url).pathname;
const DRIVE_DIR = process.env.FAMILY_DRIVE ?? join(process.env.HOME, "aindrive-family-vault");

const opt = (id, name, color) => ({ id, name, color });

async function ensureDb(title) {
  const existing = await databaseByTitle(title);
  if (existing) return existing;
  const snap = await api("POST", "/api/databases", { title, shape: "minimal" });
  const db = { ...snap, id: snap.database?.id ?? snap.id, props: Object.fromEntries(snap.properties.map((p) => [p.name, p])) };
  const titleProp = snap.properties.find((p) => p.type === "title");
  if (titleProp && titleProp.name !== "Name") {
    await api("PATCH", `/api/databases/${db.id}/properties/${titleProp.id}`, { name: "Name" });
    delete db.props[titleProp.name];
    db.props["Name"] = { ...titleProp, name: "Name" };
  }
  return db;
}

async function ensureProp(db, name, type, config = {}) {
  if (db.props[name]) return db.props[name];
  const { property } = await api("POST", `/api/databases/${db.id}/properties`, { name, type, config });
  db.props[name] = property;
  return property;
}

// ---- Vault Ledger DB ---------------------------------------------------------
const ledger = await ensureDb("Vault Ledger");
await ensureProp(ledger, "Date", "date");
await ensureProp(ledger, "Event", "select", { options: [
  opt("deposit", "Deposit", "blue"), opt("fill", "Fill", "green"),
  opt("policy", "Policy", "purple"), opt("exit-request", "Exit requested", "red"),
  opt("exit-cancel", "Exit cancelled", "yellow"), opt("opened", "Capsule opened", "pink"),
]});
await ensureProp(ledger, "Token", "select", { options: [opt("usdc", "USDC", "green"), opt("weth", "WETH", "blue")] });
await ensureProp(ledger, "Amount", "number");
await ensureProp(ledger, "Vault value $", "number");
await ensureProp(ledger, "Spread $", "number");
await ensureProp(ledger, "Taker", "text");
await ensureProp(ledger, "Memo", "text");
await ensureProp(ledger, "Tx", "url");

const fresh = await api("GET", `/api/databases/${ledger.id}`);
if (!fresh.views.some((v) => v.type === "dashboard")) {
  const P = (n) => ledger.props[n].id;
  await api("POST", `/api/databases/${ledger.id}/views`, {
    type: "dashboard",
    name: "Dashboard",
    config: { widgets: [
      { id: "w-spread", kind: "counter", width: 1, aggregate: "sum", aggregatePropertyId: P("Spread $"), title: "Spread earned", prefix: "$", decimals: 2, colorBySign: true },
      { id: "w-events", kind: "counter", width: 1, aggregate: "count", title: "On-chain events" },
      { id: "w-mix", kind: "donut", width: 2, groupByPropertyId: P("Event"), aggregate: "count", title: "Life of the capsule" },
      { id: "w-value", kind: "chart", width: 4, chartType: "line", xPropertyId: P("Date"), yPropertyId: P("Vault value $"), markerPropertyId: P("Event"), title: "Vault value · 18 years" },
      { id: "w-ledger", kind: "table", width: 4, limit: 10, title: "Ledger" },
    ]},
  });
  const withDash = await api("GET", `/api/databases/${ledger.id}`);
  const dash = withDash.views.find((v) => v.type === "dashboard");
  const minPos = Math.min(...withDash.views.map((v) => v.position ?? 0));
  if (dash && (dash.position ?? 0) > minPos)
    await api("PATCH", `/api/databases/${ledger.id}/views/${dash.id}`, { position: minPos - 1 });
}

// ---- the sealed letter page ---------------------------------------------------
const state = existsSync(WS_STATE) ? JSON.parse(readFileSync(WS_STATE, "utf8")) : {};
if (!state.capsulePageId) {
  const { page } = await api("POST", "/api/pages", { title: "Yuna's Time Capsule — opens at 18", icon: "🔒" });
  state.capsulePageId = page.id;
  const blocks = [
    ["callout", "Sealed on the 100th day. This page opens by itself when the vault matures on-chain — CapsuleOpened is the key."],
    ["quote", "Some things are written now and read in eighteen years."],
    ["paragraph", "Inside: $1,000 (USDC + WETH), market-making on 1inch Aqua from the family's own vault contract. The letter below stays hidden until the capsule opens."],
  ];
  for (const [type, text] of blocks)
    await api("POST", `/api/pages/${page.id}/blocks`, { type, content: { text } });
}

// the letter itself lives in the family drive until opening day
mkdirSync(join(DRIVE_DIR, "01_letters"), { recursive: true });
const letterPath = join(DRIVE_DIR, "01_letters", "letter-to-yuna.md");
if (!existsSync(letterPath)) {
  writeFileSync(letterPath, `---
type: TimeCapsuleLetter
sealed: ${new Date().toISOString().slice(0, 10)}
opens: +18y (on-chain)
---
# To Yuna, at eighteen

Today you are one hundred days old. You fell asleep twice during the
photo and cried through the third take — we kept that one.

We put a little money where nobody can touch it, not even us: it works
for you on its own, and it knows your address. When it opens, so does
this letter.

Whatever it has grown into, the compounding we actually counted on was
you.

— Mom & Dad
`);
}

mkdirSync(join(DRIVE_DIR, "02_vault-records"), { recursive: true });
writeFileSync(WS_STATE, JSON.stringify({ ...state, ledgerDbId: ledger.id, driveDir: DRIVE_DIR }, null, 2));
console.log(`seeded: Vault Ledger ${ledger.id} · capsule page ${state.capsulePageId}`);
console.log(`letter sealed at ${letterPath}`);
