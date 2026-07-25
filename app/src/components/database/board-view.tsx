"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { DbView, DbRow } from "@/lib/db/schema";
import { applyView, optionClass, personLabel } from "@/lib/db-values";
import { useDb } from "./database-block";
import { initial } from "@/lib/glyph";

const NONE = "none";

// Status option groups: columns are ordered by band and labelled with it.
const GROUP_ORDER: Record<string, number> = { todo: 0, in_progress: 1, complete: 2 };
const GROUP_LABEL: Record<string, string> = {
  todo: "To-do",
  in_progress: "In progress",
  complete: "Complete",
};

export function BoardView({ view }: { view: DbView }) {
  const db = useDb();
  const [dragging, setDragging] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);

  const groupProp = db.properties.find((p) => p.id === view.config.groupByPropertyId);
  const titleProp = db.properties.find((p) => p.type === "title");
  const personProp = db.properties.find((p) => p.type === "person");
  const groupable = db.properties.filter((p) => p.type === "select" || p.type === "status");
 // card cover: the first url/files property's value (like gallery)
  const coverProp = db.properties.find((p) => p.type === "url" || p.type === "files");
  const coverOf = (values: Record<string, unknown>): string | null => {
    if (!coverProp) return null;
    const v = values[coverProp.id];
    const url = Array.isArray(v) ? (v[0] as string) : (v as string);
    return typeof url === "string" && url ? url : null;
  };

 // lets you (re)pick the board's grouping property — without this a
 // board whose db has no status-typed column was a dead end.
 // group picker moved into ViewOptions

  if (!groupProp) {
    return (
      <div>
        <div className="py-2 text-sm text-neutral-400">
          Pick a select or status property to group the board.
        </div>
      </div>
    );
  }

  const visible = applyView(db.rows, db.properties, view.config, db.me, db.related);
 // for a status property, order columns by their option group band.
  const ordered =
    groupProp.type === "status"
      ? [...(groupProp.config.options ?? [])].sort(
          (a, b) => (GROUP_ORDER[a.group ?? "in_progress"] ?? 1) - (GROUP_ORDER[b.group ?? "in_progress"] ?? 1)
        )
      : groupProp.config.options ?? [];
  const columns = [
    ...ordered.map((o) => ({ id: o.id, name: o.name, color: o.color, group: o.group })),
    { id: NONE, name: `No ${groupProp.name}`, color: "gray", group: undefined as string | undefined },
  ];

  const rowsIn = (colId: string) =>
    visible.filter((r) => (r.values[groupProp.id] ?? NONE) === (colId === NONE ? NONE : colId) || (colId === NONE && !r.values[groupProp.id]));

  function onCardPointerDown(e: React.PointerEvent, rowId: string) {
    if (e.button !== 0) return;
    draggingRef.current = rowId;
    setDragging(rowId);
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener("pointerup", onUp);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const col = el?.closest("[data-board-col]");
      const rid = draggingRef.current;
      draggingRef.current = null;
      setDragging(null);
      if (col && rid) {
        const target = col.getAttribute("data-board-col");
        db.updateRow(rid, { [groupProp!.id]: target === NONE ? null : target });
      }
    };
    document.addEventListener("pointerup", onUp);
  }

  const cardTitle = (r: DbRow) =>
    (titleProp && (r.values[titleProp.id] as string)) || "Untitled";

  return (
    <div>
      <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const cards = rowsIn(col.id);
        return (
          <div
            key={col.id}
            data-board-col={col.id}
            data-testid={`db-board-col-${col.id}`}
            className="flex w-60 shrink-0 flex-col rounded-md bg-neutral-50 p-2 dark:bg-neutral-800/40"
          >
            <div className="mb-2 flex items-center gap-1.5 px-1">
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${optionClass(col.color)}`}>
                {col.name}
              </span>
              <span className="text-xs text-neutral-400">{cards.length}</span>
              {groupProp.type === "status" && col.id !== NONE && (
                <span
                  data-testid={`db-board-group-${col.id}`}
                  className="ml-auto text-[10px] uppercase tracking-wide text-neutral-300 dark:text-neutral-600"
                >
                  {GROUP_LABEL[col.group ?? "in_progress"]}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {cards.map((r) => {
                const assignee = personProp ? personLabel(db.members, r.values[personProp.id]) : "";
                return (
                  <div
                    key={r.id}
                    data-testid={`db-card-${r.id}`}
                    onPointerDown={(e) => onCardPointerDown(e, r.id)}
                    className={`cursor-grab overflow-hidden rounded-md border border-neutral-200 bg-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md dark:border-neutral-700 dark:bg-neutral-800 ${
                      dragging === r.id ? "opacity-50" : ""
                    }`}
                    style={{ touchAction: "none" }}
                  >
                    {coverOf(r.values) && (
 // eslint-disable-next-line @next/next/no-img-element
                      <img
                        data-testid={`db-board-cover-${r.id}`}
                        src={coverOf(r.values)!}
                        alt=""
                        className="h-16 w-full object-cover"
                      />
                    )}
                    <div className="p-2">
                    <div className="text-sm text-neutral-800 dark:text-neutral-100">
                      {cardTitle(r)}
                    </div>
                    {assignee && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-semibold text-white">
                          {initial(assignee)}
                        </span>
                        <span className="text-xs text-neutral-500">{assignee}</span>
                      </div>
                    )}
                    </div>
                  </div>
                );
              })}
              <button
                data-testid={`db-board-add-${col.id}`}
                onClick={() =>
                  db.addRow(col.id === NONE ? {} : { [groupProp.id]: col.id })
                }
                className="flex items-center gap-1 rounded px-1 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700"
              >
                <Plus size={12} /> New
              </button>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
