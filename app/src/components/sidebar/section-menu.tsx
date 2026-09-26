"use client";

import {useRef, useState} from "react";
import { createPortal } from "react-dom";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";
import { MoreHorizontal } from "lucide-react";
import { useUiStore, type SidebarSort } from "@/stores/ui";
import { useT } from "@/i18n/provider";

const SORTS: { value: SidebarSort; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "alpha", label: "Name" },
  { value: "edited", label: "Last edited" },
];

/**
 * The "..." on a sidebar section header — Notion's Open menu.
 *
 * Shared by Private and Teamspaces so the two headers cannot drift apart. Every
 * item here does something: the sort applies to the rows below (and is
 * remembered per browser), and Collapse all folds the tree back up. A menu of
 * placeholders would be worse than no menu.
 */
export function SectionMenu({ testId, label }: { testId: string; label: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const sort = useUiStore((s) => s.sidebarSort);
  const setSort = useUiStore((s) => s.setSidebarSort);
  const collapseAll = useUiStore((s) => s.collapseAll);

 // portalled and placed — inside the sidebar's scroller this was cut off near
 // the bottom of the list. Click-away/Escape via useDismiss, both refs inside.
  useAnchored(open, btnRef, popRef, { align: "end" });
  useDismiss(open, () => setOpen(false), btnRef, popRef);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
        aria-label={t("{label} options", { label })}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded p-0.5 text-neutral-400 max-md:p-2 touch-reveal opacity-0 transition-all hover:bg-neutral-200/60 hover:text-neutral-600 focus-visible:opacity-100 group-hover/section:opacity-100 dark:hover:bg-neutral-700"
      >
        <MoreHorizontal size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="menu"
            data-testid={`${testId}-popover`}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 w-44 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
          >
          <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-400">{t("Sort")}</p>
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
              {t(s.label)}
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
            {t("Collapse all")}
          </button>
          </div>,
          document.body
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
