/**
 * Date rendering for date properties.
 *
 * The original keeps the format on the PROPERTY, not on the value: its
 * Projects table shows `Start date` as `08/04/2026` and `End date` as
 * `2026년 8월 4일` at the same time. The picker's `날짜 형식` row is what
 * chooses it, and every cell in that column follows.
 *
 * The six choices and their order are the original's
 * (docs/database_date_picker.html, captured 2026-08-06).
 */
export type DateFormat = "full" | "relaxed" | "mdy" | "dmy" | "ymd" | "relative";

export const DATE_FORMATS: { id: DateFormat; label: string }[] = [
  { id: "full", label: "전체 날짜" },
  { id: "relaxed", label: "날짜 간단히 표기" },
  { id: "mdy", label: "월/일/년" },
  { id: "dmy", label: "일/월/년" },
  { id: "ymd", label: "년/월/일" },
  { id: "relative", label: "상대" },
];

/** what a date property renders as before anyone picks — the original's default */
export const DEFAULT_DATE_FORMAT: DateFormat = "full";

/** Formatting knobs: the Intl locale (ko-KR / en-US — the user's language,
 *  `useIntlLocale()`) and, for `relative`, a translator for 오늘/어제/내일. */
export interface DateFmtOpts {
  locale?: string;
  t?: (key: string, vars?: Record<string, string | number>) => string;
}

const DEFAULT_INTL = "ko-KR";
const id = (k: string, vars?: Record<string, string | number>) =>
  vars ? k.replace(/\{(\w+)\}/g, (m, v) => (v in vars ? String(vars[v]) : m)) : k;

function toDate(iso: string): Date | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** today as "YYYY-MM-DD" in local time (never via toISOString — that is UTC) */
export function todayIso(): string {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

function relative(iso: string, opts: DateFmtOpts): string {
  const d = toDate(iso);
  const today = toDate(todayIso());
  if (!d || !today) return iso;
  const t = opts.t ?? id;
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return t("오늘");
  if (days === -1) return t("어제");
  if (days === 1) return t("내일");
  if (Math.abs(days) <= 6) return days < 0 ? t("{n}일 전", { n: -days }) : t("{n}일 후", { n: days });
  return fmtDay(iso, "full", opts);
}

/** One "YYYY-MM-DD" in the given format. Unparseable input passes through. */
export function fmtDay(iso: string, fmt: DateFormat = DEFAULT_DATE_FORMAT, opts: DateFmtOpts = {}): string {
  const d = toDate(iso);
  if (!d) return iso;
  const LOCALE = opts.locale ?? DEFAULT_INTL;
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  switch (fmt) {
    case "mdy":
      return `${m}/${day}/${y}`;
    case "dmy":
      return `${day}/${m}/${y}`;
    case "ymd":
      return `${y}/${m}/${day}`;
    case "relative":
      return relative(iso, opts);
    case "relaxed":
      return d.toLocaleDateString(LOCALE, { year: "numeric", month: "short", day: "numeric" });
    default:
      return d.toLocaleDateString(LOCALE, { year: "numeric", month: "long", day: "numeric" });
  }
}

/** "HH:MM" as the original writes it — `오후 3:30`. */
export function fmtTime(hm: string, opts: DateFmtOpts = {}): string {
  const [h, mi] = hm.split(":").map(Number);
  if (Number.isNaN(h)) return hm;
  const d = new Date(2000, 0, 1, h, mi || 0);
  return d.toLocaleTimeString(opts.locale ?? DEFAULT_INTL, { hour: "numeric", minute: "2-digit" });
}

/** `2026년 8월` — the calendar's caption. */
export function fmtMonth(y: number, m: number, opts: DateFmtOpts = {}): string {
  return new Date(y, m, 1).toLocaleDateString(opts.locale ?? DEFAULT_INTL, { year: "numeric", month: "long" });
}

/** The full cell label: start [time] → end [time]. */
export function fmtDateRange(
  { date, time, end, endTime }: { date: string; time?: string; end?: string; endTime?: string },
  fmt: DateFormat = DEFAULT_DATE_FORMAT,
  opts: DateFmtOpts = {}
): string {
  if (!date) return "";
  const head = `${fmtDay(date, fmt, opts)}${time ? ` ${fmtTime(time, opts)}` : ""}`;
  if (!end) return head;
  return `${head} → ${fmtDay(end, fmt, opts)}${endTime ? ` ${fmtTime(endTime, opts)}` : ""}`;
}
