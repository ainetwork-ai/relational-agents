"use client";

import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { usePagesStore } from "@/stores/pages";

export function EmptyHome() {
  const router = useRouter();
  const createPage = usePagesStore((s) => s.createPage);

  return (
    <div
      data-testid="empty-home"
      className="flex h-full flex-col items-center justify-center text-center"
    >
      <FileText size={40} className="mb-4 text-neutral-300 dark:text-neutral-600" />
      <h2 className="text-lg font-medium text-neutral-700 dark:text-neutral-300">
        No pages yet
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        Create your first page to get started.
      </p>
      <button
        data-testid="empty-home-new-page"
        onClick={async () => {
          const page = await createPage(null);
          router.push(`/p/${page.id}`);
        }}
        className="mt-5 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        New page
      </button>
    </div>
  );
}
