import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The package root, not the caller's cwd: `node --test` may be run from anywhere.
const pkg = fileURLToPath(new URL("..", import.meta.url));

const ANVIL_KEY_9 = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6"; // anvil #9 = the agent
const ANVIL_KEY_4 = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"; // anvil #4 = the member

/**
 * Run a CLI the way an operator does. The child inherits this process's environment, so the keys
 * are deleted first: a stray AGENT_PK in the shell would make the "AGENT_PK is required" case pass
 * for the wrong reason. PASSBOOK_PATH keeps every run off the demo's `.state/passbook.json`.
 */
function cli(args, env = {}) {
  const base = { ...process.env, PASSBOOK_PATH: join(mkdtempSync(join(tmpdir(), "passbook-cli-")), "passbook.json") };
  for (const k of ["AGENT_PK", "MEMBER_PK", "NOW"]) delete base[k];
  return spawnSync(process.execPath, args, { cwd: pkg, env: { ...base, ...env }, encoding: "utf8" });
}

// Exit 2 is the operator's code: you typed something wrong, nothing happened. It must stay distinct
// from 3 (no mandate — the run was legitimate and refused), or a scheduler cannot tell a typo in
// its own unit file from a family that has not signed anything.
const rejects = (r, pattern) => {
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, pattern);
  assert.equal(r.stdout, "", "a rejected command prints no result");
};

test("tsumitate without AGENT_PK says which key is missing", () => {
  rejects(cli(["src/cli/tsumitate.js"]), /AGENT_PK is required/);
});

test("mandate with an unknown subcommand prints the usage line", () => {
  rejects(cli(["src/cli/mandate.js", "bogus"]), /^usage: mandate sign .* \| mandate revoke <id>/m);
});

test("buy refuses an amount that is not a decimal number", () => {
  rejects(cli(["src/cli/buy.js", "abc"], { AGENT_PK: ANVIL_KEY_9 }), /usage: pnpm buy <usdc>.*not a decimal amount/);
});

// A negative cap parses (viem reads the sign) and would otherwise be signed into a mandate no one
// can amend, where `intent.amountIn > m.perRunCap` is false for every amount — an unlimited mandate.
test("mandate sign refuses a non-positive cap before anything is signed", () => {
  const r = cli(["src/cli/mandate.js", "sign", "-5"], { AGENT_PK: ANVIL_KEY_9, MEMBER_PK: ANVIL_KEY_4 });
  rejects(r, /usage: mandate sign .*perRun must be positive/);
});

// An id that is not in the passbook is a typo, not a crash. Printing node's stack trace here sent
// the operator reading viem and module-loader frames to learn they mistyped an id they can see in
// `mandate sign`'s own output. The same catch covers the id that was never typed at all.
test("mandate revoke of an unknown id is a usage error, not a stack trace", () => {
  const r = cli(["src/cli/mandate.js", "revoke", "m-nope"]);
  rejects(r, /^usage: mandate revoke <id>\s+— no mandate "m-nope"$/m);
  assert.doesNotMatch(r.stderr, /node:internal|node_modules/, "no stack trace reaches the operator");
  rejects(cli(["src/cli/mandate.js", "revoke"]), /^usage: mandate revoke <id>\s+— no mandate "undefined"$/m);
});

test("mandate sign refuses a cap that is not a decimal number", () => {
  const r = cli(["src/cli/mandate.js", "sign", "20", "abc"], { AGENT_PK: ANVIL_KEY_9, MEMBER_PK: ANVIL_KEY_4 });
  rejects(r, /usage: mandate sign .*perPeriod "abc" is not a decimal amount/);
});
