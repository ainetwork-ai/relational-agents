"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { signTypedDataWithWallet } from "@/lib/wallet/sign";
import type { RelationConsentTypedData } from "@/lib/relation-contract";
import { WalletSignatureError } from "@/lib/wallet/provider";
import type { RpContext } from "@worldcoin/idkit";

interface ConsentStatus {
  consentAt: string | null;
  required: number;
  parties: { userId: string; displayName: string; signed: boolean; personhoodVerified: boolean }[];
  mySigned: boolean;
  myPersonhoodVerified: boolean;
  personhoodRequired: boolean;
  canSign: boolean;
  typedData: RelationConsentTypedData | null;
}

const WORLD_ID_APP_ID = process.env.NEXT_PUBLIC_WORLD_ID_APP_ID ?? "";
const WORLD_ID_ACTION = process.env.NEXT_PUBLIC_WORLD_ID_ACTION ?? "relation-consent";

/** Only pulled into the bundle when a portal app_id is configured. */
const WorldIdButton = dynamic(
  () => import("./world-id-button").then((m) => m.WorldIdButton),
  { ssr: false }
);

/**
 * The relational agent contract, in the room. Until every member's wallet has
 * signed, the agent does not exist — this banner shows who has signed and lets
 * the caller sign with their wallet. Disappears once consent is complete.
 *
 * When the human-backed registry is configured a signature alone is not
 * enough: each member first proves with World ID that they are a unique human,
 * and that proof is bound to the agent on-chain alongside their signature.
 */
export function ConsentBanner({ roomId }: { roomId: string }) {
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/dm/rooms/${roomId}/consent`);
    if (res.ok) setStatus(await res.json());
  }, [roomId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

 // Only the server can hand out a portal-signed RP context; without one the
 // widget cannot run and the dev simulator stands in.
  useEffect(() => {
    if (!WORLD_ID_APP_ID) return;
    fetch(`/api/worldid/verify?roomId=${roomId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRpContext(d?.rpContext ?? null))
      .catch(() => setRpContext(null));
  }, [roomId]);

  const submitProof = useCallback(
    async (proof: Record<string, unknown>) => {
      setVerifying(true);
      setError(null);
      try {
        const res = await fetch("/api/worldid/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...proof, roomId }),
        });
        const data = await res.json();
        if (!res.ok) setError(data.error || `Verification failed (${res.status})`);
        await refresh();
      } catch (err) {
        setError(`Verification failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setVerifying(false);
      }
    },
    [roomId, refresh]
  );

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
      if (!res.ok) setError(data.error || `Sign-in failed (${res.status})`);
      await refresh();
    } catch (err) {
      if (err instanceof WalletSignatureError && err.reason === "rejected") {
        setError("Signature request was rejected.");
      } else {
 // surface the real cause — wallet errors are otherwise swallowed
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Signing failed: ${msg.slice(0, 140)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const waiting = status.parties.filter((p) => !p.signed);
  const needsPersonhood = status.personhoodRequired && !status.myPersonhoodVerified;

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

      {status.personhoodRequired && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-amber-800/80 dark:text-amber-300/80">
          {status.parties.map((p) => (
            <span key={p.userId} className="flex items-center gap-1" data-testid="personhood-badge">
              {p.displayName}
              {p.personhoodVerified ? (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                  🌍 verified
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                  unverified
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {needsPersonhood ? (
        <>
          <div className="mt-2 text-amber-800/80 dark:text-amber-300/80">
            First, prove you&apos;re a unique human — the agent carries one proof per person.
          </div>
          {WORLD_ID_APP_ID && rpContext ? (
            <WorldIdButton
              appId={WORLD_ID_APP_ID}
              action={WORLD_ID_ACTION}
              signal={status.typedData?.message.relationId ?? roomId}
              rpContext={rpContext}
              disabled={verifying}
              onVerified={submitProof}
            />
          ) : (
            <button
              data-testid="worldid-verify"
              onClick={() => submitProof({})}
              disabled={verifying}
              className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              {verifying ? "Verifying…" : "🌍 Verify you're a unique human"}
            </button>
          )}
        </>
      ) : (
        !status.mySigned && (
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
        )
      )}
      {error && <div className="mt-1.5 text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
