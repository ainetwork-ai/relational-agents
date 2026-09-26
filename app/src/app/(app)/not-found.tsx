import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div
      data-testid="page-not-found"
      className="flex h-full flex-col items-center justify-center text-center"
    >
      <FileQuestion size={40} className="mb-4 text-neutral-300 dark:text-neutral-600" />
      <h2 className="text-lg font-medium text-neutral-700 dark:text-neutral-300">
        {t("Page not found")}
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        {t("It may have been deleted or the link may be invalid.")}
      </p>
      <Link
        href="/"
        className="mt-5 rounded-md border border-neutral-200 px-4 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {t("Back to Home")}
      </Link>
    </div>
  );
}
