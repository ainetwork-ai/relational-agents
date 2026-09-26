import "server-only";
import { getAddress, isAddress, keccak256, type Hex } from "viem";
import { db } from "@/lib/db";
import { aindriveAccounts, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { callAindriveTool, listToolNames } from "@/lib/aindrive";
import { runAs } from "@/lib/aindrive-account";
import type { PaymentPayload, PaymentRequirements } from "@/lib/gift";
import type { PayerRef, X402Provider } from "./provider";

/**
 * The aindrive provider: the person's aindrive account holds their wallet and
 * runs the x402 facilitator. Everything goes over aindrive's MCP, as them,
 * through three tools this app expects aindrive to offer:
 *
 *   x402_wallet  {}                                     → { address }
 *   x402_sign    { x402Version, paymentRequirements,
 *                  resource }                           → { paymentPayload }
 *   x402_settle  { paymentPayload, paymentRequirements } → { success, transaction,
 *                                                           network, payer, errorReason? }
 *
 * The shapes are the x402 v2 facilitator's (`/verify`, `/settle`) so aindrive
 * can front one directly. The names are conventions until aindrive ships them
 * — AINDRIVE_X402_{WALLET,SIGN,SETTLE}_TOOL rename them without a deploy —
 * and `available()` looks for them in aindrive's tool list, so this provider
 * switches itself on the day they appear.
 */

const TOOL = {
  wallet: process.env.AINDRIVE_X402_WALLET_TOOL?.trim() || "x402_wallet",
  sign: process.env.AINDRIVE_X402_SIGN_TOOL?.trim() || "x402_sign",
  settle: process.env.AINDRIVE_X402_SETTLE_TOOL?.trim() || "x402_settle",
};

/** aindrive offers the x402 tools to this person's account. */
export async function aindriveX402Available(userId: string): Promise<boolean> {
  const names = await runAs(userId, () => listToolNames()).catch(() => new Set<string>());
  return names.has(TOOL.sign) && names.has(TOOL.settle) && names.has(TOOL.wallet);
}

// address → person, learned whenever a wallet is asked for; the resource looks
// a payment's signer up here first, then asks every connected account.
const walletIndex = new Map<string, PayerRef>();

async function nameOf(userId: string): Promise<string> {
  const [u] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, userId));
  return u?.n ?? "";
}

async function walletAddress(userId: string): Promise<Hex> {
  const r = (await runAs(userId, () => callAindriveTool(TOOL.wallet, {}))) as { address?: unknown } | string;
  const address = typeof r === "string" ? r.trim() : r?.address;
  if (typeof address !== "string" || !isAddress(address)) throw new Error(`aindrive ${TOOL.wallet}: no wallet address`);
  const a = getAddress(address);
  walletIndex.set(a.toLowerCase(), { userId, name: await nameOf(userId) });
  return a;
}

function asPayload(r: unknown): PaymentPayload | null {
  const o = (typeof r === "string" ? safeJson(r) : r) as { paymentPayload?: PaymentPayload; x402Version?: number } | null;
  if (!o) return null;
  if (o.paymentPayload?.payload?.signature) return o.paymentPayload;
  return o.x402Version === 2 && (o as PaymentPayload).payload?.signature ? (o as PaymentPayload) : null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const aindriveX402: X402Provider = {
  id: "aindrive",

  ready: aindriveX402Available,

  payToOf: walletAddress,

  async sign(payer, req: PaymentRequirements, resourceUrl) {
    const r = await runAs(payer.userId, () =>
      callAindriveTool(TOOL.sign, { x402Version: 2, paymentRequirements: req, resource: { url: resourceUrl } }, 60_000)
    );
    const payload = asPayload(r);
    if (!payload) throw new Error(`aindrive ${TOOL.sign}: no payment payload in the reply`);
    walletIndex.set(payload.payload.authorization.from.toLowerCase(), payer);
    return payload;
  },

  async payerOf(payment) {
    const from = payment.payload.authorization.from.toLowerCase();
    const known = walletIndex.get(from);
    if (known) return known;
    // not seen since this process started — ask each connected account whose wallet it is
    const rows = await db.select({ userId: aindriveAccounts.userId }).from(aindriveAccounts).limit(200);
    for (const { userId } of rows) {
      const a = await walletAddress(userId).catch(() => null);
      if (a && a.toLowerCase() === from) return walletIndex.get(from) ?? { userId, name: await nameOf(userId) };
    }
    return null;
  },

  async settle(spec, payment, payer) {
    const paymentRequirements = payment.accepted;
    const r = (await runAs(payer.userId, () => callAindriveTool(TOOL.settle, { paymentPayload: payment, paymentRequirements }, 120_000))) as
      | { success?: boolean; transaction?: string; network?: string; errorReason?: string; error?: string }
      | string;
    const o = typeof r === "string" ? ((safeJson(r) as typeof r) ?? { errorReason: r }) : r;
    if (typeof o === "string" || !o?.success) {
      const why = typeof o === "string" ? o : (o?.errorReason ?? o?.error ?? "settlement refused");
      return { ok: false, error: `aindrive x402: ${why}` };
    }
    const transaction = typeof o.transaction === "string" ? o.transaction : undefined;
    // the receipt people see: the chain tx when there is one, else the signature's hash
    const receipt = transaction ?? keccak256(payment.payload.signature).slice(0, 18);
    return { ok: true, receipt, transaction, network: o.network ?? paymentRequirements.network };
  },
};
