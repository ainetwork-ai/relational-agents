"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, X, Plus } from "lucide-react";
import type { ViewSort } from "@/lib/db/schema";
import { useDb } from "./database-block";

const selectCls =
  "rounded border border-neutral-200 bg-white px-1.5 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200";

/** General sort builder: any property, ascending or descending, multi-key. */
export function SortBar() {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sorts = db.activeView.config.sorts ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function commit(next: ViewSort[]) {
    db.patchView({ ...db.activeView.config, sorts: next }, { draft: true });
  }
  function update(i: number, patch: Partial<ViewSort>) {
    commit(sorts.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addSort() {
    const prop = db.properties[0];
    if (!prop) return;
    commit([...sorts, { propertyId: prop.id, dir: "asc" }]);
  }

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="db-sort"
        data-tip="Sort"
        aria-label="Sort"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
          sorts.length
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
            : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        }`}
      >
        <ArrowUpDown size={14} />
        {sorts.length > 0 && <span className="text-[10px] font-semibold">{sorts.length}</span>}
      </button>
      {open && (
        <div className="popover-anim absolute right-0 top-8 z-40 w-80 rounded-lg border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          {sorts.length === 0 && (
            <p className="px-1 py-2 text-xs text-neutral-400">No sorts yet.</p>
          )}
          {sorts.map((s, i) => (
            <div key={i} className="mb-1 flex items-center gap-1">
              <select
                data-testid={`db-sort-prop-${i}`}
                value={s.propertyId}
                onChange={(e) => update(i, { propertyId: e.target.value })}
                className={selectCls}
              >
                {db.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                data-testid={`db-sort-dir-${i}`}
                value={s.dir}
                onChange={(e) => update(i, { dir: e.target.value as "asc" | "desc" })}
                className={selectCls}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button
                data-testid={`db-sort-remove-${i}`}
                onClick={() => commit(sorts.filter((_, idx) => idx !== i))}
                className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-700"
                aria-label="Remove sort"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            data-testid="db-sort-add"
            onClick={addSort}
            className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <Plus size={12} /> Add sort
          </button>
        </div>
      )}
    </div>
  );
}
