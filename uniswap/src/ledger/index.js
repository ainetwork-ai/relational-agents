import { fileURLToPath } from "node:url";
import { fileLedger } from "./file.js";

// `.pathname` percent-encodes: a checkout under "/Users/a b/" or a Korean path would send the
// passbook to a literal "%20" directory. `fileURLToPath` decodes back to a real path.
const defaultPath = () => fileURLToPath(new URL("../../.state/passbook.json", import.meta.url));

/** `LEDGER` picks where the passbook lives. `file` needs nothing; `workspace` (slice 2) needs the app. */
export function ledgerByName(name = process.env.LEDGER ?? "file", opts = {}) {
  if (name === "file") return fileLedger(opts.path ?? process.env.PASSBOOK_PATH ?? defaultPath());
  throw new Error(`unknown ledger "${name}"`);
}
