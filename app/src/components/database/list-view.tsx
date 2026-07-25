"use client";

import { Plus } from "lucide-react";
import type { DbView } from "@/lib/db/schema";
import { applyView, groupRowsBy } from "@/lib/db-values";
import { useDb } from "./database-block";
import { PropertyValue } from "./property-value";

/** Compact list: title line + inline chips for the non-title properties.
 * Supports the shared group-by (select/status → labelled sections). */
export function ListView({ view }: { view: DbView }) {
  const db = useDb();
  const visible = applyView(db.rows, db.properties, view.config, db.me, db.related);
  const titleProp = db.properties.find((p) => p.type === "title");
  const hidden = view.config.hiddenProperties ?? [];
  const rest = db.properties.filter((p) => p.type !== "title" && !hidden.includes(p.id));
  const groupable = db.properties.filter((p) => p.type === "select" || p.type === "status");
  const groupProp = groupable.find((p) => p.id === view.config.groupByPropertyId);
  const groups = groupRowsBy(visible, groupProp);

  const renderRow = (row: (typeof visible)[number]) => (
    <div
      key={row.id}
      data-testid={`db-list-row-${row.id}`}
      className="flex items-center gap-3 border-b border-neutral-100 px-2 py-1.5 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/30"
    >
      <span className="min-w-[8rem] text-sm text-neutral-800 dark:text-neutral-100">
        {(titleProp && (row.values[titleProp.id] as string)) || "Untitled"}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {rest.map((p) => (
          <span key={p.id} data-testid={`db-list-cell-${row.id}-${p.id}`} className="inline-flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-neutral-300 dark:text-neutral-600">
              {p.name}
            </span>
            <PropertyValue prop={p} row={row} />
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="w-full">
      
      {groups
        ? groups.map((g) =>
            g.rows.length === 0 ? null : (
              <div key={g.key}>
                <div
                  data-testid={`db-list-group-${g.key}`}
                  className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50/70 px-2 py-1 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-400"
                >
                  <span>{g.label}</span>
                  <span className="text-neutral-300 dark:text-neutral-600">{g.rows.length}</span>
                </div>
                {g.rows.map(renderRow)}
              </div>
            )
          )
        : visible.map(renderRow)}
      <button
        data-testid="db-add-row"
        onClick={() => db.addRow()}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        <Plus size={13} /> New
      </button>
    </div>
  );
}
