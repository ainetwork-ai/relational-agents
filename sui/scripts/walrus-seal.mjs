#!/usr/bin/env node
/**
 * The sealed egg-tart memory, end to end, on testnet.
 *
 * Encrypts the real demo bytes with Seal under a policy bound to one
 * RelationalAgent object, stores the ciphertext on Walrus, points the on-chain
 * object at the real blob id, and then proves three things that a server-side
 * ACL can only promise:
 *
 *   1. a member decrypts the blob and gets the original bytes back;
 *   2. an outsider is refused by the Seal key servers — no key, no plaintext;
 *   3. the blob as it sits on Walrus is ciphertext, so the operator holding it
 *      has nothing readable.
 *
 * Chain writes go through the Sui CLI (same path as lifecycle.mjs, so no gas
 * plumbing here); Seal and the Walrus read go through the Mysten SDKs.
 *
 *   node sui/scripts/walrus-seal.mjs \
 *     --sui /path/to/sui --config /path/to/client.yaml --package 0x...
 *
 * Writes a JSON receipt (--out, default sui/walrus-seal.json).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SealClient, SessionKey, NoAccessError } from "@mysten/seal";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const GAS_BUDGET = "100000000";
const CLOCK = "0x6";

/** Seal's testnet key servers (see @mysten/seal docs). Threshold 2 of 2 means
 *  both must independently agree the requester passes `seal_approve`. */
