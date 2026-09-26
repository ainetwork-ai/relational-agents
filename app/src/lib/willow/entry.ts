/**
 * Willow entries for ainmem transactions (docs/willow-offline-authorship-design.md A2,
 * docs/willow-ainmem-plan.md Task 4).
 *
 * A transaction in a teamspace linked to an aindrive drive is signed by the editing
 * browser's device key as one entry of that drive's namespace, at
 * `["ainmem", teamspaceId, pageId, txId]`, with the transaction's JSON as payload.
 * The bytes are aindrive's Willow parameters (aindrive web/shared/willow/schemes.ts):
 * namespace = sha256("aindrive/namespace/v1/" + driveId), subspace = the Ed25519
 * public key, payload digest = sha256, token = Ed25519 over the encoded entry.
 * `entry.vectors.json` (made with aindrive's own encoder) pins the encoding —
 * scripts/willow-entry.check.mts.
 *
 * WebCrypto Ed25519 on both sides: the browser keeps its key non-extractable, the
 * server only verifies. Runs in the browser and in Node.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type { Transaction } from "@/lib/transactions/types";

/** aindrive's wire JSON for one entry (web/shared/willow/wire.ts) — hex fields, base64 payload. */
export interface WireJson {
  s: string;
  p: string[];
  ts: string;
  n: string;
  d: string;
  tok: string;
  pl?: string;
}

export interface DeviceKey {
  privateKey: CryptoKey;
  publicKey: Uint8Array;
}

const enc = new TextEncoder();
export const utf8 = (s: string) => enc.encode(s);
export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(h: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(h)) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const b64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export const namespaceOf = (driveId: string): Uint8Array => sha256(utf8(`aindrive/namespace/v1/${driveId}`));
export const nowMicros = (): bigint => BigInt(Date.now()) * 1000n;

// aindrive's path scheme: ≤32 components (count in 1 byte), ≤512 bytes each (length in 2 bytes)
const MAX_COMPONENTS = 32;
const MAX_COMPONENT = 512;

function u64(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n);
  return b;
}

/** Willow's entry encoding (encodings spec, enc_entry) with aindrive's schemes. */
export function encodeEntryBytes(e: {
  namespace: Uint8Array;
  subspace: Uint8Array;
  path: Uint8Array[];
  timestamp: bigint;
  payload?: Uint8Array;
  payloadLength?: bigint;
  digest?: Uint8Array;
}): Uint8Array {
  if (e.path.length > MAX_COMPONENTS || e.path.some((c) => c.length > MAX_COMPONENT)) throw new Error("path too long");
  const parts: Uint8Array[] = [e.namespace, e.subspace, Uint8Array.of(e.path.length)];
  for (const c of e.path) {
    const len = new Uint8Array(2);
    new DataView(len.buffer).setUint16(0, c.length);
    parts.push(len, c);
  }
  const length = e.payloadLength ?? BigInt(e.payload?.length ?? 0);
  parts.push(u64(e.timestamp), u64(length), e.digest ?? sha256(e.payload ?? new Uint8Array()));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const PKCS8_ED25519 = fromHex("302e020100300506032b657004220420");

/** A device key from a 32-byte Ed25519 seed (tests; browsers generate theirs). */
export async function importDeviceSeed(seed: Uint8Array): Promise<DeviceKey> {
  const pkcs8 = new Uint8Array(PKCS8_ED25519.length + 32);
  pkcs8.set(PKCS8_ED25519);
  pkcs8.set(seed, PKCS8_ED25519.length);
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, "Ed25519", true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const publicKey = Uint8Array.from(atob(jwk.x!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  return { privateKey, publicKey };
}

/** A fresh device key whose private half never leaves WebCrypto. */
export async function generateDeviceKey(): Promise<DeviceKey> {
  const kp = (await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"])) as CryptoKeyPair;
  return { privateKey: kp.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)) };
}

async function verifySig(pub: Uint8Array, msg: Uint8Array, sig: Uint8Array): Promise<boolean> {
  try {
    const k = await crypto.subtle.importKey("raw", pub as BufferSource, "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", k, sig as BufferSource, msg as BufferSource);
  } catch {
    return false;
  }
}

/** Sign `payload` at `path` in `driveId`'s namespace, in this device's subspace. */
export async function signEntry(key: DeviceKey, driveId: string, path: string[], payload: Uint8Array, timestamp = nowMicros()): Promise<WireJson> {
  const p = path.map(utf8);
  const digest = sha256(payload);
  const bytes = encodeEntryBytes({ namespace: namespaceOf(driveId), subspace: key.publicKey, path: p, timestamp, payload, digest });
  const tok = new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, bytes as BufferSource));
  return { s: toHex(key.publicKey), p: p.map(toHex), ts: timestamp.toString(), n: String(payload.length), d: toHex(digest), tok: toHex(tok), pl: b64(payload) };
}

