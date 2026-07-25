"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DbView } from "@/lib/db/schema";
import { applyView, dateStart } from "@/lib/db-values";
import { useDb } from "./database-block";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Month-grid calendar. Lays each row out on the day its chosen date
 * property falls on (config.calendarDatePropertyId). Prev/next navigate
 * months. Defaults to the current month (new Date() is fine in the client). */
export function CalendarView({ view }: { view: DbView }) {
  const db = useDb();
  const dateProps = db.properties.filter((p) => p.type === "date");
  const datePropId = view.config.calendarDatePropertyId ?? dateProps[0]?.id ?? "";
  const dateProp = db.properties.find((p) => p.id === datePropId);
  const titleProp = db.properties.find((p) => p.type === "title");

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
 // Month/Week toggle
  const [mode, setMode] = useState<"month" | "week">("month");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const weekStart = new Date(weekAnchor);
  weekStart.setDate(weekAnchor.getDate() - weekAnchor.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const visible = applyView(db.rows, db.properties, view.config, db.me, db.related);

  const { year, month } = cursor;
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

 // a yearly-recurring date property (birthdays) matches on month/day only,
 // so the row shows up in every year's grid, not just the stored year
  const yearly = dateProp?.config.recurring === "yearly";
  const rowsForDay = (dayStr: string) =>
    dateProp
      ? visible.filter((r) => {
          const d = dateStart(r.values[dateProp.id]).slice(0, 10);
          return yearly ? d.slice(5) === dayStr.slice(5) : d === dayStr;
        })
      : [];

  const stepWeek = (dir: number) =>
    setWeekAnchor((d) => {
      const n = new Date(d);
      n.setDate(d.getDate() + dir * 7);
      return n;
    });
  const prev = () =>
    mode === "week"
      ? stepWeek(-1)
      : setCursor(({ year, month }) =>
          month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
        );
  const next = () =>
    mode === "week"
      ? stepWeek(1)
      : setCursor(({ year, month }) =>
          month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
        );

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  return (
    <div data-testid="db-calendar" className="w-full">
      <div className="mb-2 flex items-center gap-2">
        <button
          data-testid="db-calendar-prev"
          onClick={prev}
          aria-label="Previous month"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <ChevronLeft size={14} />
        </button>
        <span
          data-testid="db-calendar-month"
          className="min-w-[9rem] text-center text-sm font-medium text-neutral-800 dark:text-neutral-100"
        >
          {mode === "month"
            ? `${MONTHS[month]} ${year}`
            : `${MONTHS[weekDays[0].getMonth()].slice(0, 3)} ${weekDays[0].getDate()} – ${MONTHS[weekDays[6].getMonth()].slice(0, 3)} ${weekDays[6].getDate()}, ${weekDays[6].getFullYear()}`}
        </span>
        <button
          data-testid="db-calendar-mode"
          onClick={() => setMode((m) => (m === "month" ? "week" : "month"))}
          className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {mode === "month" ? "Week" : "Month"}
        </button>
        <button
          data-testid="db-calendar-next"
          onClick={next}
          aria-label="Next month"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <ChevronRight size={14} />
        </button>
        {dateProps.length > 0 && (
          <select
            data-testid="db-calendar-date-prop"
            value={datePropId}
            onChange={(e) =>
              db.patchView({ ...view.config, calendarDatePropertyId: e.target.value })
            }
            className="ml-auto rounded border border-neutral-200 bg-white px-1.5 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          >
            {dateProps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!dateProp ? (
        <div className="py-4 text-sm text-neutral-400">
          Add a date property to use the calendar.
        </div>
      ) : mode === "week" ? (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-neutral-200 bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-700">
          {weekDays.map((d, i) => {
            const dayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            const events = rowsForDay(dayStr);
            return (
              <div
                key={dayStr}
                data-testid={`db-calendar-day-${dayStr}`}
                className="min-h-[200px] bg-white p-1 dark:bg-neutral-900"
              >
                <div className="mb-1 text-[10px] text-neutral-400">
                  {WEEKDAYS[i]}{" "}
                  {dayStr === todayStr ? (
                    <span
                      data-testid="db-calendar-today"
                      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 font-medium text-white"
                    >
                      {d.getDate()}
                    </span>
                  ) : (
                    d.getDate()
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {events.map((r) => (
                    <button
                      key={r.id}
                      data-testid={`db-calendar-event-${r.id}`}
                      onClick={() => db.openRow(r.id)}
                      className="truncate rounded bg-blue-100 px-1 py-0.5 text-left text-[11px] text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-200"
                    >
                      {(titleProp && (r.values[titleProp.id] as string)) || "Untitled"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-neutral-200 bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-700">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="bg-neutral-50 px-1 py-1 text-center text-[10px] font-medium uppercase text-neutral-400 dark:bg-neutral-800"
            >
              {w}
            </div>
          ))}
          {cells.map((d, i) => {
            if (d === null)
              return (
                <div key={`pad-${i}`} className="min-h-[72px] bg-neutral-50/60 dark:bg-neutral-900/40" />
              );
            const dayStr = `${year}-${pad(month + 1)}-${pad(d)}`;
            const events = rowsForDay(dayStr);
            return (
              <div
                key={dayStr}
                data-testid={`db-calendar-day-${dayStr}`}
                className="min-h-[72px] bg-white p-1 dark:bg-neutral-900"
              >
                <div className="mb-1 text-[10px] text-neutral-400">
                  {dayStr === todayStr ? (
                    <span
                      data-testid="db-calendar-today"
                      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 font-medium text-white"
                    >
                      {d}
                    </span>
                  ) : (
                    d
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {events.map((r) => (
                    <button
                      key={r.id}
                      data-testid={`db-calendar-event-${r.id}`}
                      onClick={() => db.openRow(r.id)}
                      className="truncate rounded bg-blue-100 px-1 py-0.5 text-left text-[11px] text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-200"
                    >
                      {(titleProp && (r.values[titleProp.id] as string)) || "Untitled"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
