"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { getInjectedProvider } from "@/lib/wallet/provider";

// Provider selection lives in @/lib/wallet/provider — it prefers the real
// MetaMask via EIP-6963, since Coinbase Wallet and friends fight over
// `window.ethereum`. This flow still calls `request` by hand; see the note in
// that module about migrating it to viem.

/** utf8 → 0x-hex, the message encoding MetaMask's personal_sign expects. */
function toHexMessage(message: string): string {
  return (
    "0x" +
    Array.from(new TextEncoder().encode(message))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function LoginForm() {
  const router = useRouter();
  const [privateKey, setPrivateKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"demo" | "key" | "metamask" | null>(null);

  async function loginWithMetamask() {
    setBusy("metamask");
    setError(null);
    try {
      const ethereum = getInjectedProvider();
      if (!ethereum) {
        setError("MetaMask not detected. Please install the extension.");
        return;
      }
      // Force the account picker every sign-in. eth_requestAccounts reuses
      // whatever this origin already authorized, so switching accounts inside
      // MetaMask changes nothing on its own. Revoking the permission first
      // (MetaMask ≥ 12.2) guarantees the next request runs the full connect
      // flow; older wallets fall back to wallet_requestPermissions. 4001 (user
      // closed the picker) propagates to the rejection handler below.
      try {
        await ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        try {
          await ethereum.request({
            method: "wallet_requestPermissions",
            params: [{ eth_accounts: {} }],
          });
        } catch (err) {
          if ((err as { code?: number })?.code === 4001) throw err;
        }
      }
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const address = accounts?.[0];
      if (!address) {
        setError("No MetaMask account available.");
        return;
      }

      const challengeRes = await fetch("/api/auth/challenge");
      const { message } = await challengeRes.json();

      const signature = (await ethereum.request({
        method: "personal_sign",
        params: [toHexMessage(message), address],
      })) as string;

      const res = await fetch("/api/auth/metamask-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signature,
          address,
          displayName: displayName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "MetaMask login failed");
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      // 4001 = user rejected the MetaMask prompt
      const code = (err as { code?: number })?.code;
      setError(code === 4001 ? "Signature request rejected." : "MetaMask login failed");
    } finally {
      setBusy(null);
    }
  }

  async function login(path: string, body?: object, kind: "demo" | "key" = "demo") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffefc] dark:bg-[#191919]">
      <div className="w-full max-w-sm px-6">
        <div className="mb-10 text-center">
          <div className="mb-3 text-4xl">📝</div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Notion
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            Think it. Write it. All in one place.
          </p>
        </div>

        <button
          data-testid="demo-login-button"
          onClick={() => login("/api/auth/demo-login")}
          disabled={busy !== null}
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {busy === "demo" ? "Signing in…" : "Try the demo"}
        </button>

        <button
          data-testid="metamask-login-button"
          onClick={loginWithMetamask}
          disabled={busy !== null}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <span aria-hidden className="text-base">🦊</span>
          {busy === "metamask" ? "Waiting for MetaMask…" : "Sign in with MetaMask"}
        </button>

        <div className="my-6 flex items-center gap-3 text-xs text-neutral-400">
          <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          or sign in with an AIN key
          <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </div>

        <div className="space-y-2.5">
          <input
            data-testid="key-input"
            type="password"
            placeholder="Private key (hex)"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <input
            data-testid="display-name-input"
            type="text"
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button
            data-testid="key-login-button"
            onClick={() =>
              login(
                "/api/auth/key-login",
                { privateKey, displayName: displayName || undefined },
                "key"
              )
            }
            disabled={busy !== null || privateKey.length < 32}
            className="w-full rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {busy === "key" ? "Signing in…" : "Sign in with key"}
          </button>
        </div>

        {error && (
          <p data-testid="login-error" className="mt-4 text-center text-sm text-red-500">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
