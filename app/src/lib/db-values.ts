import type {
  DbProperty,
  DbRow,
  ViewConfig,
  SelectOption,
  FilterOp,
  PropertyType,
  ViewFilter,
} from "@/lib/db/schema";
import type { PublicUser } from "@/lib/auth/public-user";
import { evalFormula, rollupValue } from "@/lib/db-computed";

/** Operators offered for each property type in the filter builder (the full
 *  Notion operator set per type). */
/** Target-db snapshots keyed by database id — lets relation mirrors and
 *  rollups resolve synchronously inside applyView. */
export interface RelatedSnapshots {
  [dbId: string]: { properties: DbProperty[]; rows: DbRow[] };
}

export function opsForType(type: PropertyType): FilterOp[] {
  switch (type) {
    case "title":
    case "text":
    case "url":
    case "email":
    case "phone":
      return [
        "contains",
        "not_contains",
        "equals",
        "not_equals",
        "starts_with",
        "ends_with",
        "is_empty",
        "not_empty",
      ];
    case "number":
      return ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "not_empty"];
    case "select":
    case "status":
      return ["equals", "not_equals", "is_empty", "not_empty"];
    case "multi_select":
      return ["contains", "not_contains", "is_empty", "not_empty"];
    case "person":
    case "created_by":
    case "last_edited_by":
      return ["equals", "not_equals", "is_me", "is_empty", "not_empty"];
    case "date":
    case "created_time":
    case "last_edited_time":
      return [
        "equals",
        "before",
        "after",
        "on_or_before",
        "on_or_after",
        "within",
        "is_empty",
        "not_empty",
      ];
    case "formula":
    case "rollup":
      return ["equals", "not_equals", "contains", "gt", "gte", "lt", "lte", "is_empty", "not_empty"];
    case "relation":
      return ["contains", "not_contains", "is_empty", "not_empty"];
    case "checkbox":
      return ["checked", "unchecked"];
    default:
      return ["not_empty", "is_empty"];
  }
}

/** The value a filter/sort actually evaluates for a property — audit columns
 *  and formulas aren't in row.values (Notion filters on them regardless). */
export function resolveFilterValue(
  row: DbRow,
  prop: DbProperty,
  props: DbProperty[],
  related?: RelatedSnapshots
): unknown {
  switch (prop.type) {
    case "created_time":
      return row.createdAt ? String(row.createdAt) : undefined;
    case "last_edited_time":
      return row.updatedAt ? String(row.updatedAt) : undefined;
    case "created_by":
      return row.createdBy ?? undefined;
    case "last_edited_by":
      return row.updatedBy ?? undefined;
    case "formula":
      try {
        return evalFormula(prop.config.formula, props, row) || undefined;
      } catch {
        return undefined;
      }
    case "relation": {
      const mirror = prop.config.mirrorOf;
      if (mirror) {
        // two-way mirror: reverse links computed from the source db
        const src = related?.[mirror.databaseId];
        if (!src) return undefined;
        const ids = src.rows
          .filter((r) => {
            const v = r.values[mirror.propId];
            return Array.isArray(v) && (v as string[]).includes(row.id);
          })
          .map((r) => r.id);
        return ids.length ? ids : undefined;
      }
      return row.values[prop.id];
    }
    case "rollup": {
      const rollup = prop.config.rollup;
      const relProp = props.find((p) => p.id === rollup?.relationPropertyId);
      const targetDbId = relProp?.config.relationDatabaseId;
      const snap = targetDbId ? related?.[targetDbId] : undefined;
      if (!rollup?.targetPropertyId || !relProp || !snap) return undefined;
      const linked = row.values[relProp.id];
      const linkedIds: string[] = Array.isArray(linked) ? (linked as string[]) : [];
      const linkedRows = snap.rows.filter((r) => linkedIds.includes(r.id));
      return rollupValue(linkedRows, rollup.targetPropertyId, rollup.function) || undefined;
    }
    default:
      return row.values[prop.id];
  }
}

export const OP_LABEL: Record<FilterOp, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  is_me: "is me",
  not_empty: "is not empty",
  is_empty: "is empty",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  before: "is before",
  after: "is after",
  on_or_before: "is on or before",
  on_or_after: "is on or after",
  within: "is within",
  checked: "is checked",
  unchecked: "is unchecked",
};

/** Whether an operator needs a value input. */
export function opNeedsValue(op: FilterOp): boolean {
  return !["is_me", "is_empty", "not_empty", "checked", "unchecked"].includes(op);
}

