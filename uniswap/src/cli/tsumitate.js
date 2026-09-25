// One run. A scheduler (cron, or the app's timer in slice 2) calls this; it never loops itself.
// Env: AGENT_PK (required) · CHAIN=base · SWAP_PROVIDER=router · LEDGER=file · NOW=<ISO> (tests/demo)
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";
import { ledgerByName } from "../ledger/index.js";
import { runOnce } from "../tsumitate.js";

const key = process.env.AGENT_PK;
// Exiting outright is safe here and only here: nothing has been written to stdout yet.
if (!key) { console.error("AGENT_PK is required"); process.exit(2); }
const chain = chainByName();
const result = await runOnce({ ledger: ledgerByName(), swap: swapProvider(undefined, chain), chain,
  account: privateKeyToAccount(key), now: process.env.NOW ? new Date(process.env.NOW) : new Date() });
console.log(JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
// The code, not process.exit(): on macOS a pipe is written asynchronously, so exiting on the line
// after a console.log can cut the JSON in half for whatever is reading it. Setting the code lets
// the write drain and node exit on its own.
process.exitCode = result.outcome === "no-mandate" ? 3 : 0;
