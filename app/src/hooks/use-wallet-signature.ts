"use client";

/**
 * React wrapper around `@/lib/wallet/sign` — the same signing primitives with
 * the busy/error/address bookkeeping a UI needs.
 *
 * Deliberately flow-free: it hands you a signature and nothing else. What that
 * signature authorises is the caller's business.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Address, TypedDataDefinition } from "viem";
import {
  isWalletAvailable,
  toWalletError,
  type WalletErrorReason,
} from "@/lib/wallet/provider";
import {
  connectWallet,
  getConnectedAddress,
  signMessageWithWallet,
  signTypedDataWithWallet,
  type SignedMessage,
  type SignedTypedData,
} from "@/lib/wallet/sign";

export type WalletSignStatus =
  | "idle"
  | "connecting"
  | "awaiting-signature"
  | "signed"
  | "error";

export interface UseWalletSignature {
  /** Whether a wallet extension exists. False during SSR/first paint. */
  available: boolean;
  /** Connected account, if the user has already authorised one. */
  address: Address | null;
  status: WalletSignStatus;
  busy: boolean;
  error: string | null;
  errorReason: WalletErrorReason | null;
  /** Result of the most recent successful signature. */
  signature: SignedMessage | SignedTypedData | null;
  connect: () => Promise<Address | null>;
  /** Signs `message` (EIP-191). Returns null on rejection/failure — read
   *  `error` for the reason. */
  signMessage: (message: string) => Promise<SignedMessage | null>;
  /** Signs an EIP-712 payload. Returns null on rejection/failure. */
  signTypedData: (
    typedData: TypedDataDefinition
  ) => Promise<SignedTypedData | null>;
  reset: () => void;
}

/** Extensions can inject late; MetaMask fires this once it has. */
function subscribeToInjection(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("ethereum#initialized", onChange);
  return () => window.removeEventListener("ethereum#initialized", onChange);
}

export function useWalletSignature(): UseWalletSignature {
  // Read through useSyncExternalStore rather than state-in-effect: the server
  // snapshot is `false`, so hydration matches, and the value flips as soon as
  // the client has a provider.
  const available = useSyncExternalStore(
    subscribeToInjection,
    isWalletAvailable,
    () => false
  );
  const [address, setAddress] = useState<Address | null>(null);
  const [status, setStatus] = useState<WalletSignStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<WalletErrorReason | null>(null);
  const [signature, setSignature] = useState<
    SignedMessage | SignedTypedData | null
  >(null);

  useEffect(() => {
    if (!available) return;
    let alive = true;

    // Silent — no popup. Tells us whether the user already authorised us.
    getConnectedAddress().then((a) => {
      if (alive) setAddress(a);
    });

    // Wallet-side account switching / disconnect.
    const provider = window.ethereum;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = (args[0] as string[] | undefined) ?? [];
      setAddress((accounts[0] as Address | undefined) ?? null);
      setSignature(null);
    };
    provider?.on?.("accountsChanged", onAccountsChanged);
    return () => {
      alive = false;
      provider?.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, [available]);

  const fail = useCallback((err: unknown) => {
    const walletError = toWalletError(err);
    setError(walletError.message);
    setErrorReason(walletError.reason);
    setStatus("error");
    return null;
  }, []);

  const begin = useCallback((next: WalletSignStatus) => {
    setError(null);
    setErrorReason(null);
    setStatus(next);
  }, []);

  const connect = useCallback(async () => {
    begin("connecting");
    try {
      const next = await connectWallet();
      setAddress(next);
      setStatus("idle");
      return next;
    } catch (err) {
      return fail(err);
    }
  }, [begin, fail]);

  const signMessage = useCallback(
    async (message: string) => {
      begin("awaiting-signature");
      try {
        const result = await signMessageWithWallet(message);
        setAddress(result.address);
        setSignature(result);
        setStatus("signed");
        return result;
      } catch (err) {
        return fail(err);
      }
    },
    [begin, fail]
  );

  const signTypedData = useCallback(
    async (typedData: TypedDataDefinition) => {
      begin("awaiting-signature");
      try {
        const result = await signTypedDataWithWallet(typedData);
        setAddress(result.address);
        setSignature(result);
        setStatus("signed");
        return result;
      } catch (err) {
        return fail(err);
      }
    },
    [begin, fail]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setErrorReason(null);
    setSignature(null);
  }, []);

  return {
    available,
    address,
    status,
    busy: status === "connecting" || status === "awaiting-signature",
    error,
    errorReason,
    signature,
    connect,
    signMessage,
    signTypedData,
    reset,
  };
}
