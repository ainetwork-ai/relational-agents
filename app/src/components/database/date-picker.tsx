"use client";

/**
 * The date popover, rebuilt from the original's own
 * (docs/database_date_picker.html + docs/notion-captures.md, 2026-08-06).
 *
 * Measured on the original, light theme:
 *   panel        248 wide, white, radius 6
 *   input box    224x28, radius 6, bg rgba(66,35,3,.03), 14px/16.8
 *   caption      14px/500 · 오늘 12px #8E8B86 · chevrons #A5A5A5
 *   week head    32x32 cells, 12px #8B9898
 *   day          28x28 button inside a 32x32 cell, radius 6, 14px
 *                in-month #2C2C2B · outside #8B9898
 *                selected bg #2783DE white · today ::after circle #E56458 white
 *   divider      1px rgba(42,28,0,.07), inset 12
 *   option row   240x28, radius 6 · label 14px #2C2C2B · value 14px #7D7A75
 *   toggle       30x18, radius 44
 * and the rows, in the original's order: 종료일 · 날짜 형식 · 시간 포함 ·
 * 리마인더 · 삭제 · 리마인더에 대해 알아보기.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ChevronRight as Caret, HelpCircle } from "lucide-react";
import {
  DATE_FORMATS,
  fmtDay,
  fmtMonth,
  todayIso,
  type DateFormat,
} from "@/lib/date-format";

/** A date value is either a plain "YYYY-MM-DD" string (legacy) or an object
 * { start: "YYYY-MM-DD[THH:MM]", end?, includeTime? } for time-of-day/ranges. */
export interface DateParts {
  date: string;
  time: string;
  end: string;
  endTime: string;
  reminder: string;
}

export function parseDateValue(v: unknown): DateParts {
  const blank: DateParts = { date: "", time: "", end: "", endTime: "", reminder: "" };
  if (typeof v === "string") {
    const [date, time] = v.split("T");
    return { ...blank, date: date ?? "", time: time ?? "" };
  }
  if (v && typeof v === "object") {
    const o = v as { start?: string; end?: string; reminder?: string };
    const [date, time] = (o.start ?? "").split("T");
    const [end, endTime] = (o.end ?? "").split("T");
    return {
      date: date ?? "",
      time: time ?? "",
      end: end ?? "",
      endTime: endTime ?? "",
      reminder: o.reminder ?? "",
    };
  }
  return blank;
}

export function buildDateValue({ date, time, end, endTime, reminder }: DateParts): unknown {
  if (!date) return null;
  const start = time ? `${date}T${time}` : date;
 // an end, a time or a reminder makes it a structured value; a bare date stays a string
  if (!end && !time && !reminder) return start;
  return {
    start,
    ...(end ? { end: endTime ? `${end}T${endTime}` : end } : {}),
    ...(reminder ? { reminder } : {}),
    includeTime: !!time,
  };
}

