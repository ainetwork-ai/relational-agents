"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2, Eye, EyeOff } from "lucide-react";
import { useDb } from "./database-block";

/** Per-view property visibility: toggle any property shown/hidden in the
 * active view. Persisted in ViewConfig.hiddenProperties; every view
 * (table/board/list/gallery/calendar) respects it. */
export function ViewOptions() {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hidden = db.activeView.config.hiddenProperties ?? [];

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

  function toggle(propId: string) {
    const set = new Set(hidden);
    if (set.has(propId)) set.delete(propId);
    else set.add(propId);
    db.patchView({ ...db.activeView.config, hiddenProperties: [...set] });
  }

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="db-view-options"
        onClick={() => setOpen((v) => !v)}
        data-tip="View settings"
        aria-label="Properties"
        className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
          hidden.length
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
            : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        }`}
      >
        <Settings2 size={14} />
        {hidden.length > 0 && <span className="text-[10px] font-semibold">{hidden.length}</span>}
      </button>
      {open && (
        <div className="popover-anim absolute right-0 top-8 z-40 w-52 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          {/* Group by lives in view options — not a strip above the view */}
          <span className="block px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-400">
            Group by
          </span>
          <select
            data-testid="db-group-by-select"
            value={db.activeView.config.groupByPropertyId ?? ""}
            onChange={(e) =>
              db.patchView({
                ...db.activeView.config,
                groupByPropertyId: e.target.value || undefined,
              })
            }
            className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-xs text-neutral-600 outline-none dark:border-neutral-600 dark:text-neutral-300"
          >
            <option value="">None</option>
            {db.properties
              .filter((p) => (p.config.options?.length ?? 0) > 0 || p.type === "select" || p.type === "status")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <span className="block px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-400">
            Properties
          </span>
          {db.properties.map((p) => {
            const isHidden = hidden.includes(p.id);
            return (
              <button
                key={p.id}
                data-testid={`db-prop-visToggle-${p.id}`}
                onClick={() => toggle(p.id)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <span className="truncate">{p.name}</span>
                {isHidden ? (
                  <EyeOff size={13} className="text-neutral-400" />
                ) : (
                  <Eye size={13} className="text-blue-500" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
