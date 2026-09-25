import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BIG = new Set(["perRunCap", "perPeriodCap", "amountIn", "amountOut"]);
const toDisk = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
const fromDisk = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, BIG.has(k) && typeof v === "string" ? BigInt(v) : v]));

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
    async addMandate(m) { const db = load(); db.mandates.push(toDisk(m)); save(db); },
    async revoke(id, atSec) {
      const db = load();
      const m = db.mandates.find((x) => x.id === id);
      if (!m) throw new Error(`no mandate ${id}`);
      m.revokedAt = atSec; save(db);
    },
    async record(entry) { const db = load(); db.entries.push(toDisk(entry)); save(db); },
    async view() {
      const db = load();
      const spentByPeriod = {}, boughtPeriods = {};
      for (const e of db.entries.map(fromDisk)) {
        if (e.kind !== "buy" || !e.mandateId) continue;
        (spentByPeriod[e.mandateId] ??= {})[e.periodKey] = (spentByPeriod[e.mandateId][e.periodKey] ?? 0n) + e.amountIn;
        const list = (boughtPeriods[e.mandateId] ??= []);
        if (!list.includes(e.periodKey)) list.push(e.periodKey);
      }
      return { mandates: db.mandates.map(fromDisk), spentByPeriod, boughtPeriods };
    },
  };
}
