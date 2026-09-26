import Link from "next/link";
import { getT } from "@/i18n/server";

export default async function RootNotFound() {
  const t = await getT();
  return (
    <main
      data-testid="page-not-found"
      className="flex min-h-screen flex-col items-center justify-center bg-white text-center dark:bg-[#191919]"
    >
      <p className="text-5xl">🧭</p>
      <h1 className="mt-4 text-lg font-medium text-neutral-700 dark:text-neutral-300">
        {t("This page doesn't exist")}
      </h1>
      <p className="mt-1 text-sm text-neutral-400">
        {t("The link may be invalid or the page may have been deleted.")}
      </p>
      <Link
        href="/"
        className="mt-5 rounded-md border border-neutral-200 px-4 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {t("Go to Home")}
      </Link>
    </main>
  );
}