// ---- relative dates (Notion's "Today", "One week ago", "is within past week")
/** Point-in-time tokens usable as a date filter value (`@today` …). */
export const DATE_TOKENS: { token: string; label: string }[] = [
  { token: "@today", label: "Today" },
  { token: "@yesterday", label: "Yesterday" },
  { token: "@tomorrow", label: "Tomorrow" },
  { token: "@one_week_ago", label: "One week ago" },
  { token: "@one_week_from_now", label: "One week from now" },
  { token: "@one_month_ago", label: "One month ago" },
  { token: "@one_month_from_now", label: "One month from now" },
];
/** Period tokens for the "is within" operator. */
export const WITHIN_TOKENS: { token: string; label: string }[] = [
  { token: "today", label: "Today" },
  { token: "past_week", label: "The past week" },
  { token: "past_month", label: "The past month" },
  { token: "past_year", label: "The past year" },
  { token: "next_week", label: "The next week" },
  { token: "next_month", label: "The next month" },
  { token: "next_year", label: "The next year" },
];

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shifted(days: number, months = 0, years = 0): string {
  const d = new Date();
  if (months || years) {
    // month/year steps clamp the day-of-month (Jan 31 − 1 month = Dec 31, not
    // Jan 2/3 via day-overflow roll-over)
    const day = d.getDate();
    d.setDate(1);
    d.setFullYear(d.getFullYear() + years, d.getMonth() + months, 1);
    const max = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, max));
  }
  if (days) d.setDate(d.getDate() + days);
  return isoDay(d);
}
/** Resolve a filter's date value — a relative token becomes today's concrete
 *  "YYYY-MM-DD"; a plain date string passes through. */
export function resolveDateValue(value: unknown): string {
  const v = String(value ?? "");
  switch (v) {
    case "@today":
      return shifted(0);
    case "@yesterday":
      return shifted(-1);
    case "@tomorrow":
      return shifted(1);
    case "@one_week_ago":
      return shifted(-7);
    case "@one_week_from_now":
      return shifted(7);
    case "@one_month_ago":
      return shifted(0, -1);
    case "@one_month_from_now":
      return shifted(0, 1);
    default:
      return v.slice(0, 10);
  }
}
/** The [from, to] day range for an "is within" period token. */
export function withinRange(token: unknown): [string, string] {
  const today = shifted(0);
  switch (String(token ?? "")) {
    case "past_week":
      return [shifted(-7), today];
    case "past_month":
      return [shifted(0, -1), today];
    case "past_year":
      return [shifted(0, 0, -1), today];
    case "next_week":
      return [today, shifted(7)];
    case "next_month":
      return [today, shifted(0, 1)];
    case "next_year":
      return [today, shifted(0, 0, 1)];
    default:
      return [today, today]; // "today"
  }
}

export const OPTION_COLORS: Record<string, string> = {
  gray: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200",
  green: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-200",
  red: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-200",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-200",
};
export const COLOR_CYCLE = Object.keys(OPTION_COLORS);

export function optionClass(color: string): string {
  return OPTION_COLORS[color] ?? OPTION_COLORS.gray;
}

export function findOption(prop: DbProperty, id: unknown): SelectOption | undefined {
  return prop.config.options?.find((o) => o.id === id);
}

/** A filter that still needs a value (none picked yet) is INACTIVE — the view
 *  stays unfiltered while the user is mid-edit (Notion treats it as a no-op). */
export function filterIsActive(f: { op: FilterOp; value?: unknown }): boolean {
  if (!opNeedsValue(f.op)) return true;
  if (f.value === undefined || f.value === "") return false;
  if (Array.isArray(f.value) && f.value.length === 0) return false;
  return true;
}