export type Verified = { ok: true; path: string[]; payload: Uint8Array; deviceKey: string; timestamp: bigint } | { ok: false; reason: string };

/** Is this wire entry really signed by its subspace's key, with this payload? */
export async function verifyEntry(w: WireJson, driveId: string): Promise<Verified> {
  try {
    if (!w || typeof w.s !== "string" || !Array.isArray(w.p) || typeof w.tok !== "string" || typeof w.pl !== "string") return { ok: false, reason: "malformed" };
    if (!/^[0-9]{1,20}$/.test(w.ts) || !/^[0-9]{1,20}$/.test(w.n)) return { ok: false, reason: "malformed" };
    const subspace = fromHex(w.s);
    const token = fromHex(w.tok);
    const digest = fromHex(w.d);
    if (subspace.length !== 32 || token.length !== 64 || digest.length !== 32) return { ok: false, reason: "malformed" };
    const payload = unb64(w.pl);
    if (BigInt(payload.length) !== BigInt(w.n) || !equal(sha256(payload), digest)) return { ok: false, reason: "payload does not match its digest" };
    const path = w.p.map(fromHex);
    const bytes = encodeEntryBytes({ namespace: namespaceOf(driveId), subspace, path, timestamp: BigInt(w.ts), payloadLength: BigInt(w.n), digest });
    if (!(await verifySig(subspace, bytes, token))) return { ok: false, reason: "bad signature" };
    const dec = new TextDecoder("utf-8", { fatal: true });
    return { ok: true, path: path.map((c) => dec.decode(c)), payload, deviceKey: w.s, timestamp: BigInt(w.ts) };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** The payload a transaction is signed as: its wire fields, without the signature. */
export function transactionPayload(t: Transaction): Uint8Array {
  const { id, pageId, timestamp, debug, operations } = t;
  return utf8(JSON.stringify({ id, pageId, timestamp, debug, operations }));
}

export const transactionPath = (teamspaceId: string, t: Pick<Transaction, "pageId" | "id">) => ["ainmem", teamspaceId, t.pageId, t.id];

export function signTransaction(key: DeviceKey, at: { driveId: string; teamspaceId: string; t: Transaction }): Promise<WireJson> {
  return signEntry(key, at.driveId, transactionPath(at.teamspaceId, at.t), transactionPayload(at.t), BigInt(at.t.timestamp) * 1000n);
}

/** A signed transaction, checked against where it claims to belong. The payload is
 *  what was signed, so it — not the request body around it — is the transaction. */
export async function verifyTransaction(
  w: WireJson,
  expect: { driveId: string; teamspaceId: string; pageId: string; id: string }
): Promise<{ ok: true; t: Transaction; deviceKey: string } | { ok: false; reason: string }> {
  const r = await verifyEntry(w, expect.driveId);
  if (!r.ok) return r;
  if (r.path.join("\u0000") !== transactionPath(expect.teamspaceId, expect).join("\u0000")) return { ok: false, reason: "signed for another place" };
  let t: Transaction;
  try {
    t = JSON.parse(new TextDecoder().decode(r.payload)) as Transaction;
  } catch {
    return { ok: false, reason: "payload is not a transaction" };
  }
  if (!t || t.id !== expect.id || t.pageId !== expect.pageId || !Array.isArray(t.operations)) return { ok: false, reason: "payload is another transaction" };
  return { ok: true, t, deviceKey: r.deviceKey };
}
