#!/usr/bin/env node
/**
 * The whole relationship, on chain, in one run.
 *
 * Births a RelationalAgent from two member addresses, writes a memory as one
 * of them, *fails* to write one as an outsider, and dissolves it as the other
 * member. The failing call is the point: cross-relationship isolation is a
 * Move assertion, not a server-side filter, so it aborts on chain where anyone
 * can check it.
 *
 * Everything goes through the Sui CLI so this runs with no npm dependencies —
 * the same calls the app makes via app/src/lib/sui/agent.ts.
 *
 *   node sui/scripts/lifecycle.mjs \
 *     --sui /path/to/sui --config /path/to/client.yaml \
 *     --package 0x... --member-a memberA --member-b memberB --outsider outsider
 *
 * Omit --package to publish sui/move first. Addresses may be given as 0x… or
 * as a keystore alias. Writes a JSON receipt (--out, default sui/lifecycle.json).
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOVE_DIR = resolve(HERE, "..", "move");
const GAS_BUDGET = "100000000";
const CLOCK = "0x6";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const SUI = args.sui ?? process.env.SUI_BIN ?? "sui";
const CONFIG = args.config ?? process.env.SUI_CLIENT_CONFIG ?? null;
const OUT = resolve(args.out ?? resolve(HERE, "..", "lifecycle.json"));
const BLOB = args.blob ?? "walrus://demo-egg-tart-blob";
const KIND = args.kind ?? "date";

/** Run the CLI. Returns { ok, stdout, stderr } instead of throwing, because a
 *  non-zero exit is a *result* here — the outsider's call is meant to fail. */