const KEY_SERVERS = [
  {
    objectId: "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
    aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
    weight: 1,
  },
  { objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", weight: 1 },
];
const THRESHOLD = 2;

const WALRUS_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const SUI = args.sui ?? process.env.SUI_BIN ?? "sui";
const CONFIG = args.config ?? process.env.SUI_CLIENT_CONFIG ?? null;
const PACKAGE = args.package ?? process.env.SUI_PACKAGE_ID;
const OUT = resolve(args.out ?? resolve(HERE, "..", "walrus-seal.json"));
const RPC = args.rpc ?? "https://fullnode.testnet.sui.io:443";

if (!PACKAGE) throw new Error("--package <id> is required");

function sui(cliArgs, { quiet = false } = {}) {
  const full = CONFIG ? ["client", "--client.config", CONFIG, ...cliArgs] : ["client", ...cliArgs];
  try {
    return {
      ok: true,
      stdout: execFileSync(SUI, full, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
      stderr: "",
    };
  } catch (err) {
    if (!quiet) process.stderr.write(String(err.stderr ?? "").slice(0, 2000));
    return { ok: false, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

function suiJson(cliArgs) {
  const res = sui([...cliArgs, "--json"]);
  if (!res.ok) throw new Error(`sui ${cliArgs.join(" ")} failed:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** The keystore holds `flag || secret`; Ed25519 wants the 32 secret bytes. */
function loadKeypairs() {
  if (!CONFIG) throw new Error("--config is required to load the keystore");
  const dir = dirname(resolve(CONFIG));
  const secrets = JSON.parse(readFileSync(resolve(dir, "sui.keystore"), "utf8"));
  const aliases = JSON.parse(readFileSync(resolve(dir, "sui.aliases"), "utf8"));
  const byAlias = new Map();
  secrets.forEach((b64, i) => {
    const raw = Buffer.from(b64, "base64");
    if (raw[0] !== 0x00) return; // not ed25519
    const kp = Ed25519Keypair.fromSecretKey(new Uint8Array(raw.subarray(1)));
    const alias = aliases[i]?.alias ?? `key${i}`;
    byAlias.set(alias, kp);
  });
  return byAlias;
}

function addressOf(alias) {
  return suiJson(["addresses"]).addresses.find(([a]) => a === alias)?.[1] ?? alias;
}

function call(sender, fn, callArgs) {
  const res = sui([
    "switch",
    "--address",
    sender,
  ]);
  if (!res.ok) throw new Error(`switch to ${sender} failed`);
  return suiJson([
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
  ]);
}

function hex(bytes, n = 32) {
  return Buffer.from(bytes.subarray(0, n)).toString("hex");
}

async function walrusPut(bytes, epochs = 5) {
  const res = await fetch(`${WALRUS_PUBLISHER}/v1/blobs?epochs=${epochs}`, {
    method: "PUT",
    body: bytes,
  });
  if (!res.ok) throw new Error(`walrus publisher ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const info = body.newlyCreated?.blobObject ?? body.alreadyCertified;
  const blobId = info?.blobId ?? body.newlyCreated?.blobObject?.blobId;
  if (!blobId) throw new Error(`no blobId in publisher response: ${JSON.stringify(body)}`);
  return { blobId, raw: body };
}

async function walrusGet(blobId) {
  const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error(`walrus aggregator ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

const receipt = { network: "testnet", packageId: PACKAGE, steps: [] };
const step = (name, data) => {
  receipt.steps.push({ step: name, ...data });
  console.log(`\n== ${name}\n${JSON.stringify(data, null, 2).slice(0, 1200)}`);
};

async function main() {
  const keys = loadKeypairs();
  const memberA = addressOf("memberA");
  const memberB = addressOf("memberB");
  const outsider = addressOf("outsider");

  // A fresh relationship: the M1 agent was dissolved, and a dissolved agent
  // refuses new memories (EAlreadyDissolved) — as it should.
  let agentId = args.agent;
  if (!agentId) {
    const created = call(memberA, "create", [memberA, memberB, CLOCK]);
    agentId = created.objectChanges.find(
      (c) => c.type === "created" && String(c.objectType).endsWith("::RelationalAgent"),
    ).objectId;
    step("create_agent", { digest: created.digest, agentId, memberA, memberB });
  }
  receipt.agentId = agentId;

  // --- the memory itself: the real demo photo plus the note that goes with it
  const photo = new Uint8Array(readFileSync(resolve(REPO, "docs/img/egg-tart.jpg")));
  const note = new TextEncoder().encode(
    [
      "# The egg tart",
      "",
      "We walked past the bakery twice before going in. She said the crust",
      "was better than the one in Lisbon; he disagreed, loudly, and then ate",
      "two.",
      "",
      "_Recorded by the relationship's own agent. Nobody else's._",
      "",
    ].join("\n"),
  );

  const suiClient = new SuiGrpcClient({ network: "testnet", baseUrl: RPC });
  const seal = new SealClient({ suiClient, serverConfigs: KEY_SERVERS, verifyKeyServers: false });

  // The Seal identity is the object id bytes plus a per-memory suffix, which is
  // exactly what `seal_approve`'s is_prefix check enforces: a key derived for
  // this relationship cannot be asked for from another object.
  const idHexBase = agentId.slice(2);
  const results = {};

  for (const [kind, plaintext] of [
    ["note", note],
    ["photo", photo],
  ]) {
    const idHex = `${idHexBase}${kind === "note" ? "01" : "02"}`;
    const { encryptedObject } = await seal.encrypt({
      threshold: THRESHOLD,
      packageId: PACKAGE,
      id: idHex,
      data: plaintext,
    });
    const { blobId } = await walrusPut(encryptedObject);
    const fetched = await walrusGet(blobId);
    results[kind] = { idHex, blobId, plaintext, ciphertext: encryptedObject, fetched };
    step(`seal_encrypt_and_store_${kind}`, {
      identity: `0x${idHex}`,
      blobId,
      plaintextBytes: plaintext.length,
      ciphertextBytes: encryptedObject.length,
      walrusRoundTripIdentical: sameBytes(encryptedObject, fetched),
      walrusUrl: `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`,
      plaintextHead: hex(plaintext),
      ciphertextHead: hex(fetched),
    });
  }

  // The chain now points at a real blob, not a placeholder string.
  for (const kind of ["note", "photo"]) {
    const tx = call(memberA, "add_memory", [agentId, results[kind].blobId, kind, CLOCK]);
    step(`add_memory_${kind}`, { digest: tx.digest, blobId: results[kind].blobId, kind });
  }

  // --- the three demonstrations
  async function approvalBytes(sender, kind, viaAgent = agentId) {
    const tx = new Transaction();
    tx.setSender(sender);
    tx.moveCall({
      target: `${PACKAGE}::relational_agent::seal_approve`,
      arguments: [
        tx.pure.vector("u8", Array.from(Buffer.from(results[kind].idHex, "hex"))),
        tx.object(viaAgent),
      ],
    });
    return tx.build({ client: suiClient, onlyTransactionKind: true });
  }

  // Each attempt gets its OWN SealClient. SealClient caches derived keys in
  // memory, so reusing one instance across identities would let the outsider
  // decrypt from the member's cache and never ask a key server at all — the
  // test would pass for the wrong reason. A fresh client forces every attempt
  // through the real threshold key-server round trip.
  async function attemptDecrypt(alias, address, kind, viaAgent = agentId) {
    const client = new SealClient({
      suiClient,
      serverConfigs: KEY_SERVERS,
      verifyKeyServers: false,
    });
    const sessionKey = await SessionKey.create({
      address,
      packageId: PACKAGE,
      ttlMin: 10,
      signer: keys.get(alias),
      suiClient,
    });
    const txBytes = await approvalBytes(address, kind, viaAgent);
    const data = await walrusGet(results[kind].blobId);
    return client.decrypt({ data, sessionKey, txBytes });
  }

  // 1. a member gets the plaintext back
  for (const kind of ["note", "photo"]) {
    try {
      const out = await attemptDecrypt("memberA", memberA, kind);
      step(`member_decrypt_${kind}`, {
        sender: memberA,
        status: "ok",
        bytes: out.length,
        matchesOriginal: sameBytes(out, results[kind].plaintext),
        preview: kind === "note" ? new TextDecoder().decode(out).slice(0, 160) : hex(out, 12),
      });
    } catch (err) {
      step(`member_decrypt_${kind}`, { sender: memberA, status: "failed", error: String(err) });
    }
  }

  // 2. the outsider is refused a key
  try {
    const out = await attemptDecrypt("outsider", outsider, "note");
    step("outsider_decrypt_note", {
      sender: outsider,
      status: "UNEXPECTED_SUCCESS",
      bytes: out.length,
    });
  } catch (err) {
    step("outsider_decrypt_note", {
      sender: outsider,
      status: "refused",
      errorClass: err?.constructor?.name,
      isNoAccess: err instanceof NoAccessError,
      error: String(err?.message ?? err),
    });
  }

  // 2b. being in *another* relationship does not unlock this one. Member A is
  // also a member of `--other-agent`; presenting that object while asking for
  // this relationship's identity fails the is_prefix check (EPolicyMismatch),
  // so the key servers refuse a bona-fide member of a different couple.
  if (args["other-agent"]) {
    try {
      const out = await attemptDecrypt("memberA", memberA, "note", args["other-agent"]);
      step("cross_relationship_decrypt_note", {
        sender: memberA,
        viaAgent: args["other-agent"],
        status: "UNEXPECTED_SUCCESS",
        bytes: out.length,
      });
    } catch (err) {
      step("cross_relationship_decrypt_note", {
        sender: memberA,
        viaAgent: args["other-agent"],
        status: "refused",
        errorClass: err?.constructor?.name,
        error: String(err?.message ?? err),
      });
    }
  }

  // 3. what the operator actually holds
  const rawNote = await walrusGet(results.note.blobId);
  step("raw_blob_is_ciphertext", {
    blobId: results.note.blobId,
    firstBytesHex: hex(rawNote, 48),
    firstBytesAscii: JSON.stringify(
      Buffer.from(rawNote.subarray(0, 48)).toString("latin1").replace(/[^\x20-\x7e]/g, "."),
    ),
    plaintextFirstBytesAscii: JSON.stringify(
      new TextDecoder().decode(results.note.plaintext.subarray(0, 48)),
    ),
    containsPlaintextMarker: Buffer.from(rawNote).includes("egg tart"),
  });

  const object = suiJson(["object", agentId]);
  receipt.finalObject = object;
  writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`\nreceipt -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  writeFileSync(OUT, `${JSON.stringify({ ...receipt, fatal: String(err) }, null, 2)}\n`);
  process.exit(1);
});
