"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useT } from "@/i18n/provider";

import { getInjectedProvider } from "@/lib/wallet/provider";

// Two login families share this screen. Google is the everyday door (a link,
// not a fetch — /api/auth/google/start redirects to the consent screen, so it
// needs no client JS and no CORS; failures come back as ?error=<reason>).
// The wallet doors (MetaMask / AIN key / demo) are the relational-chain line:
// consent contracts are signed with these identities.
//
// Provider selection lives in @/lib/wallet/provider — it prefers the real
// MetaMask via EIP-6963, since Coinbase Wallet and friends fight over
// `window.ethereum`.

/** utf8 → 0x-hex, the message encoding MetaMask's personal_sign expects. */
function toHexMessage(message: string): string {
  return (
    "0x" +
    Array.from(new TextEncoder().encode(message))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

const GOOGLE_MESSAGES: Record<string, string> = {
  not_configured: "이 서버에는 Google 로그인이 설정되어 있지 않습니다.",
  cancelled: "로그인이 취소되었습니다.",
  bad_state: "로그인 링크가 만료되었습니다. 다시 시도해 주세요.",
  email_unverified: "Google 계정의 이메일 주소가 인증되지 않았습니다.",
  signin_failed: "로그인에 실패했습니다. 다시 시도해 주세요.",
};

export function LoginForm() {
  const router = useRouter();
  const t = useT();
  const [privateKey, setPrivateKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"demo" | "key" | "metamask" | null>(null);
  const googleError = useSearchParams().get("error");
  const googleMessage = googleError
    ? t(GOOGLE_MESSAGES[googleError] ?? GOOGLE_MESSAGES.signin_failed)
    : null;

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
            Relational Memory
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            {t("생각하고, 쓰고, 한곳에서.")}
          </p>
        </div>

        <a
          data-testid="google-login-button"
          href="/api/auth/google/start"
          className="flex w-full items-center justify-center gap-2.5 rounded-md border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <svg aria-hidden viewBox="0 0 18 18" className="h-[18px] w-[18px]">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.32Z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58Z"
            />
          </svg>
          {t("Google로 로그인")}
        </a>

        <div className="my-6 flex items-center gap-3 text-xs text-neutral-400">
          <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          {t("또는 지갑으로")}
          <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </div>

        <button
          data-testid="demo-login-button"
          onClick={() => login("/api/auth/demo-login")}
          disabled={busy !== null}
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {busy === "demo" ? t("로그인 중…") : t("데모 계정으로 시작")}
        </button>

        <input
          data-testid="display-name-input"
          type="text"
          placeholder={t("표시 이름 (선택)")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-2.5 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />

        <button
          data-testid="metamask-login-button"
          onClick={loginWithMetamask}
          disabled={busy !== null}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <span aria-hidden className="text-base">🦊</span>
          {busy === "metamask" ? t("MetaMask 대기 중…") : t("MetaMask로 로그인")}
        </button>

        <div className="mt-2.5 space-y-2.5">
          <input
            data-testid="key-input"
            type="password"
            placeholder={t("프라이빗 키 (hex)")}
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
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
            {busy === "key" ? t("로그인 중…") : t("키로 로그인")}
          </button>
        </div>

        {(error || googleMessage) && (
          <p data-testid="login-error" className="mt-4 text-center text-sm text-red-500">
            {error ?? googleMessage}
          </p>
        )}
      </div>
    </main>
  );
}
