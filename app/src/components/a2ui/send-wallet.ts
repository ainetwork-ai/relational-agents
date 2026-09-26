"use client";

// The browser half of the chat's Send card (lib/agent/send-offer-surface.ts): hand the
// transfer the server approved to MetaMask, keep the hash in this browser the moment there is
// one, and have /api/ens/send/confirm check it. Nothing here decides who gets what — the
// server's `go` answer names it, from the intent the asker's Yes signed.
import type { Address, Hex } from "viem";
import { sendUsdcTransfer } from "@/lib/wallet/send";
import { WalletSignatureError } from "@/lib/wallet/provider";

export interface CardWallet {
  token: string;
  from: Address;
  to: Address;
  amountMicro: string;
}

export type WalletOutcome = { hash: Hex } | { outcome: "cancelled" } | { outcome: "failed"; reason: "wrong-account" | "no-provider" | "failed" };

export async function sendFromCard(w: CardWallet): Promise<WalletOutcome> {
  try {
    return { hash: await sendUsdcTransfer({ from: w.from, to: w.to, amountMicro: BigInt(w.amountMicro) }) };
  } catch (e) {
    if (!(e instanceof WalletSignatureError)) return { outcome: "failed", reason: "failed" };
    if (e.message === "wrong-account") return { outcome: "failed", reason: "wrong-account" };
    if (e.reason === "rejected") return { outcome: "cancelled" };
    if (e.reason === "no-provider") return { outcome: "failed", reason: "no-provider" };
    return { outcome: "failed", reason: "failed" };
  }
}

// the same key the /send page uses: one intent, one hash, whichever screen sent it
const txKey = (token: string) => `ens-send:${token}`;
export function storedTx(token: string): string | null {
  try {
    return localStorage.getItem(txKey(token));
  } catch {
    return null;
  }
}
export function storeTx(token: string, hash: string): void {
  try {
    localStorage.setItem(txKey(token), hash);
  } catch {
    // blocked storage: the server has the hash from the confirm call
  }
}
function dropTx(token: string, hash: string): void {
  try {
    if (localStorage.getItem(txKey(token)) === hash) localStorage.removeItem(txKey(token));
  } catch {
    // nothing stored
  }
}

/** Ask the server to check the transfer (it records the hash first, so the intent is spent). */
export async function confirmTx(token: string, hash: string): Promise<"match" | "mismatch" | "different" | "pending" | "error"> {
  const outcome = await fetch("/api/ens/send/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ t: token, txHash: hash }),
  })
    .then(async (r) => (r.status === 200 ? "match" : (((await r.json().catch(() => ({}))) as { reason?: string }).reason ?? "error")))
    .catch(() => "error");
  // no USDC moved: the server freed the intent, so this hash no longer blocks Send here
  if (outcome === "mismatch") dropTx(token, hash);
  return outcome === "match" || outcome === "mismatch" || outcome === "different" || outcome === "pending" ? outcome : "error";
}
