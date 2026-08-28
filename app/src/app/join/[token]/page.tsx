"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** The invite landing page. Lives OUTSIDE the (app) auth gate: a logged-out
 * visitor must see who invited them and a way in, not a silent bounce to
 * /login that drops the token. The URL itself is the invite's state — the
 * sign-in round-trip returns here (start?returnTo=…), and every failure path
 * lands back here with the token intact.
 *
 * Signed-in visitors join automatically: clicking the link was the consent. */

type Phase = "loading" | "signin" | "joining" | "invalid" | "failed";

const AUTH_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  email_unverified: "This Google account's email address isn't verified.",
};

export default function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [authError, setAuthError] = useState<string | null>(null);
  const ran = useRef(false);

  async function join() {
    setPhase("joining");
    const res = await fetch(`/api/invite/${token}`, { method: "POST" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setPhase(res.status === 404 ? "invalid" : "failed");
    }
  }

  useEffect(() => {
 // the join POST must fire exactly once (StrictMode re-runs effects)
    if (ran.current) return;
    ran.current = true;
 // a failed sign-in bounced back here with ?error=<reason>
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setAuthError(AUTH_ERRORS[err] ?? "Sign-in didn't complete. Please try again.");
    (async () => {
      const [invite, me] = await Promise.all([
        fetch(`/api/invite/${token}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/auth/me`).then((r) => (r.ok ? r.json() : { user: null })),
      ]);
      if (!invite?.workspaceName) {
        setPhase("invalid");
        return;
      }
      setWorkspaceName(invite.workspaceName);
      if (!me?.user) {
        setPhase("signin");
        return;
      }
      await join();
    })();
 // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-8 dark:bg-[#191919]">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
        {phase === "invalid" ? (
          <>
            <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
              This invite link is invalid or has expired.
            </p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Ask the person who invited you for a new link.
            </p>
          </>
        ) : phase === "loading" || phase === "joining" ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {phase === "joining" ? `Joining ${workspaceName ?? "workspace"}…` : "Loading…"}
          </p>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Join {workspaceName ?? "workspace"}
            </h1>
            <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
              You&apos;ve been invited to collaborate.
            </p>
            {authError && (
              <p
                data-testid="join-auth-error"
                className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
              >
                {authError}
              </p>
            )}
            {phase === "failed" ? (
              <button
                data-testid="join-retry"
                onClick={join}
                className="w-full rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                Couldn&apos;t join — try again
              </button>
            ) : (
              <a
                data-testid="join-signin"
                href={`/api/auth/google/start?returnTo=${encodeURIComponent(`/join/${token}`)}`}
                className="block w-full rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                Continue with Google
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
