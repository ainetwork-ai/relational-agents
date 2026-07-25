"use client";

import { useCallback, useEffect, useState } from "react";
import { signTypedDataWithWallet } from "@/lib/wallet/sign";
import type { RelationDissolveTypedData } from "@/lib/relation-contract";
import { WalletSignatureError } from "@/lib/wallet/provider";

interface DissolveStatus {
  consentAt: string | null;
  dissolvedAt: string | null;
  required: number;
  parties: { userId: string; displayName: string; signed: boolean }[];
  mySigned: boolean;
  canDissolve: boolean;
  typedData: RelationDissolveTypedData | null;
}

/**
 * Dissolution mirrors birth: once one member has signed a RelationDissolve,
 * this banner tells the others — the relationship only closes when EVERY
 * signer of the original contract signs the dissolution too. Hidden until
 * someone asks to leave; disappears when the room dissolves.
 */
export function DissolveBanner({ roomId, refreshKey }: { roomId: string; refreshKey?: number }) {
  const [status, setStatus] = useState<DissolveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/dm/rooms/${roomId}/dissolve`);
    if (res.ok) setStatus(await res.json());
  }, [roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const signedCount = status?.parties.filter((p) => p.signed).length ?? 0;
  if (!status || status.dissolvedAt || signedCount === 0) return null;

  async function sign() {
    if (!status?.typedData) return;
    setBusy(true);
    setError(null);
    try {
      const { signature } = await signTypedDataWithWallet(status.typedData);
      const res = await fetch(`/api/dm/rooms/${roomId}/dissolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || `Signing failed (${res.status})`);
      await refresh();
    } catch (err) {
      if (err instanceof WalletSignatureError && err.reason === "rejected") {
        setError("Signature request was rejected.");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Signing failed: ${msg.slice(0, 140)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const asked = status.parties.filter((p) => p.signed).map((p) => p.displayName);

  return (
    <div
      data-testid="dissolve-banner"
      className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950/40"
    >
      <div className="flex items-center gap-2 font-medium text-red-900 dark:text-red-200">
        <span aria-hidden>💔</span>
        {asked.join(", ")} asked to close this relationship.
      </div>
      <div className="mt-1 text-red-800/80 dark:text-red-300/80">
        {signedCount}/{status.required} signed — it closes only when everyone
        signs. The record and its memories stay, sealed.
      </div>
      {!status.mySigned && (
        <button
          data-testid="dissolve-sign-button"
          onClick={sign}
          disabled={busy || !status.canDissolve}
          className="mt-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? "Waiting for wallet…" : "Sign the dissolution"}
        </button>
      )}
      {error && <div className="mt-1.5 text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
