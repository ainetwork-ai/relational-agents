import { fileURLToPath } from "node:url";
import { fileLedger } from "./file.js";

/** `uniswap/.state/passbook.json`, resolved from `base`. Not `.pathname`: that percent-encodes, so a
 *  checkout under "/Users/a b/" would send the passbook to a literal "%20" directory. */
export const defaultPath = (base = import.meta.url) => fileURLToPath(new URL("../../.state/passbook.json", base));

/** `LEDGER` picks where the passbook lives. `file` needs nothing; `workspace` (slice 2) needs the app. */
export function ledgerByName(name = process.env.LEDGER ?? "file", opts = {}) {
  if (name === "file") return fileLedger(opts.path ?? process.env.PASSBOOK_PATH ?? defaultPath());
  throw new Error(`unknown ledger "${name}"`);
}
