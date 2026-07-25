"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, Search, Trash2 } from "lucide-react";
import { usePagesStore } from "@/stores/pages";
import { useUiStore } from "@/stores/ui";
import { PageIcon } from "@/components/page-icon";

/** Notion puts Trash in a floating panel anchored next to the sidebar
 * (with its own search box), not a centered modal. */
export function TrashModal() {
  const open = useUiStore((s) => s.trashOpen);
  const setOpen = useUiStore((s) => s.setTrashOpen);
  const archived = usePagesStore((s) => s.archived);
  const loadArchived = usePagesStore((s) => s.loadArchived);
  const restorePage = usePagesStore((s) => s.restorePage);
  const deleteForever = usePagesStore((s) => s.deleteForever);
  const [q, setQ] = useState("");
  // two-step confirm for the irreversible delete
  const [armed, setArmed] = useState<string | null>(null);
  const [left, setLeft] = useState(248);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    loadArchived();
    // deferred so no setState runs synchronously in the effect body
    void Promise.resolve().then(() => {
      setQ("");
      const aside = document.querySelector("aside");
      if (aside) setLeft(Math.round(aside.getBoundingClientRect().right) + 8);
    });
  }, [open, loadArchived]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // the sidebar Trash button manages its own open state
      if (t.closest?.('[data-testid="trash-button"]')) return;
      if (!ref.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, setOpen]);

  if (!open) return null;

  const items = Object.values(archived)
    .filter((p) => !q || (p.title || "Untitled").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

  return createPortal(
    <div
      ref={ref}
      data-testid="trash-modal"
      style={{ left }}
      className="popover-anim fixed bottom-10 z-50 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
    >
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-700">
        <Search size={14} className="shrink-0 text-neutral-400" />
        <input
          autoFocus
          data-testid="trash-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search pages in Trash"
          className="w-full bg-transparent text-sm text-neutral-700 outline-none placeholder:text-neutral-400 dark:text-neutral-200"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-neutral-400">
            {q ? "No results" : "Trash is empty"}
          </p>
        ) : (
          items.map((p) => (
            <div
              key={p.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700/50"
            >
              <span><PageIcon icon={p.icon} fallback="📄" /></span>
              <span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span>
              <button
                data-testid={`trash-restore-${p.id}`}
                onClick={() => restorePage(p.id)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 opacity-0 transition-all hover:bg-neutral-200 group-hover:opacity-100 dark:hover:bg-neutral-600"
              >
                <RotateCcw size={12} /> Restore
              </button>
              <button
                data-testid={`trash-delete-${p.id}`}
                onClick={() => {
                  if (armed === p.id) {
                    setArmed(null);
                    deleteForever(p.id);
                  } else {
                    setArmed(p.id);
                  }
                }}
                onBlur={() => setArmed((a) => (a === p.id ? null : a))}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-all ${
                  armed === p.id
                    ? "bg-red-500 text-white opacity-100 hover:bg-red-600"
                    : "text-red-500 opacity-0 hover:bg-red-50 group-hover:opacity-100 dark:hover:bg-red-900/30"
                }`}
              >
                <Trash2 size={12} /> {armed === p.id ? "Delete forever?" : "Delete"}
              </button>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400 dark:border-neutral-700">
        Pages in Trash for over 30 days will be automatically deleted
      </div>
    </div>,
    document.body
  );
}
