import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { getAddress, isAddress, keccak256, toHex, verifyTypedData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { db } from "@/lib/db";
import { blocks, pages, users, workspaceMembers } from "@/lib/db/schema";
import { hasDrive, readFile, readFileBytes, writeFile } from "@/lib/aindrive";
import { runAs } from "@/lib/aindrive-account";
import { seal, stamp, stampOk, unseal } from "@/lib/secret-box";
import { selfOrigin } from "@/lib/app-origin";

/**
 * A gift behind x402: a file someone keeps unshared on their own device (서연's
 * video for grandma), offered on a page as a locked block. Paying the asking
 * price — pocket money, to the person who made it — opens it.
 *
 * The protocol is x402 v2, "exact" scheme, EIP-3009: the resource answers 402
 * with PAYMENT-REQUIRED; the payer signs a USDC transferWithAuthorization for
 * the amount to the recipient's wallet and retries with PAYMENT-SIGNATURE; the
 * resource verifies the signature, settles, and answers 200 with
 * PAYMENT-RESPONSE.
 *
 * Settlement here is the family ledger: the debit and the credit are written
 * as rows into the payer's and the recipient's own aindrive (지갑/용돈_장부.csv,
 * 지갑/받은_용돈.csv), over MCP, as each of them. The signature is real and
 * checked; no chain is touched — this environment has no funded wallet. A
 * facilitator that settles on Base would replace `settle` and nothing else.
 */

// ── the offer ───────────────────────────────────────────────────────────────

export const GIFT_NETWORK = "eip155:84532"; // Base Sepolia
export const GIFT_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDC (Base Sepolia)
const GIFT_CHAIN_ID = 84532;
const USDC_DECIMALS = 6;
/** Fixed for the demo; a live deployment would quote it. */
export const KRW_PER_USDC = 1380;

export interface GiftSpec {
  id: string;
  title: string;
  /** who made it and receives the money */
  recipientUserId: string;
  recipientName: string;
  payTo: Hex;
  amountKrw: number;
  /** USDC, atomic (6 decimals) */
  amount: string;
  /** the locked file — on the recipient's own drive, NOT shared */
  file: { driveId: string; path: string; mime: string };
  /** an aindrive link anyone on the page may see (blurred frame) */
  previewUrl?: string;
}

/** The block content that carries a gift: its spec, stamped by this server so
 *  a page editor cannot forge one, and — once paid — the unlock. */
export interface GiftContent {
  spec: GiftSpec;
  sig: string;
  unlock?: GiftUnlock;
}

export interface GiftUnlock {
  at: string;
  byUserId: string;
  byName: string;
  receipt: string;
  /** server stamp over the gift id — the only thing the video route trusts */
  token: string;
}

const SPEC = "gift-spec";
const UNLOCK = "gift-unlock";
const specData = (s: GiftSpec) => JSON.stringify([s.id, s.recipientUserId, s.payTo.toLowerCase(), s.amount, s.file.driveId, s.file.path]);

export function krwToAtomic(krw: number): string {
  return String(Math.round((krw / KRW_PER_USDC) * 10 ** USDC_DECIMALS));
}

export function formatUsdc(atomic: string): string {
  return (Number(atomic) / 10 ** USDC_DECIMALS).toFixed(2);
}

/** Makes a gift of one of `ownerId`'s own files. aindrive is asked, as them,
 *  whether the drive is theirs — nobody can put a price on someone else's file. */
export async function createGift(
  ownerId: string,
  input: { title: string; driveId: string; path: string; mime: string; amountKrw: number; previewUrl?: string }
): Promise<GiftContent> {
  if (!(await runAs(ownerId, () => hasDrive(input.driveId)))) throw new Error("That drive is not the owner's");
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
  const payTo = (await walletOf(ownerId)).address;
  const spec: GiftSpec = {
    id: randomBytes(9).toString("base64url"),
    title: input.title,
    recipientUserId: ownerId,
    recipientName: owner?.displayName ?? "",
    payTo,
    amountKrw: input.amountKrw,
    amount: krwToAtomic(input.amountKrw),
    file: { driveId: input.driveId, path: input.path, mime: input.mime },
    previewUrl: input.previewUrl,
  };
  return { spec, sig: stamp(SPEC, specData(spec)) };
}

export function giftValid(g: unknown): g is GiftContent {
  const c = g as GiftContent | undefined;
  return !!c?.spec?.id && stampOk(SPEC, specData(c.spec), c.sig);
}

export function unlocked(g: GiftContent): boolean {
  return !!g.unlock && stampOk(UNLOCK, g.spec.id, g.unlock.token);
}

/** The block carrying gift `id`, and its page. */
export async function findGift(id: string) {
  const [row] = await db
    .select({ blockId: blocks.id, pageId: blocks.pageId, content: blocks.content, workspaceId: pages.workspaceId })
    .from(blocks)
    .innerJoin(pages, eq(pages.id, blocks.pageId))
    .where(sql`${blocks.content}->'gift'->'spec'->>'id' = ${id}`)
    .limit(1);
  if (!row) return null;
  const gift = (row.content as { gift?: unknown }).gift;
  return giftValid(gift) ? { ...row, gift } : null;
}

export async function canSeeGift(userId: string, workspaceId: string): Promise<boolean> {
  const [m] = await db
    .select({ u: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return !!m;
}

// ── the family wallet: a key this server keeps for a person ────────────────

const WALLET = "family-wallet";
const PREFIX = "fw1:";

/** The person's family wallet — made on first use. Stored as
 *  "fw1:<address>:<sealed key>" so a payer can be found by address. */
export async function walletOf(userId: string): Promise<{ address: Hex; key: Hex }> {
  const [u] = await db.select({ k: users.encryptedPrivateKey }).from(users).where(eq(users.id, userId));
  if (u?.k?.startsWith(PREFIX)) {
    const [, address, sealed] = u.k.split(":");
    const key = unseal(WALLET, sealed);
    if (key && isAddress(address)) return { address: getAddress(address), key: key as Hex };
  }
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  await db.update(users).set({ encryptedPrivateKey: `${PREFIX}${address}:${seal(WALLET, key)}` }).where(eq(users.id, userId));
  return { address, key };
}

async function userByWallet(address: string): Promise<{ id: string; displayName: string } | null> {
  const [u] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(like(users.encryptedPrivateKey, `${PREFIX}${getAddress(address)}:%`))
    .limit(1);
  return u ?? null;
}

// ── x402 v2 wire ────────────────────────────────────────────────────────────

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export function requirementsFor(g: GiftSpec): PaymentRequirements {
  return {
    scheme: "exact",
    network: GIFT_NETWORK,
    asset: GIFT_ASSET,
    amount: g.amount,
    payTo: g.payTo,
    maxTimeoutSeconds: 300,
    extra: {
      assetTransferMethod: "eip3009",
      name: "USDC",
      version: "2",
      settlement: "family-ledger",
      display: { krw: g.amountKrw, usdc: formatUsdc(g.amount), recipient: g.recipientName },
    },
  };
}

export const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
export const unb64 = <T,>(s: string): T | null => {
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
};

const AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
const domainOf = (r: PaymentRequirements) => ({
  name: String(r.extra.name),
  version: String(r.extra.version),
  chainId: GIFT_CHAIN_ID,
  verifyingContract: getAddress(r.asset),
});

export interface Authorization {
  from: Hex;
  to: Hex;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface PaymentPayload {
  x402Version: 2;
  resource?: { url: string };
  accepted: PaymentRequirements;
  payload: { signature: Hex; authorization: Authorization };
}

/** The payer's side: sign an EIP-3009 authorization for these requirements. */
export async function signPayment(key: Hex, req: PaymentRequirements, resourceUrl: string): Promise<PaymentPayload> {
  const account = privateKeyToAccount(key);
  const now = Math.floor(Date.now() / 1000);
  const authorization: Authorization = {
    from: account.address,
    to: getAddress(req.payTo),
    value: req.amount,
    validAfter: String(now - 60),
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce: toHex(randomBytes(32)),
  };
  const signature = await account.signTypedData({
    domain: domainOf(req),
    types: AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      ...authorization,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
    },
  });
  return { x402Version: 2, resource: { url: resourceUrl }, accepted: req, payload: { signature, authorization } };
}

/** The resource's side: is this a valid payment for exactly this offer? */
export async function verifyPayment(p: PaymentPayload | null, req: PaymentRequirements): Promise<{ ok: true; from: Hex } | { ok: false; error: string }> {
  if (!p || p.x402Version !== 2 || !p.payload?.authorization || !p.payload.signature) return { ok: false, error: "malformed payment" };
  const a = p.payload.authorization;
  const acc = p.accepted;
  if (!acc || acc.scheme !== req.scheme || acc.network !== req.network || acc.asset.toLowerCase() !== req.asset.toLowerCase())
    return { ok: false, error: "payment is for a different network or asset" };
  if (!isAddress(a.to) || getAddress(a.to) !== getAddress(req.payTo)) return { ok: false, error: "payment is not to the recipient" };
  if (BigInt(a.value) < BigInt(req.amount)) return { ok: false, error: "underpaid" };
  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validAfter) > now || Number(a.validBefore) < now) return { ok: false, error: "authorization expired or not yet valid" };
  if (!isAddress(a.from)) return { ok: false, error: "bad payer" };
  const ok = await verifyTypedData({
    address: getAddress(a.from),
    domain: domainOf(req),
    types: AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
    signature: p.payload.signature,
  }).catch(() => false);
  return ok ? { ok: true, from: getAddress(a.from) } : { ok: false, error: "signature does not match the payer" };
}

// ── settlement: the family ledger, in the family's own aindrive ─────────────

export const LEDGER_OUT = "지갑/용돈_장부.csv";
export const LEDGER_IN = "지갑/받은_용돈.csv";
const LEDGER_HEAD = "날짜,내용,상대,금액(원),잔액(원),영수증";
const usedNonces = new Set<string>();

function parseLedger(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => l.split(","));
}

