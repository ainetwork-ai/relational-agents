"use client";

import { useCallback, useEffect, useState } from "react";
import { signTypedDataWithWallet } from "@/lib/wallet/sign";
import type { RelationConsentTypedData } from "@/lib/relation-contract";
import { WalletSignatureError } from "@/lib/wallet/provider";

interface ConsentStatus {
  consentAt: string | null;
  required: number;
  parties: { userId: string; displayName: string; signed: boolean }[];
  mySigned: boolean;
  canSign: boolean;
  typedData: RelationConsentTypedData | null;
}

/**
 * The relational agent contract, in the room. Until every member's wallet has
 * signed, the agent does not exist — this banner shows who has signed and lets
 * the caller sign with their wallet. Disappears once consent is complete.
 */
export function ConsentBanner({ roomId }: { roomId: string }) {
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/dm/rooms/${roomId}/consent`);
    if (res.ok) setStatus(await res.json());
  }, [roomId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!status || status.consentAt) return null;

  async function sign() {
    if (!status?.typedData) return;
    setBusy(true);
    setError(null);
    try {
      // EIP-712 — MetaMask renders the RelationConsent fields, and the same
      // signature can later be relayed to RelationalAgentRegistry on-chain.
      const { signature } = await signTypedDataWithWallet(status.typedData);
      const res = await fetch(`/api/dm/rooms/${roomId}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Signing failed");
      await refresh();
    } catch (err) {
      setError(
        err instanceof WalletSignatureError && err.reason === "rejected"
          ? "Signature request was rejected."
          : "Signing failed"
      );
    } finally {
      setBusy(false);
    }
  }

  const waiting = status.parties.filter((p) => !p.signed);

  return (
    <div
      data-testid="consent-banner"
      className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
    >
      <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
        <span aria-hidden>🤝</span>
        The relational agent is born when both of you sign.
      </div>
      <div className="mt-1 text-amber-800/80 dark:text-amber-300/80">
        {status.parties.filter((p) => p.signed).length}/{status.required} signed
        {waiting.length > 0 && (
          <> · waiting for {waiting.map((p) => p.displayName).join(", ")}</>
        )}
      </div>
      {!status.mySigned && (
        <button
          data-testid="consent-sign-button"
          onClick={sign}
          disabled={busy || !status.canSign}
          className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
        >
          {busy
            ? "Waiting for wallet…"
            : status.canSign
              ? "Sign the contract"
              : "Sign in with a wallet to sign"}
        </button>
      )}
      {error && <div className="mt-1.5 text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
