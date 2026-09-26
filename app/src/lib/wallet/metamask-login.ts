"use client";

// MetaMask identity, shared by the login page (sign in as the wallet's account)
// and settings (attach the wallet to the account that is signed in now). Both sign
// the same server challenge; they differ only in the route the signature goes to.
// No routing here — callers decide what happens after success.

import { getInjectedProvider } from "@/lib/wallet/provider";

/** utf8 → 0x-hex, the message encoding MetaMask's personal_sign expects. */
function toHexMessage(message: string): string {
  return (
    "0x" +
    Array.from(new TextEncoder().encode(message))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** A failure whose message is already the text to show. */
class MetaMaskFlowError extends Error {}

const REJECTED = "Signature request rejected.";

/** 4001 = the user rejected the MetaMask prompt. */
function isRejection(err: unknown): boolean {
  return (err as { code?: number })?.code === 4001;
}

/** Text to show for an error thrown by `signChallengeWithMetaMask` or a fetch after it. */
function messageFor(err: unknown, fallback: string): string {
  if (err instanceof MetaMaskFlowError) return err.message;
  return isRejection(err) ? REJECTED : fallback;
}

/**
 * Pick an account in MetaMask, fetch a fresh challenge and sign it.
 * Throws `MetaMaskFlowError` (no wallet / no account) or the provider's error (4001 on reject).
 */
export async function signChallengeWithMetaMask(): Promise<{ address: string; signature: string }> {
  const ethereum = getInjectedProvider();
  if (!ethereum) throw new MetaMaskFlowError("MetaMask not detected. Please install the extension.");
  // Force the account picker every time. eth_requestAccounts reuses whatever this
  // origin already authorized, so switching accounts inside MetaMask changes nothing
  // on its own. Revoking the permission first (MetaMask ≥ 12.2) guarantees the next
  // request runs the full connect flow; older wallets fall back to
  // wallet_requestPermissions. 4001 (user closed the picker) propagates.
  try {
    await ethereum.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    try {
      await ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    } catch (err) {
      if (isRejection(err)) throw err;
    }
  }
  const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new MetaMaskFlowError("No MetaMask account available.");

  const challengeRes = await fetch("/api/auth/challenge");
  const { message } = await challengeRes.json();
  const signature = (await ethereum.request({
    method: "personal_sign",
    params: [toHexMessage(message), address],
  })) as string;
  return { address, signature };
}

/** Sign in as the account that owns the MetaMask address (created on first use). */
export async function signInWithMetaMask(
  displayName?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fallback = "MetaMask login failed";
  try {
    const { address, signature } = await signChallengeWithMetaMask();
    const res = await fetch("/api/auth/metamask-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature, address, displayName: displayName || undefined }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || fallback };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageFor(err, fallback) };
  }
}

/** Attach the MetaMask address to the account signed in now; the session keeps its user. */
export async function linkMetaMask(): Promise<
  { ok: true; address: string } | { ok: false; error: string; reason?: "taken" | "has-other" }
> {
  const fallback = "Connecting MetaMask failed";
  try {
    const { address, signature } = await signChallengeWithMetaMask();
    const res = await fetch("/api/auth/wallet-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature, address }),
    });
    const data = await res.json();
    if (!res.ok) {
      const reason = data.reason === "taken" || data.reason === "has-other" ? data.reason : undefined;
      return { ok: false, error: data.error || fallback, reason };
    }
    return { ok: true, address: data.address };
  } catch (err) {
    return { ok: false, error: messageFor(err, fallback) };
  }
}
