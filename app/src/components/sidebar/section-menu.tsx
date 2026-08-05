"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useUiStore, type SidebarSort } from "@/stores/ui";

const SORTS: { value: SidebarSort; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "alpha", label: "Name" },
  { value: "edited", label: "Last edited" },
];

/**
 * The "..." on a sidebar section header — Notion's 메뉴 열기.
 *
 * Shared by Private and Teamspaces so the two headers cannot drift apart. Every
 * item here does something: the sort applies to the rows below (and is
 * remembered per browser), and Collapse all folds the tree back up. A menu of
 * placeholders would be worse than no menu.
 */
export function SectionMenu({ testId, label }: { testId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sort = useUiStore((s) => s.sidebarSort);
  const setSort = useUiStore((s) => s.setSidebarSort);
  const collapseAll = useUiStore((s) => s.collapseAll);

  // Click-away and Escape, the same pair the page-row menu uses.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
        aria-label={`${label} options`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded p-0.5 text-neutral-400 opacity-0 transition-all hover:bg-neutral-200/60 hover:text-neutral-600 focus-visible:opacity-100 group-hover/section:opacity-100 dark:hover:bg-neutral-700"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          data-testid={`${testId}-popover`}
          className="popover-anim absolute right-0 top-6 z-50 w-44 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        >
          <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-400">Sort</p>
          {SORTS.map((s) => (
            <button
              key={s.value}
              role="menuitemradio"
              aria-checked={sort === s.value}
              data-testid={`${testId}-sort-${s.value}`}
              onClick={() => {
                setSort(s.value);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {s.label}
              {sort === s.value && <span className="text-xs text-neutral-400">✓</span>}
            </button>
          ))}
          <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
          <button
            role="menuitem"
            data-testid={`${testId}-collapse-all`}
            onClick={() => {
              collapseAll();
              setOpen(false);
            }}
            className="w-full rounded px-2 py-1 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Collapse all
          </button>
        </div>
      )}
    </div>
  );
}

/** Apply the section sort. Manual keeps the stored order the rows arrive in. */
export function sortRows<T extends { title: string; updatedAt: Date | string }>(
  rows: T[],
  sort: SidebarSort
): T[] {
  if (sort === "manual") return rows;
  const copy = [...rows];
  if (sort === "alpha") {
    // localeCompare so Korean titles order the way a Korean reader expects
    return copy.sort((a, b) =>
      (a.title || "Untitled").localeCompare(b.title || "Untitled", "ko")
    );
  }
  return copy.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}
