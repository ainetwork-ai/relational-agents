"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadBlob } from "@/lib/upload";
import type { DbProperty, DbRow } from "@/lib/db/schema";
import { X } from "lucide-react";

/** the person picker's height cap — the original's is 333px, list scrolling inside */
const POPOVER_MAX_H = 333;
import { createPortal } from "react-dom";
import { findOption, personLabel, personIds, personLabels } from "@/lib/db-values";
import { evalFormula, rollupValue } from "@/lib/db-computed";
import {
  fetchDatabaseSnapshot,
  targetRowLabel,
  type DbSnapshot,
} from "@/lib/db-relation";
import { useDb } from "./database-block";
import { copyText } from "@/lib/compat";
import { UserAvatar } from "@/components/user-avatar";
import { OptionChip } from "./option-chip";

/** Format a row timestamp (Date or ISO string over JSON) for display. */
function fmtTimestamp(v: unknown): string {
  if (!v) return "";
  const d = new Date(v as string | number | Date);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US");
}

export function PropertyCell({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const db = useDb();
  const value = row.values[prop.id];
  const testid = `db-cell-${row.id}-${prop.id}`;

  const set = (v: unknown) => db.updateRow(row.id, { [prop.id]: v });

  switch (prop.type) {
    case "title":
    case "text":
    case "email":
    case "phone":
      return <TextCell testid={testid} value={(value as string) ?? ""} onCommit={set} />;

    case "url":
      return <UrlCell testid={testid} value={(value as string) ?? ""} onCommit={set} />;

    case "created_time":
      return (
        <div data-testid={testid} className="px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400">
          {fmtTimestamp(row.createdAt)}
        </div>
      );

    case "last_edited_time":
      return (
        <div data-testid={testid} className="px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400">
          {fmtTimestamp(row.updatedAt)}
        </div>
      );

    case "created_by":
      return (
        <div data-testid={testid} className="px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400">
          {personLabel(db.members, row.createdBy) || "—"}
        </div>
      );

    case "last_edited_by":
      return (
        <div data-testid={testid} className="px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400">
          {personLabel(db.members, row.updatedBy) || "—"}
        </div>
      );

    case "files":
      return <FilesCell testid={testid} value={value} onSet={set} />;

    case "number":
      return <NumberCell testid={testid} prop={prop} value={value} onSet={set} />;

    case "checkbox":
      return (
        <div className="flex items-center px-2 py-1">
          <input
            data-testid={testid}
            type="checkbox"
            checked={!!value}
            onChange={(e) => set(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-blue-500"
          />
        </div>
      );

    case "date":
      return <DateCell testid={testid} value={value} onSet={set} />;

    case "select":
    case "status":
      return <SelectCell testid={testid} prop={prop} value={value} onSet={set} />;

    case "multi_select":
      return <MultiSelectCell testid={testid} prop={prop} row={row} />;

    case "person":
      return <PersonCell testid={testid} value={value} onSet={set} />;

    case "relation":
      return <RelationCell prop={prop} row={row} />;

    case "formula":
      return <FormulaCell prop={prop} row={row} />;

    case "rollup":
      return <RollupCell prop={prop} row={row} />;

    default:
      return <div className="px-2 py-1 text-sm text-neutral-400">—</div>;
  }
}

function RelationCell({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<DbSnapshot | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const targetDbId = prop.config.relationDatabaseId;
 // two-way mirror: value is COMPUTED from the source db's relation values
 // (rows over there that link to this row), never stored on this row
  const mirror = prop.config.mirrorOf;
  const value = row.values[prop.id];
  const linked: string[] = mirror
    ? (snap?.rows ?? [])
        .filter((r) => {
          const v = r.values[mirror.propId];
          return Array.isArray(v) && (v as string[]).includes(row.id);
        })
        .map((r) => r.id)
    : Array.isArray(value)
      ? (value as string[])
      : [];

 // load the target db's rows so chips can show titles and the popover can
 // list options. Refetch whenever the target database changes.
  const load = useCallback(async () => {
    const next = targetDbId ? await fetchDatabaseSnapshot(targetDbId) : null;
    setSnap(next);
    return next;
  }, [targetDbId]);

 // deferred (async IIFE) so no setState runs synchronously in the effect body
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = targetDbId ? await fetchDatabaseSnapshot(targetDbId) : null;
      if (alive) setSnap(next);
    })();
    return () => {
      alive = false;
    };
  }, [targetDbId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(targetRowId: string) {
    if (mirror) {
 // edit the OTHER side: add/remove this row in the source row's relation
      const srcRow = snap?.rows.find((r) => r.id === targetRowId);
      const cur = Array.isArray(srcRow?.values[mirror.propId])
        ? (srcRow!.values[mirror.propId] as string[])
        : [];
      const next = cur.includes(row.id)
        ? cur.filter((x) => x !== row.id)
        : [...cur, row.id];
      void fetch(`/api/databases/${mirror.databaseId}/rows/${targetRowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { [mirror.propId]: next } }),
      }).then(() => load());
      return;
    }
    const next = linked.includes(targetRowId)
      ? linked.filter((x) => x !== targetRowId)
      : [...linked, targetRowId];
    db.updateRow(row.id, { [prop.id]: next });
  }

  return (
    <div ref={ref} className="relative px-1.5 py-1">
      <button
        data-testid={`relation-cell-${row.id}-${prop.id}`}
        onClick={async () => {
          if (!snap) await load();
          setOpen((v) => !v);
        }}
        className="flex min-h-[1.5rem] w-full flex-wrap items-center gap-1"
      >
        {linked.length ? (
          linked.map((id) => (
            <span
              key={id}
              data-testid={`relation-chip-${id}`}
              className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
            >
              {targetRowLabel(snap, id) || "…"}
            </span>
          ))
        ) : (
          <span className="inline-block h-5 w-full" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="popover-anim absolute left-0 top-8 z-40 max-h-64 w-52 overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          {!targetDbId ? (
            <div className="px-2 py-1 text-xs text-neutral-400">Pick a target database first</div>
          ) : !snap || snap.rows.length === 0 ? (
            <div className="px-2 py-1 text-xs text-neutral-400">No rows to link</div>
          ) : (
            snap.rows.map((tr) => (
              <button
                key={tr.id}
                data-testid={`relation-option-${tr.id}`}
                onClick={() => toggle(tr.id)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                <span className="truncate text-neutral-700 dark:text-neutral-200">
                  {targetRowLabel(snap, tr.id)}
                </span>
                {linked.includes(tr.id) && <span className="text-blue-500">✓</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FormulaCell({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const db = useDb();
 // recomputes on every render — reads the latest props/rows from context, so a
 // dependency cell change re-renders the table and updates this value live.
  const text = evalFormula(prop.config.formula, db.properties, row);
  return (
    <div
      data-testid={`db-formula-value-${row.id}-${prop.id}`}
      className="px-2 py-1 text-sm text-neutral-700 dark:text-neutral-200"
    >
      {text}
    </div>
  );
}

function RollupCell({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const db = useDb();
  const [text, setText] = useState("");
  const rollup = prop.config.rollup;
  const relProp = db.properties.find((p) => p.id === rollup?.relationPropertyId);
  const relatedDbId = relProp?.config.relationDatabaseId;
  const linkedValue = relProp ? row.values[relProp.id] : undefined;
  const linkedIds: string[] = Array.isArray(linkedValue) ? (linkedValue as string[]) : [];
 // stable dependency key so the effect refires when links or config change
  const linkedKey = linkedIds.join(",");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!relatedDbId || !rollup?.targetPropertyId) {
        if (alive) setText("");
        return;
      }
      const snap = await fetchDatabaseSnapshot(relatedDbId);
      if (!alive) return;
      const linkedRows = (snap?.rows ?? []).filter((r) => linkedIds.includes(r.id));
      setText(rollupValue(linkedRows, rollup.targetPropertyId, rollup.function));
    })();
    return () => {
      alive = false;
    };
 // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedDbId, rollup?.targetPropertyId, rollup?.function, linkedKey]);

  return (
    <div
      data-testid={`db-rollup-value-${row.id}-${prop.id}`}
      className="px-2 py-1 text-sm text-neutral-700 dark:text-neutral-200"
    >
      {text}
    </div>
  );
}

function MultiSelectCell({
  testid,
  prop,
  row,
}: {
  testid: string;
  prop: DbProperty;
  row: DbRow;
}) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const value = row.values[prop.id];
  const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
  const options = prop.config.options ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(id: string) {
    db.toggleMulti(row.id, prop.id, id);
  }

  return (
    <div ref={ref} className="relative min-w-0 px-1.5 py-1">
      <button
        data-testid={testid}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[1.5rem] w-full items-center gap-1 overflow-hidden"
      >
        {selected.length ? (
 // one line, clipped by the column — the capture's cell does not wrap
          selected.map((id) => {
            const o = findOption(prop, id);
            return o ? (
              <OptionChip key={id} color={o.color} title={o.name}>
                {o.name}
              </OptionChip>
            ) : null;
          })
        ) : (
          <span className="inline-block h-5 w-full" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="popover-anim absolute left-0 top-8 z-40 w-48 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search or create…"
            className="mb-1 w-full rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          />
          {options
            .filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
            .map((o) => (
              <button
                key={o.id}
                data-testid={`db-option-${prop.id}-${o.id}`}
                onClick={() => toggle(o.id)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                <OptionChip color={o.color}>{o.name}</OptionChip>
                {selected.includes(o.id) && <span className="text-xs text-blue-500">✓</span>}
              </button>
            ))}
          {q && !options.some((o) => o.name.toLowerCase() === q.toLowerCase()) && (
            <button
              data-testid="db-option-create"
              onClick={async () => {
                const opt = await db.addSelectOption(prop, q);
                db.toggleMulti(row.id, prop.id, opt.id);
                setQ("");
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              + Create “{q}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TextCell({
  testid,
  value,
  onCommit,
}: {
  testid: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(value);
  useEffect(() => {
    if (value !== ref.current) {
      ref.current = value;
      setDraft(value);
    }
  }, [value]);
  return (
    <input
      data-testid={testid}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-full bg-transparent px-2 py-1 text-sm outline-none dark:text-neutral-200"
    />
  );
}

/** A date value is either a plain "YYYY-MM-DD" string (legacy) or an object
 * { start: "YYYY-MM-DD[THH:MM]", end?, includeTime? } for time-of-day/ranges. */
interface DateParts {
  date: string;
  time: string;
  end: string;
}
function parseDateValue(v: unknown): DateParts {
  if (v && typeof v === "object") {
    const o = v as { start?: string; end?: string };
    const [date, time] = (o.start ?? "").split("T");
    return { date: date ?? "", time: time ?? "", end: o.end ?? "" };
  }
  if (typeof v === "string") {
    const [date, time] = v.split("T");
    return { date: date ?? "", time: time ?? "", end: "" };
  }
  return { date: "", time: "", end: "" };
}
function buildDateValue({ date, time, end }: DateParts): unknown {
  if (!date) return null;
  const start = time ? `${date}T${time}` : date;
 // an end or a time makes it a structured value; a bare date stays a string.
  if (end || time) return { start, ...(end ? { end } : {}), includeTime: !!time };
  return start;
}
function dateSummary({ date, time, end }: DateParts): string {
  if (!date) return "";
  return `${date}${time ? ` ${time}` : ""}${end ? ` → ${end}` : ""}`;
}

/** Date cell: start date + optional time-of-day + optional end-date range,
 *. Renders a "start [time] → end" summary. */
/** Pretty cell label: "Mar 10, 2026 14:30 → Mar 12, 2026". */
function dateLabel({ date, time, end }: DateParts): string {
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return d;
    return new Date(y, m - 1, day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };
  if (!date) return "";
  return `${fmt(date)}${time ? ` ${time}` : ""}${end ? ` → ${fmt(end)}` : ""}`;
}

/** Month grid for the date popover. */
export function MonthGrid({
  idBase,
  selected,
  onPick,
}: {
  idBase: string;
  selected: string;
  onPick: (iso: string) => void;
}) {
  const today = new Date();
  const init = selected ? new Date(selected + "T00:00") : today;
  const [ym, setYm] = useState({ y: init.getFullYear(), m: init.getMonth() });
  const first = new Date(ym.y, ym.m, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const iso = (d: number) =>
    `${ym.y}-${String(ym.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return (
    <div data-testid={`db-date-grid-${idBase}`} className="w-56 select-none">
      <div className="mb-1 flex items-center justify-between px-1 text-xs text-neutral-600 dark:text-neutral-300">
        <button
          data-testid={`db-date-prevmonth-${idBase}`}
          onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
          className="rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="font-medium">
          {first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <button
          data-testid={`db-date-nextmonth-${idBase}`}
          onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
          className="rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-neutral-400">
        {["S", "M", "T", "W", "T2", "F", "S2"].map((d) => (
          <span key={d}>{d.replace("2", "")}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: startPad }, (_, i) => (
          <span key={`pad${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = iso(i + 1);
          const isSel = d === selected;
          const isToday = d === todayIso;
          return (
            <button
              key={d}
              data-testid={`db-date-day-${idBase}-${d}`}
              onClick={() => onPick(d)}
              className={`rounded p-1 text-xs ${
                isSel
                  ? "bg-blue-500 font-medium text-white"
                  : isToday
                    ? "font-semibold text-blue-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateCell({
  testid,
  value,
  onSet,
}: {
  testid: string;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const parts = parseDateValue(value);
  const [open, setOpen] = useState(false);
  const [showEnd, setShowEnd] = useState(!!parts.end);
  const ref = useRef<HTMLDivElement>(null);
  const push = (next: Partial<DateParts>) => onSet(buildDateValue({ ...parts, ...next }));
  const idBase = testid.replace("db-cell-", "");

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

 // the CELL is plain text; all editing lives in the popover
  return (
    <div ref={ref} className="relative">
      <button
        data-testid={testid}
        onClick={() => setOpen((v) => !v)}
        className="min-h-[1.75rem] w-full px-2 py-1 text-left text-sm text-neutral-700 dark:text-neutral-200"
      >
        {dateLabel(parts) || <span className="inline-block h-5 w-full" aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover-anim absolute left-0 top-8 z-40 rounded-lg border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <MonthGrid
            idBase={idBase}
            selected={parts.date}
            onPick={(d) => push({ date: d })}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-neutral-100 pt-1.5 text-xs dark:border-neutral-700">
            <input
              data-testid={`db-date-input-${idBase}`}
              type="date"
              value={parts.date}
              onChange={(e) => push({ date: e.target.value })}
              className="bg-transparent outline-none dark:text-neutral-200"
            />
            <input
              data-testid={`db-date-time-${idBase}`}
              type="time"
              value={parts.time}
              onChange={(e) => push({ time: e.target.value })}
              className="bg-transparent text-neutral-500 outline-none"
            />
            <button
              data-testid={`db-date-endtoggle-${idBase}`}
              onClick={() => setShowEnd((v) => !v)}
              aria-label="Toggle end date"
              className="text-neutral-400 hover:text-neutral-600"
            >
              →
            </button>
            {showEnd && (
              <input
                data-testid={`db-date-end-${idBase}`}
                type="date"
                value={parts.end}
                onChange={(e) => push({ end: e.target.value })}
                className="bg-transparent outline-none dark:text-neutral-200"
              />
            )}
            <button
              data-testid={`db-date-clear-${idBase}`}
              onClick={() => {
                onSet(null);
                setOpen(false);
              }}
              className="ml-auto rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-700"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Format a number per the column's numberFormat config. */
function formatNumber(n: number, fmt?: string): string {
  switch (fmt) {
    case "percent":
      return `${n}%`;
    case "currency":
      return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
    case "comma":
      return n.toLocaleString();
    default:
      return String(n);
  }
}

/** Number cell: a plain editable value, or a progress bar (display="bar") that
 * fills 0..100% of the value. Format applies to the shown text. */
function NumberCell({
  testid,
  prop,
  value,
  onSet,
}: {
  testid: string;
  prop: DbProperty;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const num = value === undefined || value === null || value === "" ? null : Number(value);
  const asBar = prop.config.display === "bar";

  if (editing || !asBar || num === null) {
    return (
      <input
        data-testid={testid}
        autoFocus={editing}
        type="number"
        defaultValue={num === null ? "" : String(num)}
        onBlur={(e) => {
          setEditing(false);
          onSet(e.target.value === "" ? null : Number(e.target.value));
        }}
        className="w-full bg-transparent px-2 py-1 text-sm outline-none dark:text-neutral-200"
      />
    );
  }
  const pct = Math.max(0, Math.min(100, num));
  return (
    <button
      data-testid={testid}
      onClick={() => setEditing(true)}
      className="flex w-full items-center gap-2 px-2 py-1 text-left"
    >
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <span
          data-testid={testid.replace("db-cell-", "db-number-bar-")}
          style={{ width: `${pct}%` }}
          className="block h-full rounded-full bg-blue-500"
        />
      </span>
      <span className="shrink-0 text-xs text-neutral-500">{formatNumber(num, prop.config.numberFormat)}</span>
    </button>
  );
}

/** URL cell: renders a clickable link when not being edited;
 * click into the cell to edit the raw value. */
function UrlCell({
  testid,
  value,
  onCommit,
}: {
  testid: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(value);
  useEffect(() => {
    if (value !== ref.current) {
      ref.current = value;
      setDraft(value);
    }
  }, [value]);

  if (editing || !value) {
    return (
      <input
        data-testid={testid}
        autoFocus={editing}
        value={draft}
        placeholder="https://…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full bg-transparent px-2 py-1 text-sm outline-none dark:text-neutral-200"
      />
    );
  }
  const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return (
    <div data-testid={testid} className="group/urlcell flex items-center gap-1 px-2 py-1">
      <a
        data-testid={`db-url-link-${testid}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="truncate text-sm text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
      >
        {value}
      </a>
      {/* hover actions: open in new tab + copy */}
      <button
        data-testid={`db-url-copy-${testid}`}
        onClick={async (e) => {
          e.stopPropagation();
          const el = e.currentTarget;
          if (await copyText(href)) {
            el.textContent = "✓";
            setTimeout(() => {
              el.textContent = "⧉";
            }, 1200);
          }
        }}
        aria-label="Copy URL"
        data-tip="Copy link"
        className="shrink-0 rounded px-1 text-xs text-neutral-400 opacity-0 transition-opacity hover:text-neutral-600 group-hover/urlcell:opacity-100"
      >
        ⧉
      </button>
      <button
        data-testid={`db-url-edit-${testid}`}
        onClick={() => setEditing(true)}
        aria-label="Edit URL"
        className="ml-auto shrink-0 px-1 text-xs text-neutral-400 hover:text-neutral-600"
      >
        ✎
      </button>
    </div>
  );
}

function SelectCell({
  testid,
  prop,
  value,
  onSet,
}: {
  testid: string;
  prop: DbProperty;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const current = findOption(prop, value);
  const options = prop.config.options ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0 px-1.5 py-1">
      <button
        data-testid={testid}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[1.5rem] w-full items-center overflow-hidden"
      >
        {current ? (
          <OptionChip color={current.color} title={current.name}>
            {current.name}
          </OptionChip>
        ) : (
          <span className="inline-block h-5 w-full" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="popover-anim absolute left-0 top-8 z-40 w-44 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search or create…"
            className="mb-1 w-full rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          />
          {!!value && (
            <button
              data-testid={`db-option-${prop.id}-none`}
              onClick={() => {
                onSet(null);
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >
              Clear
            </button>
          )}
          {options
            .filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
            .map((o) => (
              <div key={o.id} className="flex items-center gap-1">
                <button
                  data-testid={`db-option-${prop.id}-${o.id}`}
                  onClick={() => {
                    onSet(o.id);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-center rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  <OptionChip color={o.color} title={o.name}>
                    {o.name}
                  </OptionChip>
                </button>
                {prop.type === "status" && (
                  <select
                    data-testid={`status-group-${o.id}`}
                    value={o.group ?? "todo"}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      db.updateProperty(prop.id, {
                        config: {
                          ...prop.config,
                          options: options.map((x) =>
                            x.id === o.id ? { ...x, group: e.target.value } : x
                          ),
                        },
                      })
                    }
                    className="shrink-0 rounded border border-neutral-200 bg-transparent px-0.5 py-0.5 text-[10px] text-neutral-400 outline-none dark:border-neutral-600"
                  >
                    <option value="todo">To-do</option>
                    <option value="in_progress">In progress</option>
                    <option value="complete">Complete</option>
                  </select>
                )}
              </div>
            ))}
          {q && !options.some((o) => o.name.toLowerCase() === q.toLowerCase()) && (
            <button
              data-testid={`db-option-create`}
              onClick={async () => {
                const opt = await db.addSelectOption(prop, q);
                onSet(opt.id);
                setQ("");
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              + Create “{q}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Files & media: an ordered list of URLs. Renders each as an opening link and
 * offers an input to append another. Stored as a string[] in the row value. */
function FilesCell({
  testid,
  value,
  onSet,
}: {
  testid: string;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const urls: string[] = Array.isArray(value) ? (value as string[]).filter((u) => typeof u === "string") : [];
  const [draft, setDraft] = useState("");
  const add = () => {
    const u = draft.trim();
    if (!u) return;
    onSet([...urls, u]);
    setDraft("");
  };
  const removeAt = (i: number) => onSet(urls.filter((_, j) => j !== i));
  return (
    <div data-testid={testid} className="flex flex-wrap items-center gap-1 px-1.5 py-1">
      {urls.map((u, i) => (
        <span
          key={`${u}-${i}`}
          data-testid={`db-file-chip-${i}`}
          className="flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
        >
          <a href={u} target="_blank" rel="noopener noreferrer" className="max-w-[10rem] truncate underline">
            {u.split("/").pop() || u}
          </a>
          <button
            data-testid={`db-file-remove-${i}`}
            onClick={() => removeAt(i)}
            className="text-neutral-400 hover:text-red-500"
            aria-label="Remove file"
          >
            ×
          </button>
        </span>
      ))}
      <label className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-600" title="Upload a file">
        ⬆
        <input
          data-testid={`${testid}-upload`}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void (async () => {
              const up = await uploadBlob(f, "file");
              if (up) onSet([...urls, up.url]);
            })();
          }}
        />
      </label>
      <input
        data-testid={`${testid}-input`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        onBlur={add}
        placeholder="Add file URL…"
        className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-xs outline-none dark:text-neutral-200"
      />
    </div>
  );
}

function PersonCell({
  testid,
  value,
  onSet,
}: {
  testid: string;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
 // several people per cell (the capture's `Assignee` holds two); the popover
 // toggles them rather than replacing the value
  const picked = personIds(value);
  const people = personLabels(db.members, value);
  const slug = testid.split("db-cell-")[1];
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState({ left: 0, top: 0, width: 235 });

 // people not already in the cell, filtered by the search box — the original
 // lists only the ones you could still add
  const q = query.trim().toLowerCase();
  const candidates = db.members.filter(
    (m) =>
      !picked.includes(m.id) &&
      (!q ||
        (m.displayName ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q))
  );

  const openAt = () => {
    const box = ref.current?.getBoundingClientRect();
    if (box) {
 // over the cell, not under it: the original's picker starts at the cell's own
 // top-left, its chips row standing where the cell's people were
 // the original's picker is exactly the cell's width and is capped at 333px
 // tall, with its list scrolling inside that
      const width = Math.max(220, Math.round(box.width));
      setAnchor({
        left: Math.round(Math.min(box.left, window.innerWidth - width - 8)),
        top: Math.round(Math.min(box.top, window.innerHeight - POPOVER_MAX_H - 8)),
        width,
      });
    }
    setQuery("");
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
 // The popover lives in a portal, so it is NOT inside `ref` — checking only
 // `ref` treated every click on it as an outside click, closed it on mousedown,
 // and the button's click never landed. That is why picking a person did
 // nothing.
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(id: string) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    onSet(next.length ? next : null);
  }

 // However many people a cell holds it stays one line and is simply clipped by
 // the column — the real table has no "N개 더 보기" in a cell (that pill is a
 // filter chip in the toolbar, which is where `target.html` has it).
  return (
    <div ref={ref} className="relative h-full w-full">
      <button
        data-testid={testid}
        onClick={openAt}
 // the whole cell opens the picker, as the original's does — its cell carries
 // `cursor: pointer` across its full width, not just over the names
        className="flex h-full min-h-[1.5rem] w-full cursor-pointer items-center gap-1 overflow-hidden px-1.5 py-1"
      >
        {people.length ? (
          <>
            {people.map((p) => (
              <span key={p.id} className="flex shrink-0 items-center gap-1">
                <UserAvatar user={{ displayName: p.label, avatarUrl: p.avatarUrl }} size={20} />
                <span className="whitespace-nowrap text-sm text-neutral-700 dark:text-neutral-200">
                  {p.label}
                </span>
              </span>
            ))}
          </>
        ) : (
          <span className="inline-block h-5 w-full" aria-hidden="true" />
        )}
      </button>
      {open &&
        createPortal(
 // In a portal, positioned against the cell: the table's cells clip their
 // content to one line, and a popover rendered inside one was cut off.
          <div
            ref={popRef}
            data-testid={`db-person-popover-${slug}`}
            style={{ left: anchor.left, top: anchor.top, width: anchor.width, maxHeight: POPOVER_MAX_H }}
            className="popover-anim fixed z-50 flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white py-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
          >
            {/* the people already in the cell, each with its own remove — the
                original puts them above the search box as chips */}
            {people.length > 0 && (
              <div className="flex shrink-0 flex-wrap gap-1 px-2 pb-1.5">
                {people.map((p) => (
                  <span
                    key={p.id}
                    className="flex items-center gap-1 rounded bg-neutral-100 py-0.5 pl-0.5 pr-1 dark:bg-neutral-700"
                  >
                    <UserAvatar user={{ displayName: p.label, avatarUrl: p.avatarUrl }} size={18} />
                    <span className="max-w-[9rem] truncate text-xs text-neutral-700 dark:text-neutral-200">
                      {p.label}
                    </span>
                    <button
                      data-testid={`db-person-${slug}-remove-${p.id}`}
                      aria-label="항목 제거"
                      onClick={() => toggle(p.id)}
                      className="text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="shrink-0 px-2 pb-1.5">
              <input
                data-testid={`db-person-${slug}-search`}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded bg-neutral-100 px-2 py-1 text-sm outline-none placeholder:text-neutral-400 dark:bg-neutral-700 dark:text-neutral-100"
              />
            </div>
            <p className="shrink-0 px-3 pb-1 pt-0.5 text-[11px] text-neutral-400">원하는 만큼 선택</p>
            <div className="min-h-0 flex-1 overflow-y-auto">
            {candidates.length === 0 && (
              <p className="px-3 py-2 text-xs text-neutral-400">결과 없음</p>
            )}
            {candidates.map((m) => (
              <button
                key={m.id}
                data-testid={`db-person-${slug}-${m.id}`}
                onClick={() => toggle(m.id)}
                className="flex w-full items-center gap-2 px-2 py-1 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                <UserAvatar user={m} size={20} />
                <span className="flex-1 truncate text-sm text-neutral-700 dark:text-neutral-200">
                  {m.displayName || m.email || "이름 없음"}
                  {m.id === db.me && <span className="text-neutral-400">(나)</span>}
                </span>
              </button>
            ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

