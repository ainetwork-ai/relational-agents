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
} from "lucide-react";
import type { Page } from "@/lib/db/schema";
import { usePagesStore } from "@/stores/pages";
import { PageIcon } from "@/components/page-icon";
import { PageHistoryModal } from "./page-history-modal";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The  page "..." menu: Full width, Lock, Duplicate, Move to, Export. */
export function PageOptionsMenu({ page }: { page: Page }) {
  const router = useRouter();
  const updatePage = usePagesStore((s) => s.updatePage);
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
    .filter((p) => (p.title || "Untitled").toLowerCase().includes(q.toLowerCase()))
    .slice(0, 12);

  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700";

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="page-options"
        data-tip="More actions"
        onClick={toggle}
        aria-label="Page options"
        className="flex items-center rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="popover-anim absolute right-0 top-8 z-50 w-56 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <button
            data-testid="page-opt-fullwidth"
            onClick={() => void updatePage(page.id, { fullWidth: !page.fullWidth })}
            className={item}
          >
            <Maximize size={14} /> Full width
            <span className="ml-auto text-xs text-neutral-400">{page.fullWidth ? "On" : "Off"}</span>
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
            {page.isLocked ? "Unlock page" : "Lock page"}
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
              <Copy size={14} /> Duplicate
            </button>
          )}
          {isPostgres && (
            <button
              data-testid="page-opt-moveto"
              onClick={() => setMoveOpen((v) => !v)}
              className={item}
            >
              <CornerUpRight size={14} /> Move to
            </button>
          )}
          {moveOpen && (
            <div className="border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
              <input
                data-testid="page-move-search"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Move page to…"
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
                  Workspace root
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
                    {p.title || "Untitled"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />
          <a
            data-testid="page-opt-export"
            href={`/api/pages/${page.id}/export`}
            download
            onClick={() => setOpen(false)}
            className={item}
          >
            <Download size={14} /> Export Markdown
          </a>
          <a
            data-testid="page-opt-export-pdf"
            href={`/api/pages/${page.id}/export-pdf`}
            download
            onClick={() => setOpen(false)}
            className={item}
          >
            <Download size={14} /> Export PDF
          </a>
          <button
            data-testid="page-opt-history"
            onClick={() => {
              setOpen(false);
              setHistoryOpen(true);
            }}
            className={item}
          >
            <History size={14} /> Page history
          </button>
        </div>
      )}
      {historyOpen && (
        <PageHistoryModal pageId={page.id} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
}
