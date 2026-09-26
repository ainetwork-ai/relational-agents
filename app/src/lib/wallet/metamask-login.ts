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

/** Why linking or signing in failed, for callers that translate it (the English `error` stays as is). */
export type MetaMaskFailure =
  | "no-wallet" // no MetaMask in this browser
  | "no-account" // MetaMask returned no account
  | "rejected" // the user closed the picker or rejected the signature (4001)
  | "no-challenge" // the server had no challenge for this session
  | "invalid-signature"
  | "taken" // wallet-link: the wallet belongs to another account
  | "has-other" // wallet-link: this account's address is a sign-in id that is not a wallet
  | "has-verified" // wallet-link: this account has another proven wallet (retry with replace after a warning)
  | "owns-family" // wallet-link: the proven wallet owns a family name of this account's workspace
  | "changed" // wallet-link: the account's wallet changed meanwhile
  | "chain-unavailable" // wallet-link: Sepolia could not be read for the family check
  | "network" // a request never got an answer
  | "failed"; // anything else

/** A failure whose message is already the text to show. */
class MetaMaskFlowError extends Error {
  constructor(public reason: MetaMaskFailure, message: string) {
    super(message);
  }
}

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

/** The same error as a MetaMaskFailure. A TypeError is what fetch throws when the request never got an answer. */
function reasonFor(err: unknown): MetaMaskFailure {
  if (err instanceof MetaMaskFlowError) return err.reason;
  if (isRejection(err)) return "rejected";
  return err instanceof TypeError ? "network" : "failed";
}

/**
 * Pick an account in MetaMask (or, with `pick: false`, take the one it is on), fetch a fresh challenge and sign it.
 * Throws `MetaMaskFlowError` (no wallet / no account) or the provider's error (4001 on reject).
 */
export async function signChallengeWithMetaMask(opts: { pick?: boolean } = {}): Promise<{ address: string; signature: string }> {
  const ethereum = getInjectedProvider();
  if (!ethereum) throw new MetaMaskFlowError("no-wallet", "MetaMask not detected. Please install the extension.");
  if (opts.pick !== false) await forceAccountPicker(ethereum);
  const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new MetaMaskFlowError("no-account", "No MetaMask account available.");

  const challengeRes = await fetch("/api/auth/challenge");
  const { message } = await challengeRes.json();
  const signature = (await ethereum.request({
    method: "personal_sign",
    params: [toHexMessage(message), address],
  })) as string;
  return { address, signature };
}

async function forceAccountPicker(ethereum: NonNullable<ReturnType<typeof getInjectedProvider>>): Promise<void> {
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

export type LinkResult =
  | { ok: true; address: string }
  | { ok: false; error: string; reason: MetaMaskFailure; name?: string; current?: string };

/** Prove a MetaMask address for the account signed in now; the session keeps its user.
 *  `pick: false` signs with the account MetaMask is on now instead of opening the account picker;
 *  `replace: true` replaces a proven wallet (only after the UI warned). `error` is English (for
 *  logs); `reason` is what a UI translates, with `name` (owns-family) and `current` (the old wallet). */
export async function linkMetaMask(opts: { pick?: boolean; replace?: boolean } = {}): Promise<LinkResult> {
  const fallback = "Connecting MetaMask failed";
  try {
    const { address, signature } = await signChallengeWithMetaMask({ pick: opts.pick });
    const res = await fetch("/api/auth/wallet-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature, address, replace: opts.replace === true }),
    });
    const data = await res.json();
    if (!res.ok) {
      const known: MetaMaskFailure[] = [
        "taken",
        "has-other",
        "has-verified",
        "owns-family",
        "changed",
        "chain-unavailable",
        "no-challenge",
        "invalid-signature",
      ];
      const reason = known.includes(data.reason) ? (data.reason as MetaMaskFailure) : "failed";
      return {
        ok: false,
        error: data.error || fallback,
        reason,
        name: typeof data.name === "string" ? data.name : undefined,
        current: typeof data.current === "string" ? data.current : undefined,
      };
    }
    return { ok: true, address: data.address };
  } catch (err) {
    return { ok: false, error: messageFor(err, fallback), reason: reasonFor(err) };
  }
}
