// RecurringContribution's own tests (contracts/test/*.t.sol) on a fork of Base mainnet — the real Permit2
// and the real USDC — run by Foundry. Skips, saying why, when forge isn't installed or the Base RPC
// doesn't answer, the way the package's other fork tests skip without a fork.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PKG = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const RPC = process.env.BASE_RPC ?? "https://mainnet.base.org";

function forgeBin() {
  const candidates = [process.env.FORGE, path.join(homedir(), ".foundry", "bin", "forge"), "forge"].filter(Boolean);
  return candidates.find((bin) => (bin.includes(path.sep) ? existsSync(bin) : spawnSync(bin, ["--version"]).status === 0));
}

async function rpcUp(rpc) {
  try {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), signal: AbortSignal.timeout(10_000) });
    return r.ok && (await r.json()).result === "0x2105"; // Base, 8453
  } catch {
    return false;
  }
}

test("RecurringContribution on a Base fork: every forge test passes", async (t) => {
  const forge = forgeBin();
  if (!forge) return t.skip("forge not installed (Foundry)");
  if (!(await rpcUp(RPC))) return t.skip(`Base RPC not answering: ${RPC}`);
  const run = spawnSync(forge, ["test", "--fork-url", RPC], { cwd: PKG, encoding: "utf8", timeout: 300_000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /Suite result: ok\. \d+ passed; 0 failed/);
});
