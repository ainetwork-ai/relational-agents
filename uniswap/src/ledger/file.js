import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BIG = new Set(["perRunCap", "perPeriodCap", "amountIn", "amountOut"]);
const toDisk = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
const fromDisk = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, BIG.has(k) && typeof v === "string" ? BigInt(v) : v]));

// What each kind must carry for `view()` to be able to see it. A buy missing any of these is worse
// than a rejected buy: `view()` matches on the exact string "buy" and keys by `periodKey`, so
// `kind: "Buy"` or an absent `periodKey` files real money where no cap check will ever find it —
// the mandate then keeps approving buys it should refuse.
const REQUIRED = {
  deposit: {},
  buy: { mandateId: "string", periodKey: "string", amountIn: "bigint", amountOut: "bigint" },
  skip: { mandateId: "string", periodKey: "string", reason: "string" },
};

function checkEntry(entry) {
  if (!Object.hasOwn(REQUIRED, entry.kind)) throw new TypeError(`record: unknown entry kind "${entry.kind}"`);
  for (const [field, type] of Object.entries(REQUIRED[entry.kind]))
    if (typeof entry[field] !== type)
      throw new TypeError(`record: a ${entry.kind} entry requires ${field} (${type}), got ${typeof entry[field]}`);
}

/**
 * The passbook as one JSON file — enough to run the executor with no app at all.
 * The workspace ledger (slice 2) implements the same four calls against the app.
 */
export function fileLedger(path) {
  const load = () => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { mandates: [], entries: [] });
  const save = (db) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(db, null, 2)); };

  return {
    path,
    async mandates() { return load().mandates.map(fromDisk); },
    async addMandate(m) {
      const db = load();
      if (db.mandates.some((x) => x.id === m.id)) throw new Error(`mandate ${m.id} already exists`);
      db.mandates.push(toDisk(m)); save(db);
    },
    async revoke(id, atSec) {
      const db = load();
      const m = db.mandates.find((x) => x.id === id);
      if (!m) throw new Error(`no mandate ${id}`);
      m.revokedAt ??= atSec;   // the first revocation is the one that counts; a later call must not move it
      save(db);
    },
    async record(entry) { checkEntry(entry); const db = load(); db.entries.push(toDisk(entry)); save(db); },
    async view() {
      const db = load();
      const spentByPeriod = {}, boughtPeriods = {};
      const occupy = (mandateId, key) => {
        const list = (boughtPeriods[mandateId] ??= []);
        if (!list.includes(key)) list.push(key);
      };
      for (const e of db.entries.map(fromDisk)) {
        // `record` refuses a buy or a skip with no mandateId, but the file is hand-editable in a demo.
        if (!e.mandateId) continue;
        if (e.kind === "buy") {
          (spentByPeriod[e.mandateId] ??= {})[e.periodKey] = (spentByPeriod[e.mandateId][e.periodKey] ?? 0n) + e.amountIn;
          occupy(e.mandateId, e.periodKey);
        } else if (e.kind === "skip" && e.txHash) {
          // A skip only carries a txHash when the swap was broadcast and then lost track of: a swap
          // that may have moved money must not let the same period buy again; the cost is a skipped
          // period, never a double buy. It adds nothing to `spentByPeriod` — the fill is unknown, and
          // a guessed amount against the period cap would be worse than none.
          occupy(e.mandateId, e.periodKey);
        }
      }
      return { mandates: db.mandates.map(fromDisk), spentByPeriod, boughtPeriods };
    },
  };
}
