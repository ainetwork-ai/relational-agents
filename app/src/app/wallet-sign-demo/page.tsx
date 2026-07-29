"use client";

/**
 * Scratch page for exercising the wallet-signing primitives end to end:
 * sign an arbitrary message with MetaMask, then round-trip it through
 * POST /api/wallet/verify-signature.
 *
 * Not part of any product flow — delete this route once the signing step has a
 * real home.
 */

import { useState } from "react";
import { newId } from "@/lib/compat";
import { buildSigningMessage } from "@/lib/wallet/message";
import { SignWithWalletButton } from "@/components/wallet/sign-with-wallet-button";
import type { SignedMessage } from "@/lib/wallet/sign";

export default function WalletSignDemoPage() {
  const [purpose, setPurpose] = useState("Approve this action");
  const [signed, setSigned] = useState<SignedMessage | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);

  async function verify(result: SignedMessage) {
    setVerdict("Verifying…");
    const res = await fetch("/api/wallet/verify-signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
    });
    const data = await res.json();
    setVerdict(
      data.valid
        ? `valid — recovered ${data.signer}`
        : `INVALID (${data.error ?? "signature does not match address"})`
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        Wallet signing sandbox
      </h1>
      <p className="mt-1.5 text-sm text-neutral-500">
        Signature only — no session, no login, nothing persisted.
      </p>

      <label className="mt-8 block text-xs font-medium text-neutral-500">
        Purpose (shown in the wallet popup)
      </label>
      <input
        data-testid="wallet-demo-purpose"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        className="mt-1.5 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />

      <div className="mt-4">
        <SignWithWalletButton
          label="Sign message"
 // Resolved at click time — a real flow fetches its nonce here instead
 // of generating one client-side.
          message={() =>
            buildSigningMessage({
              purpose,
              nonce: newId(),
              issuedAt: new Date().toISOString(),
            })
          }
          onSigned={async (result) => {
            setSigned(result);
            setVerdict(null);
            await verify(result);
          }}
        />
      </div>

      {signed && (
        <dl
          data-testid="wallet-demo-result"
          className="mt-8 space-y-3 rounded-md border border-neutral-200 p-4 text-xs dark:border-neutral-700"
        >
          <div>
            <dt className="font-medium text-neutral-500">Signed message</dt>
            <dd className="mt-1 whitespace-pre-wrap font-mono text-neutral-800 dark:text-neutral-200">
              {signed.message}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-500">Address</dt>
            <dd className="mt-1 break-all font-mono text-neutral-800 dark:text-neutral-200">
              {signed.address}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-500">Signature</dt>
            <dd className="mt-1 break-all font-mono text-neutral-800 dark:text-neutral-200">
              {signed.signature}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-500">Server verification</dt>
            <dd
              data-testid="wallet-demo-verdict"
              className="mt-1 break-all font-mono text-neutral-800 dark:text-neutral-200"
            >
              {verdict ?? "—"}
            </dd>
          </div>
        </dl>
      )}
    </main>
  );
}
