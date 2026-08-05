"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DbRow, DbView, TimelineZoom } from "@/lib/db/schema";
import { applyView, dateStart, dateEnd, visibleColumns } from "@/lib/db-values";
import { useDb } from "./database-block";
import { PropertyValue } from "./property-value";

// ===========================================================================
// Timeline — bars on a date axis, with the side table the original's
// `My Timeline` keeps open (`timeline_show_table`) and its three zoom levels
// (docs/notion-projects-spec.md). A bar is drawn whenever the row's range
// overlaps the window, not only when it starts inside it.
// ===========================================================================

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const parse = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return y ? new Date(y, (m || 1) - 1, d || 1) : null;
};

/** the [from, to) window and its tick marks for a zoom level */
function windowFor(zoom: TimelineZoom, cursor: Date) {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  if (zoom === "year") {
    return {
      from: new Date(y, 0, 1),
      to: new Date(y + 1, 0, 1),
      label: String(y),
      ticks: MONTHS.map((name, i) => ({ at: new Date(y, i, 1), name })),
      step: (d: Date, dir: number) => new Date(d.getFullYear() + dir, 0, 1),
    };
  }
  if (zoom === "quarter") {
    const qStart = Math.floor(m / 3) * 3;
    return {
      from: new Date(y, qStart, 1),
      to: new Date(y, qStart + 3, 1),
      label: `${y} Q${qStart / 3 + 1}`,
      ticks: [0, 1, 2].map((i) => ({ at: new Date(y, qStart + i, 1), name: MONTHS[(qStart + i) % 12] })),
      step: (d: Date, dir: number) => new Date(d.getFullYear(), d.getMonth() + dir * 3, 1),
    };
  }
  const days = new Date(y, m + 1, 0).getDate();
  return {
    from: new Date(y, m, 1),
    to: new Date(y, m + 1, 1),
    label: `${MONTHS[m]} ${y}`,
    ticks: Array.from({ length: days }, (_, i) => ({ at: new Date(y, m, i + 1), name: String(i + 1) })),
    step: (d: Date, dir: number) => new Date(d.getFullYear(), d.getMonth() + dir, 1),
  };
}

const LANE = 32; // px per row — the side table and the bars share it

