// The emergency-exit scene: the parent asks out in public, the capsule
// starts its 30-day clock — and then the family changes its mind.
//   node src/exit.js request | cancel | execute
import { readFileSync } from "node:fs";
import { STATE_FILE } from "./config.js";
import { publicClient, parent, artifact } from "./clients.js";

const st = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const vaultAbi = artifact("FamilyVault").abi;
const action = { request: "requestExit", cancel: "cancelExit", execute: "executeExit" }[process.argv[2]];
if (!action) { console.error("usage: node src/exit.js request|cancel|execute"); process.exit(1); }

const hash = await parent.writeContract({ address: st.vault, abi: vaultAbi, functionName: action, args: [] });
const r = await publicClient.waitForTransactionReceipt({ hash });
console.log(`${action} · tx ${r.transactionHash}`);