/** Apply a view's filters + sorts to the row set. `me` is the current user id. */
export function applyView(
  rows: DbRow[],
  props: DbProperty[],
  config: ViewConfig,
  me: string | null,
  related?: RelatedSnapshots
): DbRow[] {
  // template rows (values.__template) are blueprints, never real data — they
  // never show in any view or count toward calcs.
  let out = rows.filter((r) => !r.values.__template);
  // inactive rules don't restrict: incomplete (no value yet) or orphaned
  // (their property was deleted — a ghost rule must never blank the view).
  const isLive = (f: ViewFilter) =>
    filterIsActive(f) && props.some((p) => p.id === f.propertyId);
  const active = (config.filters ?? []).filter(isLive);
  // nested groups: each group ANDs/ORs its own rules, then counts as ONE hit
  // at the top level (Notion's 2-level advanced filters)
  const groups = (config.filterGroups ?? [])
    .map((g) => ({
      or: g.conjunction === "or",
      filters: (g.filters ?? []).filter(isLive),
    }))
    .filter((g) => g.filters.length > 0);
  const matchOne = (r: DbRow, f: ViewFilter) => {
    const prop = props.find((p) => p.id === f.propertyId)!;
    return matchFilter(resolveFilterValue(r, prop, props, related), f.op, f.value, me, prop.type);
  };
  if (active.length || groups.length) {
    // AND (default) requires every condition; OR requires at least one.
    const or = config.filterConjunction === "or";
    out = out.filter((r) => {
      const hits = [
        ...active.map((f) => matchOne(r, f)),
        ...groups.map((g) => {
          const gh = g.filters.map((f) => matchOne(r, f));
          return g.or ? gh.some(Boolean) : gh.every(Boolean);
        }),
      ];
      return or ? hits.some(Boolean) : hits.every(Boolean);
    });
  }
  for (const s of [...(config.sorts ?? [])].reverse()) {
    const prop = props.find((p) => p.id === s.propertyId);
    if (!prop) continue; // orphaned sort — its property was deleted
    out.sort((a, b) => {
      const cmp = compareValues(
        resolveFilterValue(a, prop, props, related),
        resolveFilterValue(b, prop, props, related),
        prop
      );
      return s.dir === "asc" ? cmp : -cmp;
    });
  }
  return out;
}

function empty(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  return v === undefined || v === null || v === "";
}

/** Column-footer aggregation (Notion "Calculate"). Returns a display string. */
export function computeCalc(rows: DbRow[], propId: string, calc: string): string {
  const vals = rows.map((r) => r.values[propId]);
  const nums = vals
    .filter((v) => v !== undefined && v !== null && v !== "")
    .map((v) => Number(v))
    .filter((n) => !isNaN(n));
  const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  switch (calc) {
    case "count":
      return String(rows.length);
    case "count_values":
      return String(vals.filter((v) => !empty(v)).length);
    case "empty":
      return String(vals.filter((v) => empty(v)).length);
    case "sum":
      return round(nums.reduce((a, b) => a + b, 0));
    case "avg":
      return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : "0";
    case "min":
      return nums.length ? round(Math.min(...nums)) : "";
    case "max":
      return nums.length ? round(Math.max(...nums)) : "";
    default:
      return "";
  }
}

/** The comparable day string of a cell value (coerces `{start}` date objects). */
function cellDay(v: unknown): string {
  return dateStart(v).slice(0, 10);
}

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