function sui(cliArgs, { quiet = false } = {}) {
  const full = CONFIG ? ["client", "--client.config", CONFIG, ...cliArgs] : ["client", ...cliArgs];
  try {
    const stdout = execFileSync(SUI, full, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    if (!quiet) process.stderr.write(String(err.stderr ?? "").slice(0, 4000));
    return { ok: false, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

function suiJson(cliArgs) {
  const res = sui([...cliArgs, "--json"]);
  if (!res.ok) throw new Error(`sui ${cliArgs.join(" ")} failed:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Aliases are friendlier in a demo script; the chain only knows addresses. */
function resolveAddress(nameOrAddress) {
  if (/^0x[0-9a-fA-F]{40,64}$/.test(nameOrAddress)) return nameOrAddress;
  const listed = suiJson(["addresses"]);
  const rows = listed.addresses ?? listed;
  for (const row of rows) {
    const [alias, addr] = Array.isArray(row) ? row : [row.alias, row.address];
    if (alias === nameOrAddress) return addr;
  }
  throw new Error(`no address for alias "${nameOrAddress}"`);
}

function switchTo(address) {
  const res = sui(["switch", "--address", address]);
  if (!res.ok) throw new Error(`could not switch to ${address}`);
}

function digestOf(result) {
  return result.digest ?? result.effects?.transactionDigest ?? null;
}

function createdObjectOfType(result, suffix) {
  for (const change of result.objectChanges ?? []) {
    if (change.type === "created" && String(change.objectType ?? "").endsWith(suffix)) {
      return change.objectId;
    }
  }
  return null;
}

function publishedPackageId(result) {
  for (const change of result.objectChanges ?? []) {
    if (change.type === "published") return change.packageId;
  }
  return null;
}

function callArgv(fn, callArgs) {
  return [
    "call",
    "--package",
    PACKAGE,
    "--module",
    "relational_agent",
    "--function",
    fn,
    "--args",
    ...callArgs,
    "--gas-budget",
    GAS_BUDGET,
  ];
}

function moveCall(fn, callArgs) {
  return suiJson(callArgv(fn, callArgs));
}

/** Seal key servers never execute `seal_approve` — they dry-run it and read the
 *  abort. So do we, from each address in turn. */
function dryRun(fn, callArgs) {
  const res = sui([...callArgv(fn, callArgs), "--dry-run"], { quiet: true });
  const text = `${res.stdout}\n${res.stderr}`;
  const abort = text.match(/MoveAbort\(.*\}, (\d+)\) in command/);
  return {
    ok: res.ok && /execution status: success/i.test(text),
    abortCode: abort ? Number(abort[1]) : null,
    // The CLI follows the verdict with a full transaction table; the verdict
    // line is the whole answer.
    text: (text.trim().split("\n")[0] ?? "").trim(),
  };
}

/** The Seal identity of a relationship is its object id bytes. */
function identityBytes(objectId) {
  const hex = objectId.replace(/^0x/, "");
  return JSON.stringify(hex.match(/../g).map((b) => Number.parseInt(b, 16)));
}

const receipt = { network: "testnet", steps: [] };

function record(step, extra) {
  const entry = { step, ...extra };
  receipt.steps.push(entry);
  const digest = entry.digest ? ` digest=${entry.digest}` : "";
  console.log(`- ${step}: ${entry.status}${digest}`);
  return entry;
}

// 0. Package -----------------------------------------------------------------
let PACKAGE = args.package ?? process.env.SUI_PACKAGE_ID ?? null;
if (!PACKAGE) {
  console.log(`publishing ${MOVE_DIR} …`);
  const res = suiJson(["publish", MOVE_DIR, "--gas-budget", GAS_BUDGET]);
  PACKAGE = publishedPackageId(res);
  if (!PACKAGE) throw new Error("publish produced no package id");
  record("publish", { status: "ok", digest: digestOf(res), packageId: PACKAGE });
}
receipt.packageId = PACKAGE;

const memberA = resolveAddress(args["member-a"] ?? "memberA");
const memberB = resolveAddress(args["member-b"] ?? "memberB");
const outsider = resolveAddress(args.outsider ?? "outsider");
receipt.memberA = memberA;
receipt.memberB = memberB;
receipt.outsider = outsider;
console.log(`package  ${PACKAGE}\nmemberA  ${memberA}\nmemberB  ${memberB}\noutsider ${outsider}\n`);

// 1. Birth -------------------------------------------------------------------
switchTo(memberA);
const created = moveCall("create", [memberA, memberB, CLOCK]);
const agentId = createdObjectOfType(created, "::relational_agent::RelationalAgent");
if (!agentId) throw new Error("create produced no RelationalAgent object");
receipt.agentId = agentId;
record("create", { status: "ok", digest: digestOf(created), agentId, memberA, memberB });

// 2. A member records a memory ----------------------------------------------
const remembered = moveCall("add_memory", [agentId, BLOB, KIND, CLOCK]);
record("add_memory_member", {
  status: "ok",
  digest: digestOf(remembered),
  sender: memberA,
  blobId: BLOB,
  kind: KIND,
});

// 3. An outsider tries the same thing and the chain refuses ------------------
switchTo(outsider);
const denied = sui(
  [
    "call",
    "--package",
    PACKAGE,
    "--module",
    "relational_agent",
    "--function",
    "add_memory",
    "--args",
    agentId,
    "walrus://outsider-should-never-land",
    "date",
    CLOCK,
    "--gas-budget",
    GAS_BUDGET,
  ],
  { quiet: true },
);
const deniedText = `${denied.stderr}\n${denied.stdout}`.trim();
if (denied.ok && !/ENotMember|MoveAbort|abort_code/i.test(deniedText)) {
  throw new Error("ISOLATION BROKEN: a non-member wrote to the agent");
}
record("add_memory_outsider", {
  status: "rejected",
  sender: outsider,
  // Abort code 2 is ENotMember in sui/move/sources/relational_agent.move.
  error: deniedText.split("\n").slice(0, 24).join("\n"),
});

// 4. The Seal policy, evaluated exactly as a key server would ----------------
// A member asks to unlock this relationship's identity: approved.
switchTo(memberA);
const sealMember = dryRun("seal_approve", [identityBytes(agentId), agentId]);
if (!sealMember.ok) throw new Error(`seal_approve denied a member:\n${sealMember.text}`);
record("seal_approve_member", { status: "approved", sender: memberA });

// The outsider asks for the same key: ENotMember, so no key share is issued.
switchTo(outsider);
const sealOutsider = dryRun("seal_approve", [identityBytes(agentId), agentId]);
if (sealOutsider.ok) throw new Error("ISOLATION BROKEN: seal_approve passed for a non-member");
record("seal_approve_outsider", {
  status: "rejected",
  sender: outsider,
  abortCode: sealOutsider.abortCode,
  error: sealOutsider.text,
});

// And the sharper case: memberA is also in a *second* relationship. Being a
// member of something is not being a member of this — the identity is bound to
// the object, so relationship #2 cannot be used to unlock relationship #1.
switchTo(memberA);
const second = moveCall("create", [memberA, outsider, CLOCK]);
const secondAgentId = createdObjectOfType(second, "::relational_agent::RelationalAgent");
receipt.secondAgentId = secondAgentId;
record("create_second_relationship", {
  status: "ok",
  digest: digestOf(second),
  agentId: secondAgentId,
  members: [memberA, outsider],
});
const sealCrossRelation = dryRun("seal_approve", [identityBytes(agentId), secondAgentId]);
if (sealCrossRelation.ok) {
  throw new Error("ISOLATION BROKEN: another relationship approved this one's identity");
}
record("seal_approve_cross_relationship", {
  status: "rejected",
  sender: memberA,
  viaAgent: secondAgentId,
  forIdentityOf: agentId,
  abortCode: sealCrossRelation.abortCode,
  error: sealCrossRelation.text,
});

// 5. Dissolve, by the other member ------------------------------------------
switchTo(memberB);
const dissolved = moveCall("dissolve", [agentId, CLOCK]);
record("dissolve", { status: "ok", digest: digestOf(dissolved), sender: memberB });

// 6. Read the object back ----------------------------------------------------
const object = suiJson(["object", agentId]);
receipt.finalObject = object.content?.fields ?? object;

writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`\nagent ${agentId}\nreceipt ${OUT}`);
