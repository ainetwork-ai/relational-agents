// One run. A scheduler (cron, or the app's timer in slice 2) calls this; it never loops itself.
// Env: AGENT_PK (required) · CHAIN=base · RPC_URL · SWAP_PROVIDER=router · LEDGER=file · PASSBOOK_PATH
//      · NOW=<ISO> (tests/demo)
// Flag: --dry-run — decide and quote as a real run would, write nothing, swap nothing.
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";
import { ledgerByName } from "../ledger/index.js";
import { runOnce } from "../tsumitate.js";

const key = process.env.AGENT_PK;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
// Exiting outright is safe here and only here: nothing has been written to stdout yet. An argument
// this run does not know is refused rather than ignored — a mistyped "--dryrun" against real funds
// must not quietly become a real run.
if (!key) { console.error("AGENT_PK is required"); process.exit(2); }
const unknown = args.find((a) => a !== "--dry-run");
if (unknown) { console.error(`usage: pnpm tsumitate [--dry-run]  — unknown argument "${unknown}"`); process.exit(2); }
const chain = chainByName();
const result = await runOnce({ ledger: ledgerByName(), swap: swapProvider(undefined, chain), chain,
  account: privateKeyToAccount(key), now: process.env.NOW ? new Date(process.env.NOW) : new Date(), dryRun });
console.log(JSON.stringify(dryRun ? { dryRun: true, ...result } : result,
  (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
// The code, not process.exit(): on macOS a pipe is written asynchronously, so exiting on the line
// after a console.log can cut the JSON in half for whatever is reading it. Setting the code lets
// the write drain and node exit on its own.
process.exitCode = result.outcome === "no-mandate" ? 3 : 0;
