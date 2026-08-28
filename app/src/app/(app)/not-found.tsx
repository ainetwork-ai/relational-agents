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
        {t("페이지를 찾을 수 없습니다")}
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        {t("삭제되었거나 링크가 잘못되었을 수 있습니다.")}
      </p>
      <Link
        href="/"
        className="mt-5 rounded-md border border-neutral-200 px-4 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {t("홈으로 돌아가기")}
      </Link>
    </div>
  );
}