export async function ledgerBalance(userId: string, driveId: string): Promise<number> {
  const text = await runAs(userId, () => readFile({ driveId, root: "" }, LEDGER_OUT)).catch(() => "");
  const rows = parseLedger(text);
  return rows.length ? Number(rows[rows.length - 1][4]) || 0 : 0;
}

/** Debits the payer's ledger, credits the recipient's — each on their own
 *  device, written as them. Returns the receipt id. */
export async function settle(
  g: GiftSpec,
  p: PaymentPayload,
  payer: { userId: string; name: string; driveId: string },
  recipientDriveId: string
): Promise<{ receipt: string } | { error: string }> {
  const nonce = p.payload.authorization.nonce.toLowerCase();
  if (usedNonces.has(nonce)) return { error: "this authorization was already used" };
  const receipt = keccak256(p.payload.signature).slice(0, 18);
  const link = { driveId: payer.driveId, root: "" };
  const text = await runAs(payer.userId, () => readFile(link, LEDGER_OUT)).catch(() => "");
  const rows = parseLedger(text);
  const balance = rows.length ? Number(rows[rows.length - 1][4]) || 0 : 0;
  if (rows.some((r) => r[5] === receipt)) return { error: "this authorization was already used" };
  if (balance < g.amountKrw) return { error: `잔액이 부족해요 (잔액 ${balance.toLocaleString("ko-KR")}원)` };
  const today = new Date().toISOString().slice(0, 10);
  const clean = (s: string) => s.replace(/,\s*/g, " ").replace(/\n/g, " ");
  const out = [LEDGER_HEAD, ...rows.map((r) => r.join(",")), [today, clean(`용돈 · ${g.title}`), clean(g.recipientName), -g.amountKrw, balance - g.amountKrw, receipt].join(",")];
  await runAs(payer.userId, () => writeFile(link, LEDGER_OUT, out.join("\n") + "\n"));
  const inLink = { driveId: recipientDriveId, root: "" };
  const inText = await runAs(g.recipientUserId, () => readFile(inLink, LEDGER_IN)).catch(() => "");
  const inRows = parseLedger(inText);
  const inBal = inRows.length ? Number(inRows[inRows.length - 1][4]) || 0 : 0;
  const inOut = [LEDGER_HEAD, ...inRows.map((r) => r.join(",")), [today, clean(`용돈 · ${g.title}`), clean(payer.name), g.amountKrw, inBal + g.amountKrw, receipt].join(",")];
  await runAs(g.recipientUserId, () => writeFile(inLink, LEDGER_IN, inOut.join("\n") + "\n"));
  usedNonces.add(nonce);
  return { receipt };
}

