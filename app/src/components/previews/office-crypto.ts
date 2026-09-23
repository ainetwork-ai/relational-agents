// Decrypts password-protected OOXML (docx/xlsx/pptx) in the browser.
//
// An encrypted Office file is not a zip: it is a CFB (OLE2) container holding
// an `EncryptionInfo` stream (how the key is derived) and an
// `EncryptedPackage` stream (the original zip, encrypted). MS-OFFCRYPTO:
//   - Agile (v4.4): XML descriptor, SHA-1/256/384/512, AES-CBC, 4096-byte
//     segments each with its own IV. What Office 2010+ and LibreOffice write.
//   - Standard (v2/3/4.2): binary descriptor, SHA-1 x 50000, AES-ECB.
// Legacy binary Office (RC4 / XOR obfuscation) is out of scope — callers
// report it as protected instead.
//
// Hashing uses @noble/hashes (the 100k-round spin loop is sync and fast);
// AES uses WebCrypto. WebCrypto only offers AES-CBC *with* PKCS#7 padding, so
// no-padding CBC and ECB are emulated — see aesCbcNoPad / aesEcb.
import * as CFB from "cfb";
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";

/** The password did not unlock the file (verifier mismatch). */
export class OfficePasswordError extends Error {
  constructor() { super("Incorrect password."); this.name = "OfficePasswordError"; }
}

/** Encrypted with a scheme we don't implement (extensible, RC4, certificate-only…). */
export class OfficeCryptoUnsupportedError extends Error {
  constructor(detail: string) { super(`Unsupported Office encryption: ${detail}`); this.name = "OfficeCryptoUnsupportedError"; }
}

/** The file asks for more key-derivation work than any real Office file does. */
export class OfficeCryptoLimitError extends Error {
  constructor(detail: string) { super(`This file's encryption settings are out of range (${detail}).`); this.name = "OfficeCryptoLimitError"; }
}

// MS-OFFCRYPTO caps spinCount at 10,000,000 (Office writes 100,000). Each
// spin is one hash on the main thread, so a crafted file with 2^31 spins
// would freeze the tab after the password is typed.
export const MAX_SPIN_COUNT = 10_000_000;

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

type Streams = { info: Uint8Array; pkg: Uint8Array };

function readStreams(bytes: Uint8Array): Streams | null {
  if (bytes.length < 512 || CFB_MAGIC.some((b, i) => bytes[i] !== b)) return null;
  let doc: CFB.CFB$Container;
  try { doc = CFB.read(bytes, { type: "array" }); } catch { return null; }
  const info = CFB.find(doc, "/EncryptionInfo");
  const pkg = CFB.find(doc, "/EncryptedPackage");
  if (!info?.content || !pkg?.content) return null;
  return { info: toU8(info.content), pkg: toU8(pkg.content) };
}

/** True for a CFB container carrying an ECMA-376 encrypted package. A legacy
    binary .xls/.doc/.ppt (also CFB) is false. */
export function isEncryptedOoxml(bytes: Uint8Array): boolean {
  return readStreams(bytes) !== null;
}

/** Decrypt to the original OOXML zip bytes. Throws OfficePasswordError on a
    wrong password, OfficeCryptoUnsupportedError for other schemes. */
export async function decryptOoxml(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const s = readStreams(bytes);
  if (!s) throw new OfficeCryptoUnsupportedError("not an encrypted OOXML package");
  const dv = new DataView(s.info.buffer, s.info.byteOffset, s.info.byteLength);
  const major = dv.getUint16(0, true), minor = dv.getUint16(2, true);
  if (major === 4 && minor === 4) return decryptAgile(s, password);
  if ((major === 2 || major === 3 || major === 4) && minor === 2) return decryptStandard(s, password);
  throw new OfficeCryptoUnsupportedError(`EncryptionInfo version ${major}.${minor}`);
}

// ---------------------------------------------------------------- Agile

type HashFn = (m: Uint8Array) => Uint8Array;
const HASHES: Record<string, HashFn> = { SHA1: sha1, "SHA-1": sha1, SHA256: sha256, SHA384: sha384, SHA512: sha512 };

const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_VERIFIER_VALUE = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];
const BLOCK_KEY_VALUE = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
const SEGMENT = 4096;

