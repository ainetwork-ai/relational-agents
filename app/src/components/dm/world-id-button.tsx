"use client";

import { useState } from "react";
import {
  IDKitRequestWidget,
  orbLegacy,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";

/**
 * The real World ID widget (IDKit v4).
 *
 * `orbLegacy` asks World App for a v3-shaped uniqueness proof — proof, merkle
 * root, nullifier — which is what the cloud verifier at
 * /api/v2/verify/{app_id} checks and what our registry binds on-chain. The
 * signal is the relationId, so a proof belongs to THIS relationship and cannot
 * be replayed into another one.
 *
 * `rp_context` is minted and signed by the Developer Portal, so it can only
 * come from the server — without portal credentials this component is never
 * rendered and the consent banner uses the dev simulator instead.
 */
export function WorldIdButton({
  appId,
  action,
  signal,
  rpContext,
  disabled,
  onVerified,
}: {
  appId: string;
  action: string;
  signal: string;
  rpContext: RpContext;
  disabled?: boolean;
  onVerified: (proof: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        data-testid="worldid-verify"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
      >
        🌍 Verify you&apos;re a unique human
      </button>
      <IDKitRequestWidget
        app_id={appId as `app_${string}`}
        action={action}
        rp_context={rpContext}
        allow_legacy_proofs
        preset={orbLegacy({ signal })}
        open={open}
        onOpenChange={setOpen}
        onSuccess={async (result: IDKitResult) => {
          const response = "responses" in result ? result.responses[0] : undefined;
 // orbLegacy always answers with the v3 shape; anything else is not a
 // uniqueness proof we can bind on-chain.
          if (!response || !("merkle_root" in response)) return;
          await onVerified({
            proof: response.proof,
            merkle_root: response.merkle_root,
            nullifier_hash: response.nullifier,
            verification_level: "orb",
          });
        }}
      />
    </>
  );
}