/** Records the unlock on the gift's block, stamped. */
export async function markUnlocked(blockId: string, g: GiftContent, by: { userId: string; name: string }, receipt: string) {
  const unlock: GiftUnlock = { at: new Date().toISOString(), byUserId: by.userId, byName: by.name, receipt, token: stamp(UNLOCK, g.spec.id) };
  const [b] = await db.select({ content: blocks.content }).from(blocks).where(eq(blocks.id, blockId));
  if (!b) return unlock;
  const content = { ...b.content, gift: { ...g, unlock } };
  await db.update(blocks).set({ content, updatedAt: new Date() }).where(eq(blocks.id, blockId));
  return unlock;
}

export { userByWallet };

/** The gift's file bytes, read from the recipient's own drive, as them. */
export function giftBytes(g: GiftSpec): Promise<Buffer> {
  return runAs(g.recipientUserId, () => readFileBytes({ driveId: g.file.driveId, root: "" }, g.file.path, 60 * 1024 * 1024));
}

/** The device a person keeps their ledger on: the first drive of their aindrive account. */
export async function ledgerDriveOf(userId: string): Promise<string | null> {
  const { listDrives } = await import("@/lib/aindrive");
  const drives = await runAs(userId, () => listDrives()).catch(() => []);
  return drives[0]?.id ?? null;
}