export function TimelineView({ view }: { view: DbView }) {
  const db = useDb();
  const dateProps = db.properties.filter((p) => p.type === "date");
  const datePropId = view.config.calendarDatePropertyId ?? dateProps[0]?.id ?? "";
  const dateProp = db.properties.find((p) => p.id === datePropId);
  const titleProp = db.properties.find((p) => p.type === "title");
  const zoom: TimelineZoom = view.config.timelineZoom ?? "month";
  const showTable = view.config.timelineShowTable ?? false;
  const cols = visibleColumns(db.properties, view.config);

 // Start on today, but if nothing is dated in that window open on the row
 // closest to today instead of an empty screen (Notion remembers a
 // `centerTimestamp` per view; we pick a sensible one).
  const visible = applyView(db.rows, db.properties, view.config, db.me, db.related);

  const [cursor, setCursor] = useState(() => {
    const today = new Date();
    if (!dateProp) return today;
    const w = windowFor(view.config.timelineZoom ?? "month", today);
 // the rows this view actually shows — a date elsewhere in the database is
 // no reason to open on an empty window
    const dates = visible
      .map((r) => parse(dateStart(r.values[dateProp.id])))
      .filter((d): d is Date => !!d);
    if (!dates.length) return today;
    if (dates.some((d) => d.getTime() >= w.from.getTime() && d.getTime() < w.to.getTime())) return today;
    return dates.reduce((best, d) =>
      Math.abs(d.getTime() - today.getTime()) < Math.abs(best.getTime() - today.getTime()) ? d : best
    );
  });
  const win = windowFor(zoom, cursor);
  const spanMs = win.to.getTime() - win.from.getTime();

 // a row is on screen when its range overlaps the window
  const rows = dateProp
    ? visible.filter((r) => {
        const s = parse(dateStart(r.values[dateProp.id]));
        if (!s) return false;
        const e = parse(dateEnd(r.values[dateProp.id])) ?? s;
        return e.getTime() >= win.from.getTime() && s.getTime() < win.to.getTime();
      })
    : [];

  const barOf = (row: DbRow) => {
    const s = parse(dateStart(row.values[dateProp!.id]))!;
    const e = parse(dateEnd(row.values[dateProp!.id])) ?? s;
    const from = Math.max(s.getTime(), win.from.getTime());
    const to = Math.min(e.getTime() + DAY, win.to.getTime());
    return {
      left: ((from - win.from.getTime()) / spanMs) * 100,
      width: Math.max(((to - from) / spanMs) * 100, 0.6),
    };
  };

  const label = (row: DbRow) => (titleProp && (row.values[titleProp.id] as string)) || "제목 없음";

  return (
    <div data-testid="db-timeline" className="w-full">
      <div className="mb-2 flex items-center gap-2">
        <button
          data-testid="db-timeline-prev"
          onClick={() => setCursor((d) => win.step(d, -1))}
          aria-label="이전"
          className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <ChevronLeft size={16} />
        </button>
        <span data-testid="db-timeline-month" className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {win.label}
        </span>
        <button
          data-testid="db-timeline-next"
          onClick={() => setCursor((d) => win.step(d, 1))}
          aria-label="다음"
          className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <ChevronRight size={16} />
        </button>
        <select
          data-testid="db-timeline-zoom"
          value={zoom}
          onChange={(e) => db.patchView({ ...view.config, timelineZoom: e.target.value as TimelineZoom })}
          className="rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
        >
          <option value="month">월</option>
          <option value="quarter">분기</option>
          <option value="year">연</option>
        </select>
        {dateProps.length > 1 && (
          <select
            data-testid="db-timeline-date-prop"
            value={datePropId}
            onChange={(e) => db.patchView({ ...view.config, calendarDatePropertyId: e.target.value })}
            className="rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
          >
            {dateProps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button
          data-testid="db-timeline-toggle-table"
          onClick={() => db.patchView({ ...view.config, timelineShowTable: !showTable })}
          className="ml-auto rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {showTable ? "표 숨기기" : "표 보기"}
        </button>
      </div>

      <div className="flex w-full">
        {/* side table — its own column list, as in the original */}
        {showTable && (
          <div data-testid="db-timeline-table" className="shrink-0 overflow-hidden border-r border-neutral-200 dark:border-neutral-700">
            <div className="flex border-b border-neutral-200 dark:border-neutral-700" style={{ height: LANE }}>
              {cols.map((p) => (
                <div
                  key={p.id}
                  style={{ width: view.config.widths?.[p.id] ?? 160 }}
                  className="flex shrink-0 items-center truncate border-l border-neutral-100 px-2 text-xs font-medium text-neutral-500 first:border-l-0 dark:border-neutral-800"
                >
                  {p.name}
                </div>
              ))}
            </div>
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex border-b border-neutral-100 dark:border-neutral-800"
                style={{ height: LANE }}
              >
                {cols.map((p) => (
                  <div
                    key={p.id}
                    style={{ width: view.config.widths?.[p.id] ?? 160 }}
                    className="flex shrink-0 items-center overflow-hidden border-l border-neutral-100 px-2 text-xs first:border-l-0 dark:border-neutral-800"
                  >
                    {p.type === "title" ? (
                      <button
                        onClick={() => db.openRow(row.id)}
                        className="truncate text-left text-neutral-800 hover:underline dark:text-neutral-100"
                      >
                        {label(row)}
                      </button>
                    ) : (
                      <PropertyValue prop={p} row={row} />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* the axis and the bars */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="min-w-[520px]">
            <div className="flex border-b border-neutral-200 dark:border-neutral-700" style={{ height: LANE }}>
              {win.ticks.map((t) => (
                <div key={t.name} className="flex-1 self-end pb-1 text-center text-[10px] text-neutral-400">
                  {t.name}
                </div>
              ))}
            </div>
            {rows.length === 0 && (
              <p className="py-4 text-center text-sm text-neutral-400">이 기간에 날짜가 있는 행이 없습니다.</p>
            )}
            {rows.map((row) => {
              const bar = barOf(row);
              return (
                <div
                  key={row.id}
                  className="relative border-b border-neutral-100 dark:border-neutral-800"
                  style={{ height: LANE }}
                >
                  <button
                    data-testid={`db-timeline-bar-${row.id}`}
                    onClick={() => db.openRow(row.id)}
                    style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                    title={label(row)}
                    className="absolute top-1.5 flex h-5 items-center overflow-hidden whitespace-nowrap rounded bg-blue-500 px-1.5 text-[10px] text-white hover:bg-blue-600"
                  >
                    {!showTable && label(row)}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
