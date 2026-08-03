"use client";

import { useSearchParams } from "next/navigation";

/**
 * Sign-in screen. One way in: Google.
 *
 * The button is a link, not a fetch — /api/auth/google/start answers with a
 * redirect to Google's consent screen, so signing in needs no client-side
 * JavaScript and no CORS. Failures come back as ?error=<reason> from the
 * callback (the real cause is in the server log, never in the URL).
 */
const MESSAGES: Record<string, string> = {
  not_configured: "Google sign-in is not configured on this server.",
  cancelled: "Sign-in was cancelled.",
  bad_state: "That sign-in link expired. Please try again.",
  email_unverified: "Your Google account's email address is not verified.",
  signin_failed: "Sign-in failed. Please try again.",
};

export function LoginForm() {
  const error = useSearchParams().get("error");
  const message = error ? (MESSAGES[error] ?? MESSAGES.signin_failed) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffefc] dark:bg-[#191919]">
      <div className="w-full max-w-sm px-6">
        <div className="mb-10 text-center">
          <div className="mb-3 text-4xl">📝</div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Relational Memory
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            Think it. Write it. All in one place.
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
          Sign in with Google
        </a>

        {message && (
          <p data-testid="login-error" className="mt-4 text-center text-sm text-red-500">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
