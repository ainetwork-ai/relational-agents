import { fileLedger } from "./file.js";

/** `LEDGER` picks where the passbook lives. `file` needs nothing; `workspace` (slice 2) needs the app. */
export function ledgerByName(name = process.env.LEDGER ?? "file", opts = {}) {
  if (name === "file") return fileLedger(opts.path ?? process.env.PASSBOOK_PATH ?? new URL("../../.state/passbook.json", import.meta.url).pathname);
  throw new Error(`unknown ledger "${name}"`);
}