/** The original's reminder choices for an all-day date. */
const REMINDERS: { id: string; label: string }[] = [
  { id: "", label: "알림 없음" },
  { id: "same_day", label: "이벤트 당일" },
  { id: "1d", label: "1일 전" },
  { id: "2d", label: "2일 전" },
  { id: "1w", label: "1주 전" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Six weeks from the Sunday on or before the 1st — the original's grid never
 * changes height as you page through months. */
function weeksOf(y: number, m: number): { iso: string; day: number; outside: boolean }[][] {
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const out: { iso: string; day: number; outside: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      row.push({
        iso: isoOf(cur.getFullYear(), cur.getMonth(), cur.getDate()),
        day: cur.getDate(),
        outside: cur.getMonth() !== m,
      });
    }
    out.push(row);
  }
  return out;
}

/** the {y, m} a "YYYY-MM-DD" falls in (m is 0-based) */
function monthOf(iso: string): { y: number; m: number } {
  const [y, m] = iso.split("-").map(Number);
  return { y, m: m - 1 };
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const WEEKDAY_FULL = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

/**
 * The calendar alone: caption, 오늘, month arrows, and the day grid.
 * `range` paints the days between start and end the way the original does.
 */
export function MonthGrid({
  idBase,
  selected,
  rangeEnd,
  onPick,
}: {
  idBase: string;
  selected: string;
  rangeEnd?: string;
  onPick: (iso: string) => void;
}) {
  const today = todayIso();
  const base = selected || today;
 // the month on screen is the paged-to one, but it re-follows the value whenever
 // that changes — typing a date into the box jumps the grid to it. Adjusting
 // state during render (rather than in an effect) is what React asks for here.
  const [nav, setNav] = useState(() => ({ ...monthOf(base), from: base }));
  if (nav.from !== base) setNav({ ...monthOf(base), from: base });
  const ym = nav;
  const setYm = (next: { y: number; m: number }) => setNav({ ...next, from: base });

  const lo = rangeEnd && selected && rangeEnd < selected ? rangeEnd : selected;
  const hi = rangeEnd && selected && rangeEnd < selected ? selected : rangeEnd;

  return (
    <div data-testid={`db-date-grid-${idBase}`} className="select-none px-3">
      <div className="flex h-[25px] items-center justify-between">
        <h2 className="text-[14px] font-medium leading-[21px] text-[#2c2c2b] dark:text-neutral-100">
          {fmtMonth(ym.y, ym.m)}
        </h2>
        <div className="flex items-center gap-2">
          <button
            data-testid={`db-date-today-${idBase}`}
            onClick={() => setYm(monthOf(today))}
            className="rounded px-[10px] text-[12px] leading-5 text-[#8e8b86] hover:bg-[rgba(66,35,3,0.06)] dark:hover:bg-white/10"
          >
            오늘
          </button>
          <button
            data-testid={`db-date-prevmonth-${idBase}`}
            aria-label="Previous month"
            onClick={() => setYm(ym.m === 0 ? { y: ym.y - 1, m: 11 } : { y: ym.y, m: ym.m - 1 })}
            className="flex h-5 w-4 items-center justify-center text-[#a5a5a5] hover:text-[#2c2c2b] dark:hover:text-neutral-100"
          >
            <ChevronLeft size={14} strokeWidth={2} />
          </button>
          <button
            data-testid={`db-date-nextmonth-${idBase}`}
            aria-label="Next month"
            onClick={() => setYm(ym.m === 11 ? { y: ym.y + 1, m: 0 } : { y: ym.y, m: ym.m + 1 })}
            className="flex h-5 w-4 items-center justify-center text-[#a5a5a5] hover:text-[#2c2c2b] dark:hover:text-neutral-100"
          >
            <ChevronRight size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      <table className="w-[224px] border-collapse">
        <thead>
          <tr>
            {WEEKDAYS.map((d, i) => (
              <th
                key={d}
                scope="col"
                className="h-8 w-8 p-0 text-[12px] font-normal leading-[18px] text-[#8b9898]"
              >
                <span aria-hidden="true">{d}</span>
                <span className="sr-only">{WEEKDAY_FULL[i]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeksOf(ym.y, ym.m).map((week, wi) => (
            <tr key={wi}>
              {week.map((c) => {
                const isSel = c.iso === selected || (!!rangeEnd && c.iso === rangeEnd);
                const inRange = !!lo && !!hi && c.iso > lo && c.iso < hi;
                const isToday = c.iso === today;
                return (
                  <td
                    key={c.iso}
                    className={`h-8 w-8 p-0 text-center ${inRange ? "bg-[rgba(39,131,222,0.1)]" : ""}`}
                  >
                    <button
                      data-testid={`db-date-day-${idBase}-${c.iso}`}
                      onClick={() => onPick(c.iso)}
                      className={`relative h-7 w-7 rounded-md text-[14px] leading-[16.8px] ${
                        isSel
                          ? "bg-[#2783de] text-white"
                          : isToday
                            ? "text-white"
                            : c.outside
                              ? "text-[#8b9898] hover:bg-[rgba(66,35,3,0.06)] dark:hover:bg-white/10"
                              : "text-[#2c2c2b] hover:bg-[rgba(66,35,3,0.06)] dark:text-neutral-100 dark:hover:bg-white/10"
                      }`}
                    >
                      {/* today is a filled circle UNDER the digit, so a selected
                          today still reads as selected (blue), like the original */}
                      {isToday && !isSel && (
                        <span className="absolute inset-0 -z-0 m-auto h-7 w-7 rounded-full bg-[#e56458]" />
                      )}
                      <span className="relative">{c.day}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Divider() {
  return <div className="mx-3 my-1 h-px bg-[rgba(42,28,0,0.07)] dark:bg-white/10" />;
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`relative block h-[18px] w-[30px] rounded-full transition-colors ${
        on ? "bg-[#2783de]" : "bg-[rgba(55,53,47,0.16)] dark:bg-white/20"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
          on ? "left-[14px]" : "left-[2px]"
        }`}
      />
    </span>
  );
}

function OptRow({
  testid,
  label,
  children,
  onClick,
}: {
  testid?: string;
  label: string;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className="flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-[14px] leading-[16.8px] text-[#2c2c2b] hover:bg-[rgba(66,35,3,0.04)] dark:text-neutral-100 dark:hover:bg-white/5"
    >
      <span>{label}</span>
      {children}
    </button>
  );
}

/** A right-hand submenu (날짜 형식 / 리마인더) — 180 wide on the original. */
function SubMenu({
  testid,
  items,
  active,
  onPick,
}: {
  testid: string;
  items: { id: string; label: string }[];
  active: string;
  onPick: (id: string) => void;
}) {
  return (
    <div
      data-testid={testid}
      className="absolute left-full top-0 z-10 ml-1 w-[180px] space-y-px rounded-md bg-white p-1 dark:bg-[#252525]"
      style={{ boxShadow: PANEL_SHADOW }}
    >
      {items.map((it) => (
        <button
          key={it.id || "none"}
          data-testid={`${testid}-${it.id || "none"}`}
          onClick={() => onPick(it.id)}
          className="flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-[14px] leading-[16.8px] text-[#2c2c2b] hover:bg-[rgba(66,35,3,0.04)] dark:text-neutral-100 dark:hover:bg-white/5"
        >
          <span>{it.label}</span>
          {active === it.id && <Check size={14} className="text-[#2c2c2b] dark:text-neutral-100" />}
        </button>
      ))}
    </div>
  );
}

export const PANEL_SHADOW =
  "rgba(15, 15, 15, 0.05) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 3px 6px, rgba(15, 15, 15, 0.2) 0px 9px 24px";

/** One editable date box at the top of the panel. Typing is parsed loosely so
 * the box can be edited in whatever the column's format is. */
function DateBox({
  testid,
  date,
  time,
  fmt,
  includeTime,
  active,
  autoFocus,
  placeholder,
  onFocus,
  onDate,
  onTime,
}: {
  testid: string;
  date: string;
  time: string;
  fmt: DateFormat;
  includeTime: boolean;
  active: boolean;
  autoFocus?: boolean;
  placeholder: string;
  onFocus: () => void;
  onDate: (iso: string) => void;
  onTime: (hm: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (date ? fmtDay(date, fmt) : "");
  const ref = useRef<HTMLInputElement>(null);
 // the original opens with the whole date selected, so typing replaces it
  useEffect(() => {
    if (autoFocus) ref.current?.select();
  }, [autoFocus]);
  return (
    <div className="flex gap-1">
      <input
        ref={ref}
        data-testid={testid}
        autoFocus={autoFocus}
        value={shown}
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) {
            const iso = parseTyped(draft, fmt);
            if (iso) onDate(iso);
            setDraft(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className={`h-7 min-w-0 flex-1 rounded-md bg-[rgba(66,35,3,0.03)] px-2 text-[14px] leading-[16.8px] text-[#2c2c2b] outline-none placeholder:text-[#8e8b86] dark:bg-white/5 dark:text-neutral-100 ${
          active ? "ring-1 ring-inset ring-[#2783de]" : ""
        }`}
      />
      {includeTime && (
        <input
          data-testid={`${testid}-time`}
          type="time"
          value={time}
          onFocus={onFocus}
          onChange={(e) => onTime(e.target.value)}
          className="h-7 w-[84px] rounded-md bg-[rgba(66,35,3,0.03)] px-2 text-[14px] leading-[16.8px] text-[#2c2c2b] outline-none dark:bg-white/5 dark:text-neutral-100"
        />
      )}
    </div>
  );
}

/** Read back a typed box in any of the six formats (plus plain ISO). */
function parseTyped(text: string, fmt: DateFormat): string | null {
  const s = text.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const nums = s.match(/^(\d{1,4})\s*[/.\-년]\s*(\d{1,2})\s*[/.\-월]?\s*(\d{1,2})/);
  if (nums) {
    const [a, b, c] = [Number(nums[1]), Number(nums[2]), Number(nums[3])];
    let y: number, m: number, d: number;
    if (a > 31 || fmt === "ymd") [y, m, d] = [a, b, c];
    else if (fmt === "dmy") [y, m, d] = [c, b, a];
    else [y, m, d] = [c, a, b];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return isoOf(y, m - 1, d);
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime()))
    return isoOf(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return null;
}

/**
 * The whole panel. `onFormat` is optional: without it the 날짜 형식 row still
 * shows the format but cannot change it (a surface with no property to write).
 */
export function DatePickerPanel({
  idBase,
  parts,
  fmt,
  onChange,
  onFormat,
  onClear,
}: {
  idBase: string;
  parts: DateParts;
  fmt: DateFormat;
  onChange: (next: Partial<DateParts>) => void;
  onFormat?: (f: DateFormat) => void;
  onClear: () => void;
}) {
  const [hasEnd, setHasEnd] = useState(!!parts.end);
  const [editing, setEditing] = useState<"start" | "end">("start");
  const [sub, setSub] = useState<"" | "format" | "reminder">("");
  const includeTime = !!parts.time || !!parts.endTime;
  const rowsRef = useRef<HTMLDivElement>(null);

  const pick = (iso: string) => {
    if (hasEnd && editing === "end") onChange({ end: iso });
    else if (hasEnd && !parts.end) onChange({ date: iso, end: iso });
    else onChange({ date: iso });
  };

  return (
    <div className="w-[248px] pb-1 text-[14px]">
      <div className="flex flex-col gap-1 px-3 pb-[9px] pt-3">
        <DateBox
          testid={`db-date-input-${idBase}`}
          date={parts.date}
          time={parts.time}
          fmt={fmt}
          includeTime={includeTime}
          active={hasEnd && editing === "start"}
          autoFocus
          placeholder="날짜 입력"
          onFocus={() => setEditing("start")}
          onDate={(iso) => onChange({ date: iso })}
          onTime={(hm) => onChange({ time: hm })}
        />
        {hasEnd && (
          <DateBox
            testid={`db-date-end-${idBase}`}
            date={parts.end}
            time={parts.endTime}
            fmt={fmt}
            includeTime={includeTime}
            active={editing === "end"}
            placeholder="종료일"
            onFocus={() => setEditing("end")}
            onDate={(iso) => onChange({ end: iso })}
            onTime={(hm) => onChange({ endTime: hm })}
          />
        )}
      </div>

      <MonthGrid
        idBase={idBase}
        selected={parts.date}
        rangeEnd={hasEnd ? parts.end : ""}
        onPick={pick}
      />

      <Divider />

      <div ref={rowsRef} className="relative space-y-px px-1">
        <OptRow
          testid={`db-date-endtoggle-${idBase}`}
          label="종료일"
          onClick={() => {
            const next = !hasEnd;
            setHasEnd(next);
            setEditing(next ? "end" : "start");
            if (!next) onChange({ end: "", endTime: "" });
            else if (parts.date && !parts.end) onChange({ end: parts.date });
          }}
        >
          <Toggle on={hasEnd} />
        </OptRow>

        <div className="relative">
          <OptRow
            testid={`db-date-format-${idBase}`}
            label="날짜 형식"
            onClick={() => setSub((s) => (s === "format" ? "" : "format"))}
          >
            <span className="flex items-center gap-1 text-[#7d7a75]">
              {DATE_FORMATS.find((f) => f.id === fmt)?.label}
              <Caret size={14} />
            </span>
          </OptRow>
          {sub === "format" && (
            <SubMenu
              testid={`db-date-formats-${idBase}`}
              items={DATE_FORMATS}
              active={fmt}
              onPick={(id) => {
                onFormat?.(id as DateFormat);
                setSub("");
              }}
            />
          )}
        </div>

        <OptRow
          testid={`db-date-timetoggle-${idBase}`}
          label="시간 포함"
          onClick={() =>
            includeTime
              ? onChange({ time: "", endTime: "" })
              : onChange({ time: "09:00", ...(parts.end ? { endTime: "09:00" } : {}) })
          }
        >
          <Toggle on={includeTime} />
        </OptRow>

        <div className="relative">
          <OptRow
            testid={`db-date-reminder-${idBase}`}
            label="리마인더"
            onClick={() => setSub((s) => (s === "reminder" ? "" : "reminder"))}
          >
            <span className="flex items-center gap-1 text-[#7d7a75]">
              {REMINDERS.find((r) => r.id === parts.reminder)?.label ?? "알림 없음"}
              <Caret size={14} />
            </span>
          </OptRow>
          {sub === "reminder" && (
            <SubMenu
              testid={`db-date-reminders-${idBase}`}
              items={REMINDERS}
              active={parts.reminder}
              onPick={(id) => {
                onChange({ reminder: id });
                setSub("");
              }}
            />
          )}
        </div>
      </div>

      <Divider />

      <div className="px-1">
        <OptRow testid={`db-date-clear-${idBase}`} label="삭제" onClick={onClear} />
      </div>

      <Divider />

      <div className="px-1">
        <div className="flex h-7 items-center gap-3 px-2 text-[14px] leading-[16.8px] text-[#7d7a75]">
          <HelpCircle size={16} />
          <span>리마인더에 대해 알아보기</span>
        </div>
      </div>
    </div>
  );
}
