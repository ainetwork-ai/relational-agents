"use client";

import { useMemo, useRef, useState } from "react";
import {
  IDKitErrorCodes,
  IDKitRequestWidget,
  orbLegacy,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";

export type SeatClaimError = { sameHuman: boolean; text: string };
export type SeatEnvironment = "production" | "staging" | "sandbox";

/** What World App / IDKit can answer instead of a proof, in the panel's words. */
function idkitErrorText(code: IDKitErrorCodes): string {
  switch (code) {
    case IDKitErrorCodes.UserRejected:
    case IDKitErrorCodes.VerificationRejected:
    case IDKitErrorCodes.Cancelled:
      return "You declined in World App — no vote was claimed.";
    case IDKitErrorCodes.CredentialUnavailable:
      return "This World ID has no Orb verification — a vote needs a proof of human.";
    case IDKitErrorCodes.Timeout:
    case IDKitErrorCodes.ConnectionFailed:
      return "World App didn't answer in time — no vote was claimed. Try again.";
    case IDKitErrorCodes.InvalidRpSignature:
    case IDKitErrorCodes.UnknownRp:
    case IDKitErrorCodes.InactiveRp:
    case IDKitErrorCodes.InvalidRpIdFormat:
    case IDKitErrorCodes.RpSignatureExpired:
    case IDKitErrorCodes.DuplicateNonce:
    case IDKitErrorCodes.TimestampTooOld:
    case IDKitErrorCodes.TimestampTooFarInFuture:
    case IDKitErrorCodes.InvalidTimestamp:
      return `World ID refused this app's signed request (${code}) — no vote was claimed.`;
    default:
      return `World ID couldn't verify you (${code}) — no vote was claimed.`;
  }
}

/**
 * Claiming a seat with a real World ID 4.0 proof.
 *
 * On click it asks the server for a freshly signed rp_context — IDKit v4 will
 * not run without one, it is single-use, and only the server holds the
 * signing key — then opens IDKit with orbLegacy({ signal: roomId }): a proof of
 * human bound to THIS relation. orbLegacy returns World ID 3.0 proofs only, and
 * the seat route accepts only 3.0 (SEAT_PROTOCOL there): a 3.0 and a 4.0 proof
 * of one human carry different nullifiers, so both at once would let one
 * human hold two seats. Changing the preset means changing that constant.
 * The result goes to the seat route untouched
 * (handleVerify), so the widget shows success only once the server has
 * verified the proof and seated this member; any refusal — 409 same-human
 * above all — is handed to the panel to show in red.
 */
export function SeatButton({
  roomId,
  appId,
  action,
  environment,
  onClaimed,
  onError,
}: {
  roomId: string;
  appId: `app_${string}`;
  /** the action the server verifies (status.seatAction) — it is hashed into the rp_context */
  action: string;
  environment: SeatEnvironment;
  onClaimed: () => void | Promise<void>;
  onError: (err: SeatClaimError | null) => void;
}) {
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const seatedRef = useRef(false);
  const preset = useMemo(() => orbLegacy({ signal: roomId }), [roomId]);

  const start = async () => {
    setStarting(true);
    onError(null);
    try {
      const res = await fetch(`/api/dm/rooms/${roomId}/treasury/seat/rp-context`, {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as Partial<RpContext> & { message?: string };
      if (!res.ok || typeof data.rp_id !== "string" || typeof data.signature !== "string") {
        onError({ sameHuman: false, text: data.message || `World ID couldn't start (${res.status})` });
        return;
      }
      seatedRef.current = false;
      // one render with both set: the widget builds its request from the
      // rp_context present when it opens
      setRpContext(data as RpContext);
      setOpen(true);
    } catch (err) {
      onError({ sameHuman: false, text: `World ID couldn't start: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setStarting(false);
    }
  };

  const close = () => {
    setOpen(false);
    // an rp_context is single-use; the next click signs a new one
    setRpContext(null);
  };

  const handleVerify = async (result: IDKitResult) => {
    const res = await fetch(`/api/dm/rooms/${roomId}/treasury/seat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idkitResponse: result }),
    });
    if (res.ok) return;
    const data = (await res.json().catch(() => ({}))) as { reason?: string; message?: string; error?: string };
    const failure: SeatClaimError = {
      sameHuman: res.status === 409 || data.reason === "same-human",
      text: data.message || data.error || `Claiming your vote failed (${res.status})`,
    };
    onError(failure);
    // the panel's red line is the answer; the widget's generic "host app
    // failed" screen would only hide it
    close();
    throw new Error(failure.text);
  };

  return (
    <>
      <button
        type="button"
        data-testid="treasury-seat-claim"
        onClick={() => void start()}
        disabled={starting || open}
        className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
      >
        {starting ? "Starting World ID…" : "🌍 Claim your vote with World ID"}
      </button>
      {rpContext && (
        <IDKitRequestWidget
          app_id={appId}
          action={action}
          rp_context={rpContext}
          action_description="Claim your vote in this relation's shared treasury — one human, one vote."
          allow_legacy_proofs
          preset={preset}
          environment={environment}
          open={open}
          onOpenChange={(next) => {
            if (next) {
              setOpen(true);
              return;
            }
            close();
            // refresh once the success screen is gone, so the panel does not
            // swap the claim box out from under it
            if (seatedRef.current) {
              seatedRef.current = false;
              void onClaimed();
            }
          }}
          handleVerify={handleVerify}
          onSuccess={() => {
            // only reached after handleVerify resolved: the server seated us
            seatedRef.current = true;
          }}
          onError={(code) => {
            // handleVerify already reported the server's refusal
            if (code === IDKitErrorCodes.FailedByHostApp) return;
            onError({ sameHuman: false, text: idkitErrorText(code) });
          }}
        />
      )}
    </>
  );
}
