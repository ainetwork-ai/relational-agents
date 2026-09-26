"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/provider";
import { LanguageSwitch } from "@/components/language-switch";

import { getInjectedProvider } from "@/lib/wallet/provider";
import { signInWithAindrive } from "@/lib/aindrive-client";

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
  not_configured: "Google sign-in is not configured on this server.",
  cancelled: "Sign-in was cancelled.",
  bad_state: "The sign-in link has expired. Please try again.",
  email_unverified: "Your Google account's email address is not verified.",
  signin_failed: "Sign-in failed. Please try again.",
};

export function LoginForm() {
  const router = useRouter();
  const t = useT();
  const [privateKey, setPrivateKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"demo" | "key" | "metamask" | "aindrive" | null>(null);
  const [aindriveWaiting, setAindriveWaiting] = useState(false);

  // aindrive's approval page in a popup — signed in there already, one click —
  // and this browser is signed in here with that aindrive account connected
  async function loginWithAindrive() {
    setBusy("aindrive");
    setError(null);
    const ok = await signInWithAindrive((s) => setAindriveWaiting(s === "waiting"));
    setAindriveWaiting(false);
    if (ok) {
      // signed in: next, which of the account's folders the team gets to see
      window.location.href = "/aindrive/share?next=/";
      return;
    }
    setBusy(null);
    setError(t("aindrive sign-in didn't complete. Please try again."));
  }
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
            {t("Think, write, all in one place.")}
          </p>
          <LanguageSwitch className="mt-3" />
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
          {t("Continue with Google")}
        </a>

        <button
          data-testid="aindrive-login-button"
          onClick={() => void loginWithAindrive()}
          disabled={busy !== null}
          className="mt-2.5 flex w-full items-center justify-center gap-2.5 rounded-md border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="12" x2="2" y2="12" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            <line x1="6" y1="16" x2="6.01" y2="16" />
            <line x1="10" y1="16" x2="10.01" y2="16" />
          </svg>
          {busy === "aindrive"
            ? aindriveWaiting
              ? t("Approve in the aindrive window…")
              : t("Opening…")
            : t("Sign in with aindrive")}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-neutral-400">
          {t("Signing in makes all your aindrive drives available right away.")}
        </p>

        <div className="my-6 flex items-center gap-3 text-xs text-neutral-400">
          <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          {t("or with a wallet")}
          <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </div>

        <button
          data-testid="demo-login-button"
          onClick={() => login("/api/auth/demo-login")}
          disabled={busy !== null}
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {busy === "demo" ? t("Signing in…") : t("Start with the demo account")}
        </button>
        <DemoFamily onPick={(member) => login("/api/auth/demo-login", { member })} disabled={busy !== null} />

        <input
          data-testid="display-name-input"
          type="text"
          placeholder={t("Display name (optional)")}
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
          {busy === "metamask" ? t("Waiting for MetaMask…") : t("Sign in with MetaMask")}
        </button>

        <div className="mt-2.5 space-y-2.5">
          <input
            data-testid="key-input"
            type="password"
            placeholder={t("Private key (hex)")}
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
            {busy === "key" ? t("Signing in…") : t("Sign in with key")}
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

/** "As another family member": the demo account's family, one click each — for showing a
 *  scenario from Grandma's or Seoyeon's side without a second browser. */
function DemoFamily({ onPick, disabled }: { onPick: (member: string) => void; disabled: boolean }) {
  const t = useT();
  const [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/demo-login")
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d: { members?: string[] }) => alive && setMembers(d.members ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!members.length) return null;
  return (
    <p data-testid="demo-family" className="mt-1.5 flex flex-wrap items-center justify-center gap-1 text-[11px] text-neutral-400">
      {t("As another family member:")}
      {members.map((m) => (
        <button
          key={m}
          type="button"
          data-testid={`demo-member-${m}`}
          disabled={disabled}
          onClick={() => onPick(m)}
          className="rounded px-1.5 py-0.5 text-neutral-600 underline-offset-2 hover:bg-neutral-100 hover:underline disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {m}
        </button>
      ))}
    </p>
  );
}
