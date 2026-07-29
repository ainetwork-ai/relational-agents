"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DbView } from "@/lib/db/schema";
import { applyView, dateStart, dateEnd } from "@/lib/db-values";
import { useDb } from "./database-block";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const pad = (n: number) => String(n).padStart(2, "0");
const dayIndex = (iso: string): number => {
 // day-of-month (1-based) for a YYYY-MM-DD, else 0
  const m = iso.match(/^\d{4}-\d{2}-(\d{2})/);
  return m ? Number(m[1]) : 0;
};

/** Horizontal timeline (Gantt-style): each row is a bar on a month day-axis,
 * positioned by its date property's start and spanning to its end (range). */
export function TimelineView({ view }: { view: DbView }) {
  const db = useDb();
  const dateProps = db.properties.filter((p) => p.type === "date");
  const datePropId = view.config.calendarDatePropertyId ?? dateProps[0]?.id ?? "";
  const dateProp = db.properties.find((p) => p.id === datePropId);
  const titleProp = db.properties.find((p) => p.type === "title");

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const { year, month } = cursor;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthKey = `${year}-${pad(month + 1)}`;

  const visible = applyView(db.rows, db.properties, view.config, db.me, db.related);
  const rows = dateProp
    ? visible.filter((r) => dateStart(r.values[dateProp.id]).startsWith(monthKey))
    : [];

  const prev = () =>
    setCursor(({ year, month }) => (month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }));
  const next = () =>
    setCursor(({ year, month }) => (month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }));

  return (
    <div data-testid="db-timeline" className="w-full overflow-x-auto">
      <div className="mb-2 flex items-center gap-2">
        <button data-testid="db-timeline-prev" onClick={prev} aria-label="Previous month" className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <ChevronLeft size={16} />
        </button>
        <span data-testid="db-timeline-month" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {MONTHS[month]} {year}
        </span>
        <button data-testid="db-timeline-next" onClick={next} aria-label="Next month" className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <ChevronRight size={16} />
        </button>
        {dateProps.length > 1 && (
          <select
            data-testid="db-timeline-date-prop"
            value={datePropId}
            onChange={(e) => db.patchView({ ...view.config, calendarDatePropertyId: e.target.value })}
            className="ml-2 rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
          >
            {dateProps.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="min-w-[640px]">
        {/* day axis */}
        <div className="flex border-b border-neutral-200 pl-40 dark:border-neutral-700">
          {Array.from({ length: daysInMonth }, (_, i) => (
            <div key={i} className="flex-1 text-center text-[10px] text-neutral-400">{i + 1}</div>
          ))}
        </div>
        {/* one lane per row with a bar spanning start→end */}
        {rows.length === 0 && (
          <p className="py-4 text-sm text-neutral-400">No dated rows this month.</p>
        )}
        {rows.map((row) => {
          const start = dayIndex(dateStart(row.values[dateProp!.id]));
          const endIso = dateEnd(row.values[dateProp!.id]);
          const end = endIso.startsWith(monthKey) ? dayIndex(endIso) : start;
          const left = ((start - 1) / daysInMonth) * 100;
          const width = ((Math.max(end, start) - start + 1) / daysInMonth) * 100;
          return (
            <div key={row.id} className="flex items-center border-b border-neutral-100 py-1 dark:border-neutral-800">
              <div className="w-40 shrink-0 truncate pr-2 text-xs text-neutral-700 dark:text-neutral-200">
                {(titleProp && (row.values[titleProp.id] as string)) || "Untitled"}
              </div>
              <div className="relative h-5 flex-1">
                <button
                  data-testid={`db-timeline-bar-${row.id}`}
                  onClick={() => db.openRow(row.id)}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  className="absolute top-0.5 h-4 min-w-[8px] rounded bg-blue-500 text-[10px] text-white hover:bg-blue-600"
                  title={(titleProp && (row.values[titleProp.id] as string)) || ""}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
