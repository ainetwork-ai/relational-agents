// ainmem's Willow entry codec against aindrive's (docs/willow-ainmem-plan.md Task 4).
//
//   ./node_modules/.bin/tsx --tsconfig scripts/tsconfig.json scripts/willow-entry.check.mts
//
// entry.vectors.json was written by aindrive's real encodeEntryBytes/Store.set
// (web/shared/willow/schemes.ts): the same bytes and the same signature here mean an
// entry ainmem signs is one aindrive's store accepts.
import vectors from "../src/lib/willow/entry.vectors.json" with { type: "json" };
import {
  encodeEntryBytes,
  fromHex,
  importDeviceSeed,
  namespaceOf,
  signTransaction,
  toHex,
  utf8,
  verifyEntry,
  verifyTransaction,
  type WireJson,
} from "../src/lib/willow/entry";
import type { Transaction } from "../src/lib/transactions/types";

const fails: string[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails.push(name);
};

for (const v of vectors) {
  check(`namespace of ${v.driveId}`, toHex(namespaceOf(v.driveId)) === v.namespaceHex);
  const enc = encodeEntryBytes({
    namespace: namespaceOf(v.driveId),
    subspace: fromHex(v.publicKeyHex),
    path: v.path.map(utf8),
    timestamp: BigInt(v.timestamp),
    payload: utf8(v.payload),
  });
  check(`encoded bytes of ${v.path.join("/")}`, toHex(enc) === v.encodedHex);
  const key = await importDeviceSeed(fromHex(v.seedHex));
  check(`public key from seed`, toHex(key.publicKey) === v.publicKeyHex);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, enc as BufferSource));
  check(`signature of ${v.path.join("/")}`, toHex(sig) === v.tokenHex);
  const r = await verifyEntry(v.wire as WireJson, v.driveId);
  check(`aindrive's wire entry verifies`, r.ok && r.path.join("/") === v.path.join("/"), r.ok ? "" : r.reason);
}

const key = await importDeviceSeed(crypto.getRandomValues(new Uint8Array(32)));
const t: Transaction = {
  id: crypto.randomUUID(),
  pageId: crypto.randomUUID(),
  timestamp: Date.now(),
  debug: { userAction: "check", clientCommitTimeMs: Date.now() },
  operations: [{ command: "update", pointer: { table: "block", id: "b1" }, path: [], args: { alive: false } }],
};
const at = { driveId: "drv1", teamspaceId: crypto.randomUUID() };
const w = await signTransaction(key, { ...at, t });
const ok = await verifyTransaction(w, { ...at, pageId: t.pageId, id: t.id });
check("sign → verify round trip", ok.ok && JSON.stringify(ok.t) === JSON.stringify(t) && ok.deviceKey === toHex(key.publicKey));

const refused = async (name: string, wire: WireJson, expect = { ...at, pageId: t.pageId, id: t.id }) => {
  const r = await verifyTransaction(wire, expect);
  check(name, !r.ok, r.ok ? "accepted" : r.reason);
};
const b64 = (s: string) => btoa(String.fromCharCode(...utf8(s)));
const forged = JSON.stringify({ ...t, operations: [] });
await refused("a changed payload is refused", { ...w, pl: b64(forged), n: String(utf8(forged).length) });
await refused("a payload that does not match its digest is refused", { ...w, pl: b64(JSON.stringify(t).replace("b1", "b2")) });
await refused("another page's path is refused", w, { ...at, pageId: crypto.randomUUID(), id: t.id });
await refused("another drive is refused", w, { ...at, driveId: "drv2", pageId: t.pageId, id: t.id });
const other = await importDeviceSeed(crypto.getRandomValues(new Uint8Array(32)));
await refused("someone else's key in the subspace is refused", { ...w, s: toHex(other.publicKey) });
await refused("a garbled token is refused", { ...w, tok: "00".repeat(64) });

if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
