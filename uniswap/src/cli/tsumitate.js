// One run. A scheduler (cron, or the app's timer in slice 2) calls this; it never loops itself.
// Env: AGENT_PK (required) · CHAIN=base · SWAP_PROVIDER=router · LEDGER=file · NOW=<ISO> (tests/demo)
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";
import { ledgerByName } from "../ledger/index.js";
import { runOnce } from "../tsumitate.js";

const key = process.env.AGENT_PK;
if (!key) { console.error("AGENT_PK is required"); process.exit(2); }
const chain = chainByName();
const result = await runOnce({ ledger: ledgerByName(), swap: swapProvider(undefined, chain), chain,
  account: privateKeyToAccount(key), now: process.env.NOW ? new Date(process.env.NOW) : new Date() });
console.log(JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
process.exit(result.outcome === "no-mandate" ? 3 : 0);
