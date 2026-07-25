import Link from "next/link";

export default function RootNotFound() {
  return (
    <main
      data-testid="page-not-found"
      className="flex min-h-screen flex-col items-center justify-center bg-white text-center dark:bg-[#191919]"
    >
      <p className="text-5xl">🧭</p>
      <h1 className="mt-4 text-lg font-medium text-neutral-700 dark:text-neutral-300">
        This page doesn&apos;t exist
      </h1>
      <p className="mt-1 text-sm text-neutral-400">
        The link may be wrong, or the page was removed.
      </p>
      <Link
        href="/"
        className="mt-5 rounded-md border border-neutral-200 px-4 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        Go home
      </Link>
    </main>
  );
}
