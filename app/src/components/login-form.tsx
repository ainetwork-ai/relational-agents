"use client";

/**
 * Sign-in screen.
 *
 * The wallet-era methods (demo login, MetaMask, AIN private key) are gone —
 * identity is moving to Google. Until that lands there is deliberately no way
 * in from this screen: a disabled button that looks like a login is worse than
 * an honest empty state, because it sends people looking for the reason.
 */
export function LoginForm() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffefc] dark:bg-[#191919]">
      <div className="w-full max-w-sm px-6">
        <div className="text-center">
          <div className="mb-3 text-4xl">📝</div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Relational Memory
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            Think it. Write it. All in one place.
          </p>
          <p
            data-testid="signin-unavailable"
            className="mt-10 text-sm text-neutral-500 dark:text-neutral-400"
          >
            Sign-in is being reconnected. Please check back shortly.
          </p>
        </div>
      </div>
    </main>
  );
}
