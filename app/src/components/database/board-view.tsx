"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { DbView, DbRow } from "@/lib/db/schema";
import { applyView, statusGroupOf, visibleColumns } from "@/lib/db-values";
import { useDb } from "./database-block";
import { useT } from "@/i18n/provider";
import { PropertyValue } from "./property-value";
import { UserAvatar } from "@/components/user-avatar";
import { OptionChip } from "./option-chip";

const NONE = "none";

// Status option groups: columns are ordered by band and labelled with it.
const GROUP_ORDER: Record<string, number> = { todo: 0, in_progress: 1, complete: 2 };
// legacy group names come back in English from statusGroupOf — display only
const GROUP_KO: Record<string, string> = { "To-do": "할 일", "In progress": "진행 중", Complete: "완료" };
export function BoardView({ view }: { view: DbView }) {
  const db = useDb();
  const t = useT();
  const [dragging, setDragging] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);

  const groupProp = db.properties.find((p) => p.id === view.config.groupByPropertyId);
  const titleProp = db.properties.find((p) => p.type === "title");
  const personProp = db.properties.find((p) => p.type === "person");
  const groupable = db.properties.filter((p) => p.type === "select" || p.type === "status");
 // properties shown on a card, in this view's order (title is the card's own)
  const cardProps = visibleColumns(db.properties, view.config).filter((p) => p.type !== "title");
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
          {t("보드를 그룹화할 선택 또는 상태 속성을 고르세요.")}
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
    { id: NONE, name: t("{name} 없음", { name: groupProp.name }), color: "gray", group: undefined as string | undefined },
  ];

  const rowsIn = (colId: string) =>
    visible.filter((r) => (r.values[groupProp.id] ?? NONE) === (colId === NONE ? NONE : colId) || (colId === NONE && !r.values[groupProp.id]));

 // A card is both a link and a drag handle. A press that never travels is a
 // CLICK and opens the card (QA-7: the Projects "My" board had no open path at
 // all — every click was treated as a drop into the same column, so nothing
 // happened, and it even wrote the unchanged value back). A press that moves
 // past DRAG_PX is a drag, and a drop onto another column moves the card;
 // dropping it back where it was writes nothing.
  const DRAG_PX = 5;
  function onCardPointerDown(e: React.PointerEvent, rowId: string) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    draggingRef.current = rowId;
    const onMove = (ev: PointerEvent) => {
      if (moved) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_PX) {
        moved = true;
        setDragging(rowId);
      }
    };
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const rid = draggingRef.current;
      draggingRef.current = null;
      setDragging(null);
      if (!rid) return;
      if (!moved) {
        void db.openRow(rid);
        return;
      }
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-board-col]");
      if (!col) return;
      const target = col.getAttribute("data-board-col");
      const next = target === NONE ? null : target;
      const row = db.rows.find((r) => r.id === rid);
      if (row && ((row.values[groupProp!.id] as string | undefined) ?? null) === next) return;
      db.updateRow(rid, { [groupProp!.id]: next });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  const cardTitle = (r: DbRow) =>
    (titleProp && (r.values[titleProp.id] as string)) || t("제목 없음");

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
              <OptionChip color={col.color} title={col.name} dot={groupProp.type === "status"}>
                {col.name}
              </OptionChip>
              <span className="text-xs text-neutral-400">{cards.length}</span>
              {groupProp.type === "status" && col.id !== NONE && statusGroupOf(groupProp, col.id) && (
                <span
                  data-testid={`db-board-group-${col.id}`}
                  className="ml-auto text-[10px] uppercase tracking-wide text-neutral-300 dark:text-neutral-600"
                >
                  {t(GROUP_KO[statusGroupOf(groupProp, col.id)!] ?? statusGroupOf(groupProp, col.id)!)}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {cards.map((r) => {
 // the assignee's own row, so the card shows their photo. A person cell
 // holds an id, or a list of them once it carries several people.
                const cell = personProp ? r.values[personProp.id] : null;
                const assigneeId = Array.isArray(cell) ? cell[0] : cell;
                const assignee = db.members.find((m) => m.id === assigneeId) ?? null;
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
                    {/* the view's own card properties, in its own order — the
                        original's `My` shows Team, Evaluation and TL under the
                        title (docs/notion-projects-spec.md) */}
                    {cardProps.length > 0 ? (
                      <div className="mt-1.5 flex flex-col gap-1">
                        {cardProps.map((prop) => (
                          <PropertyValue key={prop.id} prop={prop} row={r} />
                        ))}
                      </div>
                    ) : (
                      assignee && (
                        <div className="mt-1.5 flex items-center gap-1">
                          <UserAvatar user={assignee} size={16} />
                          <span className="text-xs text-neutral-500">{assignee.displayName}</span>
                        </div>
                      )
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
                <Plus size={12} /> {t("새 {name}", { name: db.itemName })}
              </button>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
