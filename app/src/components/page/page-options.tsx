"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Maximize,
  Lock,
  Unlock,
  Copy,
  CornerUpRight,
  Download,
  History,
  Trash2,
} from "lucide-react";
import type { Page } from "@/lib/db/schema";
import { usePagesStore } from "@/stores/pages";
import { useToastStore } from "@/stores/toast";
import { PageIcon } from "@/components/page-icon";
import { PageHistoryModal } from "./page-history-modal";
import { useT } from "@/i18n/provider";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The  page "..." menu: Full width, Lock, Duplicate, Move to, 휴지통으로 이동, Export.
 *
 * 원본 실측은 docs/notion-page-delete.md — 카드 256 / radius 10, 삭제 항목은
 * `옮기기` 바로 다음이고 그 뒤에 구분선이 온다. 라벨은 `삭제`가 아니라
 * **휴지통으로 이동**이며 **빨강이 아니다**(14px/400/rgb(44,44,43), 다른 항목과
 * 같은 잉크). 사이드바 행 메뉴의 빨간 `danger` 관례는 여기로 가져오지 않는다. */
export function PageOptionsMenu({
  page,
  onDeleted,
}: {
  page: Page;
  /** 이 페이지를 담고 있던 화면을 닫거나 떠나는 일 — 전체 페이지는 router.push("/"),
   *  가운데 피크와 행 사이드 피크는 각자의 onClose. 지운 페이지 위에 그대로 남아
   *  있지 않도록 각 화면이 자기 방식을 건네준다(메뉴는 피크를 알지 못한다). */
  onDeleted?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const updatePage = usePagesStore((s) => s.updatePage);
  const archivePage = usePagesStore((s) => s.archivePage);
  const restorePage = usePagesStore((s) => s.restorePage);
  const allPages = usePagesStore((s) => s.pages);
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const isPostgres = UUID_RE.test(page.id);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    setOpen((v) => !v);
    setMoveOpen(false);
    setQ("");
  }

 // move-to candidates: any other page that isn't inside this page's subtree
  const candidates = Object.values(allPages)
    .filter((p) => p.id !== page.id && !p.isArchived)
    .filter((p) => {
      let cur: Page | undefined = p;
      for (let i = 0; i < 50 && cur; i++) {
        if (cur.parentPageId === page.id) return false;
        cur = cur.parentPageId ? allPages[cur.parentPageId] : undefined;
      }
      return true;
    })
    .filter((p) => (p.title || t("제목 없음")).toLowerCase().includes(q.toLowerCase()))
    .slice(0, 12);

  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700";

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="page-options"
        data-tip={t("더 보기")}
        onClick={toggle}
        aria-label={t("페이지 옵션")}
        className="flex items-center rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="popover-anim absolute right-0 top-8 z-50 w-[256px] rounded-[10px] border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <button
            data-testid="page-opt-fullwidth"
            onClick={() => void updatePage(page.id, { fullWidth: !page.fullWidth })}
            className={item}
          >
            <Maximize size={14} /> {t("전체 너비")}
            <span className="ml-auto text-xs text-neutral-400">{page.fullWidth ? t("켜짐") : t("꺼짐")}</span>
          </button>
          <button
            data-testid="page-opt-lock"
            onClick={() => {
              setOpen(false);
              void updatePage(page.id, { isLocked: !page.isLocked });
            }}
            className={item}
          >
            {page.isLocked ? <Unlock size={14} /> : <Lock size={14} />}
            {page.isLocked ? t("페이지 잠금 해제") : t("페이지 잠금")}
          </button>
          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />
          {isPostgres && (
            <button
              data-testid="page-opt-duplicate"
              onClick={async () => {
                setOpen(false);
                const res = await fetch(`/api/pages/${page.id}/duplicate`, { method: "POST" });
                if (!res.ok) return;
                const { page: copy } = await res.json();
                await usePagesStore.getState().load();
                router.push(`/p/${copy.id}`);
              }}
              className={item}
            >
              <Copy size={14} /> {t("복제")}
            </button>
          )}
          {isPostgres && (
            <button
              data-testid="page-opt-moveto"
              onClick={() => setMoveOpen((v) => !v)}
              className={item}
            >
              <CornerUpRight size={14} /> {t("옮기기")}
            </button>
          )}
          {moveOpen && (
            <div className="border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
              <input
                data-testid="page-move-search"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("페이지 이동 위치…")}
                className="mb-1 w-full rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
              />
              <div className="max-h-44 overflow-y-auto">
                <button
                  data-testid="page-move-to-root"
                  onClick={() => {
                    setOpen(false);
                    void updatePage(page.id, { parentPageId: null });
                  }}
                  className="block w-full rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  {t("워크스페이스 최상위")}
                </button>
                {candidates.map((p) => (
                  <button
                    key={p.id}
                    data-testid={`page-move-to-${p.id}`}
                    onClick={() => {
                      setOpen(false);
                      void updatePage(page.id, { parentPageId: p.id });
                    }}
                    className="block w-full truncate rounded px-2 py-1 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    {p.icon ? <><PageIcon icon={p.icon} />{" "}</> : ""}
                    {p.title || t("제목 없음")}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* 휴지통으로 이동 — 원본에서 `옮기기` 바로 다음, 그 뒤가 구분선(아래 것).
              OKF(비 UUID) 페이지는 소프트 삭제가 아무 일도 하지 않으므로 복제·옮기기와
              같은 조건으로 숨긴다 — 눌러도 조용한 항목보다 없는 편이 낫다. */}
          {isPostgres && (
            <button
              data-testid="page-opt-delete"
              onClick={async () => {
                setOpen(false);
                const toast = useToastStore.getState();
                // the server asks for "full": a page shared to you at a lower
                // level is refused, and then nothing was deleted — say so and
                // stay on the page instead of closing it over a success toast
                if (!(await archivePage(page.id))) {
                  toast.show(t("휴지통으로 이동하지 못했습니다"));
                  return;
                }
                toast.show(t("휴지통으로 이동했습니다"), { onUndo: () => restorePage(page.id) });
                onDeleted?.();
              }}
              className={item}
            >
              <Trash2 size={14} /> {t("휴지통으로 이동")}
            </button>
          )}
          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />
          <a
            data-testid="page-opt-export"
            href={`/api/pages/${page.id}/export`}
            download
            onClick={() => setOpen(false)}
            className={item}
          >
            <Download size={14} /> {t("Markdown 내보내기")}
          </a>
          <a
            data-testid="page-opt-export-pdf"
            href={`/api/pages/${page.id}/export-pdf`}
            download
            onClick={() => setOpen(false)}
            className={item}
          >
            <Download size={14} /> {t("PDF 내보내기")}
          </a>
          <button
            data-testid="page-opt-history"
            onClick={() => {
              setOpen(false);
              setHistoryOpen(true);
            }}
            className={item}
          >
            <History size={14} /> {t("페이지 기록")}
          </button>
        </div>
      )}
      {historyOpen && (
        <PageHistoryModal pageId={page.id} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
}
