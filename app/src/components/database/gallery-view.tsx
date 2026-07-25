"use client";

import { Plus } from "lucide-react";
import type { DbView } from "@/lib/db/schema";
import { applyView, groupRowsBy } from "@/lib/db-values";
import { resolveAppUrl } from "@/lib/compat";
import { useDb } from "./database-block";
import { PropertyValue } from "./property-value";

/** Card grid: each row is a card with its title and property values stacked.
 *  Supports the shared group-by (select/status → labelled sections). */
export function GalleryView({ view }: { view: DbView }) {
  const db = useDb();
  const visible = applyView(db.rows, db.properties, view.config, db.me, db.related);
  const titleProp = db.properties.find((p) => p.type === "title");
  const hidden = view.config.hiddenProperties ?? [];
  const shown = db.properties.filter((p) => p.type !== "title" && !hidden.includes(p.id));
  // visible url properties become card ACTION BUTTONS (call / message / docs …)
  // — except the one already consumed as the card cover
  const rest = shown.filter((p) => p.type !== "url");
  const groupable = db.properties.filter((p) => p.type === "select" || p.type === "status");
  const groupProp = groupable.find((p) => p.id === view.config.groupByPropertyId);
  const groups = groupRowsBy(visible, groupProp);
  // card cover: the first url/files property's value (Notion's gallery cover).
  const coverProp = db.properties.find((p) => p.type === "url" || p.type === "files");
  const coverOf = (values: Record<string, unknown>): string | null => {
    if (!coverProp) return null;
    const v = values[coverProp.id];
    const url = Array.isArray(v) ? (v[0] as string) : (v as string);
    return typeof url === "string" && url ? url : null;
  };

  const renderCard = (row: (typeof visible)[number]) => (
    <div
      key={row.id}
      data-testid={`db-gallery-card-${row.id}`}
      onClick={() => db.openRow(row.id)}
      className="cursor-pointer overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow dark:border-neutral-700 dark:bg-neutral-800"
    >
      {coverOf(row.values) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-testid={`db-gallery-cover-${row.id}`}
          src={coverOf(row.values)!}
          alt=""
          className="h-24 w-full object-cover"
        />
      )}
      <div className="p-3">
        <div className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
          {(titleProp && (row.values[titleProp.id] as string)) || "Untitled"}
        </div>
        <div className="flex flex-col gap-1.5">
          {rest.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5">
              <span className="w-16 shrink-0 truncate text-xs text-neutral-400">{p.name}</span>
              <PropertyValue prop={p} row={row} />
            </div>
          ))}
        </div>
        {(() => {
          const actions = shown.filter(
            (p) => p.type === "url" && typeof row.values[p.id] === "string" && row.values[p.id]
          );
          if (!actions.length) return null;
          return (
            <div className="mt-2.5 flex gap-1.5">
              {actions.map((p) => (
                <button
                  key={p.id}
                  data-testid={`db-gallery-action-${row.id}-${p.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(resolveAppUrl(row.values[p.id] as string), "_blank", "noopener");
                  }}
                  className="flex-1 rounded-md border border-neutral-200 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:border-neutral-700 dark:text-blue-400 dark:hover:bg-blue-500/10"
                >
                  {p.name}
                </button>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );

  const grid = (rows: typeof visible, withAdd: boolean) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
      {rows.map(renderCard)}
      {withAdd && (
        <button
          data-testid="db-add-row"
          onClick={() => db.addRow()}
          className="flex min-h-[80px] items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-200 text-xs text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-600 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <Plus size={13} /> New
        </button>
      )}
    </div>
  );

  return (
    <div className="w-full">
      
      {groups ? (
        <>
          {groups.map((g) =>
            g.rows.length === 0 ? null : (
              <div key={g.key} className="mb-3">
                <div
                  data-testid={`db-gallery-group-${g.key}`}
                  className="mb-1.5 flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400"
                >
                  <span>{g.label}</span>
                  <span className="text-neutral-300 dark:text-neutral-600">{g.rows.length}</span>
                </div>
                {grid(g.rows, false)}
              </div>
            )
          )}
          {grid([], true)}
        </>
      ) : (
        grid(visible, true)
      )}
    </div>
  );
}
