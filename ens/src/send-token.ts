// ens/src/send-token.ts
// The transfer the agent prepared, carried in the link (/send?t=…): signed with the
// server's secret so nobody can change who gets what, and valid for 10 minutes.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Address } from "viem";

export interface SendIntent {
  userId: string;
  roomId: string;
  from: Address;
  name: string;
  to: Address;
  /** USDC in 6-decimal units, as a decimal string */
  amountMicro: string;
  /** ms since epoch */
  exp: number;
}

const TTL_MS = 10 * 60 * 1000;
const mac = (body: string, secret: string) => createHmac("sha256", `ens-send:${secret}`).update(body).digest();

export function signSendIntent(intent: Omit<SendIntent, "exp">, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...intent, exp: now + TTL_MS })).toString("base64url");
  return `${body}.${mac(body, secret).toString("base64url")}`;
}

export function verifySendIntent(token: string, secret: string, now = Date.now()): SendIntent | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = mac(body, secret);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const intent = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SendIntent;
    return intent.exp >= now ? intent : null;
  } catch {
    return null;
  }
}

/** How long after expiry a link may still be confirmed: confirming moves no money, it only
 *  records a transfer the wallet already made. */
export const CONFIRM_GRACE_MS = 24 * 60 * 60 * 1000;

/** verifySendIntent with CONFIRM_GRACE_MS: for checking a transfer, never for starting one. */
export function verifySendIntentForConfirm(token: string, secret: string, now = Date.now()): SendIntent | null {
  return verifySendIntent(token, secret, now - CONFIRM_GRACE_MS);
}

// One link pays once. The hash is recorded the moment the wallet hands it over, before the
// chain is asked, so the link is spent from then on; "confirmed" follows once the Transfer
// was found and announced. Per process: a restart forgets, which the 10-minute expiry bounds.
const g = globalThis as unknown as { __ensSent?: Map<string, string>; __ensConfirmed?: Set<string> };
const sent = (g.__ensSent ??= new Map<string, string>());
const confirmed = (g.__ensConfirmed ??= new Set<string>());
export function markSent(token: string, txHash: string): void {
  sent.set(token, txHash);
}
export function wasSent(token: string): string | null {
  return sent.get(token) ?? null;
}
export function markConfirmed(token: string): void {
  confirmed.add(token);
}
export function wasConfirmed(token: string): boolean {
  return confirmed.has(token);
}
