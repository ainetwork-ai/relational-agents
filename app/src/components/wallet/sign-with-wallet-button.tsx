"use client";

/**
 * Drop-in "ask the user's wallet to sign this" button.
 *
 * Flow-agnostic: it produces `{ address, signature, message }` and hands it to
 * `onSigned`. Wire that callback to whatever endpoint the flow needs (login,
 * publish approval, agent action, …) — this component never navigates, never
 * sets a session, and never talks to the server itself.
 *
 * `message` may be a function so the caller can fetch a server-issued nonce at
 * click time (the correct pattern — see @/lib/wallet/message).
 */

import { useState } from "react";
import type { SignedMessage } from "@/lib/wallet/sign";
import type { WalletErrorReason } from "@/lib/wallet/provider";
import { useWalletSignature } from "@/hooks/use-wallet-signature";

interface SignWithWalletButtonProps {
  /** The exact string to sign, or a resolver invoked on click. */
  message: string | (() => string | Promise<string>);
  onSigned?: (result: SignedMessage) => void | Promise<void>;
  onError?: (message: string, reason: WalletErrorReason) => void;
  label?: string;
  pendingLabel?: string;
  /** Text shown when no wallet extension is installed (button is disabled). */
  unavailableLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Render the error text under the button. Off when the parent shows it. */
  showError?: boolean;
  testId?: string;
}

const BASE_CLASS =
  "flex w-full items-center justify-center gap-2 rounded-md border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";

export function SignWithWalletButton({
  message,
  onSigned,
  onError,
  label = "Sign with wallet",
  pendingLabel = "Waiting for wallet…",
  unavailableLabel = "No wallet detected",
  disabled = false,
  className = BASE_CLASS,
  showError = true,
  testId = "wallet-sign-button",
}: SignWithWalletButtonProps) {
  const wallet = useWalletSignature();
  // Separate from `wallet.busy`: covers resolving the message (nonce fetch) and
  // running the caller's async `onSigned`, so the button stays disabled for the
  // whole round trip, not just the wallet popup.
  const [working, setWorking] = useState(false);

  async function handleClick() {
    setWorking(true);
    try {
      const text = typeof message === "function" ? await message() : message;
      const result = await wallet.signMessage(text);
      if (!result) {
        onError?.(wallet.error ?? "Signing failed", wallet.errorReason ?? "failed");
        return;
      }
      await onSigned?.(result);
    } catch (err) {
      // Only reachable from the message resolver or onSigned — wallet errors
      // are already captured in hook state.
      onError?.(err instanceof Error ? err.message : String(err), "failed");
    } finally {
      setWorking(false);
    }
  }

  const busy = working || wallet.busy;

  return (
    <div>
      <button
        type="button"
        data-testid={testId}
        onClick={handleClick}
        disabled={disabled || busy || !wallet.available}
        className={className}
      >
        <span aria-hidden className="text-base">
          🦊
        </span>
        {!wallet.available ? unavailableLabel : busy ? pendingLabel : label}
      </button>

      {showError && wallet.error && (
        <p
          data-testid={`${testId}-error`}
          className="mt-2 text-center text-sm text-red-500"
        >
          {wallet.error}
        </p>
      )}
    </div>
  );
}