// The descriptor is small and fixed-shape; a regex read avoids needing
// DOMParser (absent in the vitest/node environment).
function xmlAttrs(xml: string, tag: string, mustHave: string): Record<string, string> | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b([^>]*)>`, "g");
  for (const m of xml.matchAll(re)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    if (mustHave in attrs) return attrs;
  }
  return null;
}

async function decryptAgile(s: Streams, password: string): Promise<Uint8Array> {
  const xml = new TextDecoder().decode(s.info.subarray(8));
  const keyData = xmlAttrs(xml, "keyData", "saltValue");
  // The password key encryptor is the one with a spinCount (certificate
  // encryptors have none).
  const ek = xmlAttrs(xml, "encryptedKey", "spinCount");
  if (!keyData || !ek) throw new OfficeCryptoUnsupportedError("no password key encryptor");
  if ((ek.cipherAlgorithm ?? "AES") !== "AES" || (ek.cipherChaining ?? "ChainingModeCBC") !== "ChainingModeCBC") {
    throw new OfficeCryptoUnsupportedError(`${ek.cipherAlgorithm}/${ek.cipherChaining}`);
  }
  const hash = HASHES[ek.hashAlgorithm], dataHash = HASHES[keyData.hashAlgorithm];
  if (!hash || !dataHash) throw new OfficeCryptoUnsupportedError(`hash ${ek.hashAlgorithm}`);
  const spinCount = Number(ek.spinCount);
  if (!Number.isInteger(spinCount) || spinCount < 0 || spinCount > MAX_SPIN_COUNT) {
    throw new OfficeCryptoLimitError(`spinCount ${ek.spinCount}`);
  }
  // dataIntegrity (HMAC over the package) is intentionally NOT verified: this
  // is a read-only preview, a tampered package just renders wrong or fails to
  // parse, and nothing decrypted here is trusted or written back.

  const salt = b64(ek.saltValue);
  const keyBytes = Number(ek.keyBits) / 8, blockSize = Number(ek.blockSize);
  const hashSize = Number(ek.hashSize);

  // H0 = H(salt + password); Hn = H(iterator + Hn-1)
  let h = hash(concat(salt, utf16le(password)));
  const buf = new Uint8Array(4 + h.length);
  const bufView = new DataView(buf.buffer);
  for (let i = 0; i < spinCount; i++) {
    bufView.setUint32(0, i, true);
    buf.set(h, 4);
    h = hash(buf);
  }
  const keyFor = (block: number[]) => importAes(fit(hash(concat(h, Uint8Array.from(block))), keyBytes, 0x36));
  const iv = fit(salt, blockSize, 0x36);

  const [kIn, kVal, kKey] = await Promise.all([keyFor(BLOCK_VERIFIER_INPUT), keyFor(BLOCK_VERIFIER_VALUE), keyFor(BLOCK_KEY_VALUE)]);
  const verifierInput = (await aesCbcNoPad(kIn, iv, b64(ek.encryptedVerifierHashInput))).subarray(0, salt.length);
  const verifierHash = (await aesCbcNoPad(kVal, iv, b64(ek.encryptedVerifierHashValue))).subarray(0, hashSize);
  if (!bytesEqual(hash(verifierInput), verifierHash)) throw new OfficePasswordError();

  const secret = (await aesCbcNoPad(kKey, iv, b64(ek.encryptedKeyValue))).subarray(0, Number(keyData.keyBits) / 8);
  const secretKey = await importAes(secret);
  const dataSalt = b64(keyData.saltValue), dataBlock = Number(keyData.blockSize);

  const size = packageSize(s.pkg);
  const enc = s.pkg.subarray(8);
  const out = new Uint8Array(Math.ceil(enc.length / SEGMENT) * SEGMENT);
  const idx = new Uint8Array(4);
  for (let off = 0, i = 0; off < enc.length; off += SEGMENT, i++) {
    new DataView(idx.buffer).setUint32(0, i, true);
    const segIv = fit(dataHash(concat(dataSalt, idx)), dataBlock, 0x36);
    const seg = enc.subarray(off, Math.min(off + SEGMENT, enc.length));
    // Trailing bytes past a block boundary are stream slack, not ciphertext.
    out.set(await aesCbcNoPad(secretKey, segIv, seg.subarray(0, seg.length - (seg.length % 16))), off);
  }
  return out.slice(0, size);
}

// ---------------------------------------------------------------- Standard

const ALG_AES = new Set([0x660e, 0x660f, 0x6610]);

async function decryptStandard(s: Streams, password: string): Promise<Uint8Array> {
  const dv = new DataView(s.info.buffer, s.info.byteOffset, s.info.byteLength);
  const headerSize = dv.getUint32(8, true);
  const hdr = 12; // EncryptionHeader starts after version(4) + flags(4) + size(4)
  const algId = dv.getUint32(hdr + 8, true);
  const keyBits = dv.getUint32(hdr + 16, true);
  if (!ALG_AES.has(algId)) throw new OfficeCryptoUnsupportedError(`algorithm 0x${algId.toString(16)}`);

  let p = hdr + headerSize; // EncryptionVerifier
  const saltSize = dv.getUint32(p, true); p += 4;
  const salt = s.info.slice(p, p + saltSize); p += saltSize;
  const encVerifier = s.info.slice(p, p + 16); p += 16;
  p += 4; // verifierHashSize (20 for SHA-1)
  const encVerifierHash = s.info.slice(p, p + 32);

  let h = sha1(concat(salt, utf16le(password)));
  const buf = new Uint8Array(24);
  const bufView = new DataView(buf.buffer);
  for (let i = 0; i < 50000; i++) {
    bufView.setUint32(0, i, true);
    buf.set(h, 4);
    h = sha1(buf);
  }
  const hFinal = sha1(concat(h, new Uint8Array(4)));
  const x = (fill: number) => {
    const b = new Uint8Array(64).fill(fill);
    for (let i = 0; i < hFinal.length; i++) b[i] ^= hFinal[i];
    return sha1(b);
  };
  const key = await importAes(concat(x(0x36), x(0x5c)).subarray(0, keyBits / 8));

  const verifier = await aesEcb(key, encVerifier);
  const verifierHash = (await aesEcb(key, encVerifierHash)).subarray(0, 20);
  if (!bytesEqual(sha1(verifier), verifierHash)) throw new OfficePasswordError();

  const size = packageSize(s.pkg);
  const enc = s.pkg.subarray(8);
  return (await aesEcb(key, enc.subarray(0, enc.length - (enc.length % 16)))).slice(0, size);
}

// ---------------------------------------------------------------- AES via WebCrypto

function importAes(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", ab(raw), "AES-CBC", false, ["encrypt", "decrypt"]);
}

/**
 * AES-CBC decrypt of whole blocks with no padding. WebCrypto insists on a
 * valid PKCS#7 tail, so we append one synthetic block that decrypts to a full
 * padding block: E_k(0x10*16 XOR lastCipherBlock) — which is exactly the first
 * block of a CBC encryption of 0x10*16 under IV = lastCipherBlock.
 */
async function aesCbcNoPad(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length === 0) return new Uint8Array(0);
  if (data.length % 16) throw new OfficeCryptoUnsupportedError("ciphertext is not block-aligned");
  const last = data.subarray(data.length - 16);
  const pad = new Uint8Array(16).fill(16);
  const padBlock = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: ab(last) }, key, ab(pad))).subarray(0, 16);
  const joined = new Uint8Array(data.length + 16);
  joined.set(data); joined.set(padBlock, data.length);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ab(iv) }, key, ab(joined)));
}

/** AES-ECB decrypt: CBC with a zero IV yields D(Ci) XOR Ci-1; undo the XOR. */
async function aesEcb(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const out = await aesCbcNoPad(key, new Uint8Array(16), data);
  for (let i = 16; i < out.length; i++) out[i] ^= data[i - 16];
  return out;
}

// ---------------------------------------------------------------- bytes

function toU8(c: CFB.CFB$Blob): Uint8Array {
  return c instanceof Uint8Array ? c : Uint8Array.from(c as ArrayLike<number>);
}

/** Copy into a fresh ArrayBuffer — WebCrypto's BufferSource typing (and some
    engines) reject views over SharedArrayBuffer-typed or offset buffers. */
function ab(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer as ArrayBuffer;
}

function packageSize(pkg: Uint8Array): number {
  const dv = new DataView(pkg.buffer, pkg.byteOffset, 8);
  return dv.getUint32(0, true) + dv.getUint32(4, true) * 2 ** 32;
}

function b64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 * i] = c & 0xff; out[2 * i + 1] = c >> 8; }
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

/** Truncate or right-pad with `fill` to exactly n bytes (MS-OFFCRYPTO 2.3.4.12). */
function fit(u: Uint8Array, n: number, fill: number): Uint8Array {
  if (u.length >= n) return u.slice(0, n);
  const out = new Uint8Array(n).fill(fill);
  out.set(u);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