export function matchFilter(
  v: unknown,
  op: FilterOp,
  value: unknown,
  me: string | null,
  type?: PropertyType
): boolean {
  // "is / is not" accept an ARRAY value = Notion's "is any of / is none of".
  const wanted: unknown[] = Array.isArray(value) ? value : [value];
  const eq = (): boolean => {
    if (empty(v)) return false;
    // dispatch on the PROPERTY TYPE (not the value's shape): a text cell that
    // happens to look like a date must not get day-prefix matching.
    switch (type) {
      case "date":
      case "created_time":
      case "last_edited_time":
        return wanted.some((w) => cellDay(v) === resolveDateValue(w));
      case "number":
        return wanted.some((w) => Number(v) === Number(w));
      case "title":
      case "text":
      case "url":
      case "email":
      case "phone":
        // Notion text filters are case-insensitive across all operators
        return wanted.some(
          (w) => String(v).toLowerCase() === String(w ?? "").toLowerCase()
        );
      case "formula":
        return wanted.some((w) =>
          NUMERIC_RE.test(String(v)) && NUMERIC_RE.test(String(w))
            ? Number(v) === Number(w)
            : String(v).toLowerCase() === String(w ?? "").toLowerCase()
        );
      case "select":
      case "status":
      case "multi_select":
      case "person":
      case "created_by":
      case "last_edited_by":
        return wanted.some((w) => String(v) === String(w));
      default: {
        // no type known (legacy caller) — keep the shape heuristic
        if (v !== null && typeof v === "object" && !Array.isArray(v))
          return wanted.some((w) => cellDay(v) === resolveDateValue(w));
        if (/^\d{4}-\d{2}-\d{2}/.test(String(v)))
          return wanted.some((w) => cellDay(v) === resolveDateValue(w));
        return wanted.some((w) => String(v) === String(w));
      }
    }
  };
  const has = (): boolean => {
    if (Array.isArray(v)) return wanted.some((w) => v.includes(w));
    return String(v ?? "").toLowerCase().includes(String(wanted[0] ?? "").toLowerCase());
  };
  switch (op) {
    case "is_me":
      return v === me;
    case "is_empty":
      return empty(v);
    case "not_empty":
      return !empty(v);
    case "checked":
      return v === true || /^(true|yes|checked|✓)$/i.test(String(v ?? ""));
    case "unchecked":
      return !(v === true || /^(true|yes|checked|✓)$/i.test(String(v ?? "")));
    case "equals":
      return eq();
    case "not_equals":
      return empty(v) ? true : !eq(); // Notion: empty rows pass "is not X"
    case "contains":
      return has();
    case "not_contains":
      return empty(v) ? true : !has();
    case "starts_with": {
      const w = String(wanted[0] ?? "").toLowerCase();
      if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase().startsWith(w));
      return String(v ?? "").toLowerCase().startsWith(w);
    }
    case "ends_with": {
      const w = String(wanted[0] ?? "").toLowerCase();
      if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase().endsWith(w));
      return String(v ?? "").toLowerCase().endsWith(w);
    }
    case "gt":
      return !empty(v) && Number(v) > Number(value);
    case "gte":
      return !empty(v) && Number(v) >= Number(value);
    case "lt":
      return !empty(v) && Number(v) < Number(value);
    case "lte":
      return !empty(v) && Number(v) <= Number(value);
    case "before":
      return !empty(v) && cellDay(v) < resolveDateValue(value);
    case "after":
      return !empty(v) && cellDay(v) > resolveDateValue(value);
    case "on_or_before":
      return !empty(v) && cellDay(v) <= resolveDateValue(value);
    case "on_or_after":
      return !empty(v) && cellDay(v) >= resolveDateValue(value);
    case "within": {
      if (empty(v)) return false;
      const [from, to] = withinRange(value);
      const d = cellDay(v);
      return d >= from && d <= to;
    }
    default:
      return true;
  }
}

function compareValues(a: unknown, b: unknown, prop?: DbProperty): number {
  const ae = a === undefined || a === null || a === "";
  const be = b === undefined || b === null || b === "";
  if (ae && be) return 0;
  if (ae) return 1; // empties sort last
  if (be) return -1;
  if (prop?.type === "number") return Number(a) - Number(b);
  // dates: compare by start day — a {start,end} range must not stringify to
  // "[object Object]"
  if (prop?.type === "date" || prop?.type === "created_time" || prop?.type === "last_edited_time")
    return dateStart(a).localeCompare(dateStart(b));
  // select/status: Notion sorts by the property's OPTION ORDER, not by the
  // options' internal ids
  if (prop?.type === "select" || prop?.type === "status") {
    const opts = prop.config.options ?? [];
    const ai = opts.findIndex((o) => o.id === a);
    const bi = opts.findIndex((o) => o.id === b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? opts.length : ai) - (bi === -1 ? opts.length : bi);
  }
  return String(a).localeCompare(String(b));
}

/** Partition rows into labelled sections by a select/status property (the
 *  shared group-by used by table sections, list and gallery groupings). */
export function groupRowsBy(
  rows: DbRow[],
  prop: DbProperty | undefined
): { key: string; label: string; rows: DbRow[] }[] | null {
  if (!prop) return null;
  const opts = prop.config.options ?? [];
  return [
    ...opts.map((o) => ({
      key: o.id,
      label: o.name,
      rows: rows.filter((r) => r.values[prop.id] === o.id),
    })),
    {
      key: "__none__",
      label: `No ${prop.name}`,
      rows: rows.filter((r) => {
        const v = r.values[prop.id];
        return !v || !opts.some((o) => o.id === v);
      }),
    },
  ];
}

export function personLabel(members: PublicUser[], id: unknown): string {
  return members.find((m) => m.id === id)?.displayName ?? "";
}

/** Normalize a date property value to its start date string (calendar view
 *  lays rows on `dateStart(value).slice(0,10)`). Handles a plain ISO string or
 *  a `{ start }` range object. */
export function dateStart(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "start" in (value as Record<string, unknown>)) {
    const s = (value as { start?: unknown }).start;
    return typeof s === "string" ? s : "";
  }
  return String(value);
}

/** End date of a range value, or "" for a single date. */
export function dateEnd(value: unknown): string {
  if (value && typeof value === "object" && "end" in (value as Record<string, unknown>)) {
    const e = (value as { end?: unknown }).end;
    return typeof e === "string" ? e : "";
  }
  return "";
}