export type PayOutcome =
  | { ok: true; receipt: string; already?: boolean; unlock: GiftUnlock | null; spec: GiftSpec }
  | { ok: false; status: number; error: string };

/**
 * Pays for a gift the x402 way, as `payerId`, over HTTP against the gift's own
 * resource: ask → 402 PAYMENT-REQUIRED → sign → retry with PAYMENT-SIGNATURE →
 * 200 PAYMENT-RESPONSE. The same round trip any x402 client makes.
 */
export async function payGift(payerId: string, giftId: string, origin?: string): Promise<PayOutcome> {
  const base = selfOrigin(origin);
  const get = (headers: Record<string, string> = {}) =>
    fetch(`${base}/api/gift/${encodeURIComponent(giftId)}`, { headers, cache: "no-store" });
  const first = await get();
  if (first.status === 200) {
    const found = await findGift(giftId);
    return found ? { ok: true, receipt: found.gift.unlock?.receipt ?? "", already: true, unlock: found.gift.unlock ?? null, spec: found.gift.spec } : { ok: false, status: 404, error: "gift not found" };
  }
  if (first.status !== 402) return { ok: false, status: first.status, error: `unexpected ${first.status}` };
  const required = unb64<{ accepts?: PaymentRequirements[]; resource?: { url: string } }>(first.headers.get("PAYMENT-REQUIRED") ?? "");
  const req = required?.accepts?.[0];
  if (!req) return { ok: false, status: 502, error: "no payment requirements in the 402" };
  const wallet = await walletOf(payerId);
  const payment = await signPayment(wallet.key, req, required?.resource?.url ?? "");
  const paid = await get({ "PAYMENT-SIGNATURE": b64(payment) });
  const body = (await paid.json().catch(() => ({}))) as { error?: string; receipt?: string };
  if (!paid.ok) return { ok: false, status: paid.status, error: body.error ?? `payment refused (${paid.status})` };
  const found = await findGift(giftId);
  if (!found) return { ok: false, status: 404, error: "gift not found" };
  return { ok: true, receipt: body.receipt ?? "", unlock: found.gift.unlock ?? null, spec: found.gift.spec };
}
