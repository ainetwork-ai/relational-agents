"use client";

import { useEffect, useRef, useState } from "react";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { useDismiss } from "@/hooks/use-dismiss";
import { useAnchored } from "@/hooks/use-anchored";
import { createPortal } from "react-dom";
import { X, Plus, ChevronDown, Trash2 } from "lucide-react";
import { FilterIcon, ChevronSmallIcon, PlusSmallIcon, SortArrowIcon } from "@/components/icons/database-toolbar";
import type { DbProperty, ViewFilter, ViewFilterGroup, FilterOp } from "@/lib/db/schema";
import {
  opsForType,
  opNeedsValue,
  OP_LABEL,
  DATE_TOKENS,
  WITHIN_TOKENS,
  findOption,
  personLabel,
  filterIsActive,
} from "@/lib/db-values";
import { OptionChip } from "./option-chip";
import { useDb } from "./database-block";
import { MemorySelect, TYPE_ICON } from "./memory-select";
import { PropertyTypeIcon } from "./property-type-icon";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";

const selectCls =
  "rounded border border-neutral-200 bg-white px-1.5 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200";

const SELECTISH = ["select", "status", "multi_select"];
const PERSONISH = ["person", "created_by", "last_edited_by"];
const DATEISH = ["date", "created_time", "last_edited_time"];

const propOptions = (props: DbProperty[]) =>
  props.map((p) => ({ value: p.id, label: p.name, icon: TYPE_ICON[p.type] ?? "•" }));
const opOptions = (t: T, ops: FilterOp[]) =>
  ops.map((op) => ({ value: op, label: t(opLabel(op)) }));

// the operator / relative-date labels are db-values' English tables, translated
// at render — that English is also what tests and older configs know
const opLabel = (op: FilterOp) => OP_LABEL[op];
const tokenLabel = (x: { token: string; label: string }) => x.label;
// property-type caption in the picker (Notion's type names)
const TYPE_LABEL: Record<string, string> = {
  title: "Title",
  text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  status: "Status",
  date: "Date",
  person: "Person",
  checkbox: "Checkbox",
  url: "URL",
  relation: "Relational",
  formula: "Formula",
  rollup: "Rollup",
  email: "Email",
  phone: "Phone",
  files: "Files & media",
  created_time: "Created time",
  last_edited_time: "Last edited time",
  created_by: "Created by",
  last_edited_by: "Last edited by",
};

/** The ONE type-aware filter-value editor (a single editing
 * surface): multi-checkbox "is any of" for select/status/person, relative
 * presets for dates, plain inputs otherwise. Used by chip popovers AND the
 * advanced panel — the old panel-only single <select> silently collapsed
 * any-of arrays to one value. */
function FilterValueEditor({
  i,
  prop,
  f,
  update,
  onCommit,
}: {
  i: number | string;
  prop: DbProperty;
  f: ViewFilter;
  update: (i: number | string, patch: Partial<ViewFilter>) => void;
  onCommit?: () => void;
}) {
  const db = useDb();
  const t = useT();
  const arr: unknown[] = Array.isArray(f.value) ? f.value : f.value === undefined ? [] : [f.value];
  const toggle = (id: string) => {
    const next = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
    update(i, { value: next.length ? next : undefined });
  };

  if (SELECTISH.includes(prop.type)) {
    return (
      <div className="max-h-44 min-w-40 overflow-y-auto py-0.5">
        {(prop.config.options ?? []).map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <input
              data-testid={`db-fchip-opt-${i}-${o.id}`}
              type="checkbox"
              checked={arr.includes(o.id)}
              onChange={() => toggle(o.id)}
              className="h-3.5 w-3.5 accent-blue-500"
            />
            <OptionChip color={o.color} title={o.name} dot={prop.type === "status"}>
              {o.name}
            </OptionChip>
          </label>
        ))}
      </div>
    );
  }
  if (prop.type === "relation") {
 // pick target rows — "contains [row]" (mirror props list the
 // SOURCE db's rows; both ids point at the same database)
    const targetId = prop.config.relationDatabaseId ?? prop.config.mirrorOf?.databaseId;
    const snap = targetId ? db.related[targetId] : undefined;
    const titleP = snap?.properties.find((p) => p.type === "title");
    return (
      <div className="max-h-44 min-w-40 overflow-y-auto py-0.5">
        {!snap && <p className="px-1.5 py-1 text-xs text-neutral-400">Loading rows…</p>}
        {(snap?.rows ?? [])
          .filter((r) => !r.values.__template)
          .map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >
              <input
                data-testid={`db-fchip-opt-${i}-${r.id}`}
                type="checkbox"
                checked={arr.includes(r.id)}
                onChange={() => toggle(r.id)}
                className="h-3.5 w-3.5 accent-blue-500"
              />
              <span className="truncate text-xs text-neutral-700 dark:text-neutral-200">
                {String((titleP && r.values[titleP.id]) || t("Untitled"))}
              </span>
            </label>
          ))}
      </div>
    );
  }
  if (PERSONISH.includes(prop.type)) {
    return (
      <div className="max-h-44 min-w-40 overflow-y-auto py-0.5">
        {db.members.map((m) => (
          <label
            key={m.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <input
              data-testid={`db-fchip-opt-${i}-${m.id}`}
              type="checkbox"
              checked={arr.includes(m.id)}
              onChange={() => toggle(m.id)}
              className="h-3.5 w-3.5 accent-blue-500"
            />
            <span className="text-xs text-neutral-700 dark:text-neutral-200">
              {personLabel(db.members, m.id)}
            </span>
          </label>
        ))}
      </div>
    );
  }
  if (DATEISH.includes(prop.type) && f.op === "within") {
    return (
      <select
        data-testid={`db-fchip-within-${i}`}
        value={(f.value as string) ?? "today"}
        onChange={(e) => update(i, { value: e.target.value })}
        className={`${selectCls} w-full min-w-36`}
      >
        {WITHIN_TOKENS.map((x) => (
          <option key={x.token} value={x.token}>
            {t(tokenLabel(x))}
          </option>
        ))}
      </select>
    );
  }
  if (DATEISH.includes(prop.type)) {
    const dateToken = typeof f.value === "string" && f.value.startsWith("@");
    return (
      <div className="flex min-w-36 flex-col gap-1">
        <select
          data-testid={`db-fchip-datepreset-${i}`}
          value={dateToken ? (f.value as string) : "exact"}
          onChange={(e) =>
            update(i, { value: e.target.value === "exact" ? undefined : e.target.value })
          }
          className={`${selectCls} w-full`}
        >
          <option value="exact">{t("Exact date…")}</option>
          {DATE_TOKENS.map((x) => (
            <option key={x.token} value={x.token}>
              {t(tokenLabel(x))}
            </option>
          ))}
        </select>
        {!dateToken && (
          <input
            data-testid={`db-fchip-date-${i}`}
            type="date"
            value={(f.value as string) ?? ""}
            onChange={(e) => update(i, { value: e.target.value || undefined })}
            onKeyDown={(e) => !isImeComposing(e) && e.key === "Enter" && onCommit?.()}
            className={`${selectCls} w-full`}
          />
        )}
      </div>
    );
  }
  return (
    <input
      data-testid={`db-fchip-value-${i}`}
      type={prop.type === "number" ? "number" : "text"}
      value={(f.value as string) ?? ""}
      onChange={(e) => update(i, { value: e.target.value || undefined })}
      onKeyDown={(e) => !isImeComposing(e) && e.key === "Enter" && onCommit?.()}
      placeholder={t("Value")}
      className={`${selectCls} w-full min-w-28`}
    />
  );
}

/** Toolbar Filter button. Opens flow: a searchable PROPERTY PICKER —
 * picking one creates the filter (its chip editor auto-opens below). An
 * "Advanced filter" mode lists every rule in one panel. */
export function FilterBar() {
  const db = useDb();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"picker" | "panel">("picker");
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const filters = db.activeView.config.filters ?? [];

 // publish open state so the chips row won't auto-open a second editor for a
 // filter added from this panel
  const setFilterUiOpen = db.setFilterUiOpen;
  useEffect(() => {
    setFilterUiOpen(open);
    return () => setFilterUiOpen(false);
  }, [open, setFilterUiOpen]);

  useDismiss(open, () => {
    setOpen(false);
  }, ref, popRef);

  const groups = db.activeView.config.filterGroups ?? [];
  const totalRules = filters.length + groups.reduce((a, g) => a + g.filters.length, 0);

  function commit(next: ViewFilter[]) {
    db.patchView({ ...db.activeView.config, filters: next }, { draft: true });
  }
  function commitGroups(next: ViewFilterGroup[]) {
    db.patchView({ ...db.activeView.config, filterGroups: next }, { draft: true });
  }
  function updateGroupRule(gi: number, ri: number, patch: Partial<ViewFilter>) {
    commitGroups(
      groups.map((g, gx) =>
        gx === gi
          ? { ...g, filters: g.filters.map((f, fx) => (fx === ri ? { ...f, ...patch } : f)) }
          : g
      )
    );
  }
  function update(i: number | string, patch: Partial<ViewFilter>) {
    commit(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function addFilter(prop?: DbProperty) {
    const p = prop ?? db.properties[0];
    if (!p) return;
    commit([...filters, { propertyId: p.id, op: opsForType(p.type)[0] }]);
    db.setRulesRowOpen(true);
  }
  const sortCount = db.activeView.config.sorts?.length ?? 0;
  function toggleOpen() {
 // With rules in place the toolbar button folds/unfolds the rule row under
 // the tabs — the original's behaviour (the row is what shows the chips).
 // With nothing to show it opens the property picker instead.
    if (totalRules || sortCount) {
      db.setRulesRowOpen(!db.rulesRowOpen);
      setOpen(false);
      return;
    }
    setOpen((v) => !v);
    setMode("picker");
    setQ("");
  }

  const propById = (id: string) => db.properties.find((p) => p.id === id);
  const matches = db.properties.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

 // portalled and placed — inside the page's scroller this popover was cut off
 // when its trigger sat low in the window
  useAnchored(open, btnRef, popRef, { align: "end" });

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        data-testid="db-filter"
        data-tip={t("Filter")}
        aria-label={t("Filter")}
        onClick={toggleOpen}
                // 28×28, radius 6, 16px icon — and ACTIVE means a blue icon, not a
        // blue chip: the original never fills these (measured toolbar, six of
        // them at a 28px pitch)
        className={`flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors ${
          (totalRules || sortCount) && db.rulesRowOpen ? "bg-[rgba(33,27,23,0.05)] dark:bg-neutral-800" : ""
        } ${
          totalRules
            ? "text-[rgb(39,131,222)] hover:bg-[rgba(33,27,23,0.05)]"
            : "text-[rgb(90,90,88)] hover:bg-[rgba(33,27,23,0.05)] dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <FilterIcon />
      </button>

      {open && mode === "picker" &&
        createPortal(
          <div ref={popRef}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 overflow-y-auto w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <input
            data-testid="db-filter-search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (!isImeComposing(e) && e.key === "Enter" && matches[0]) {
 // clear the suppress-flag in the SAME batch so the new
 // filter's chip editor auto-opens below
                db.setFilterUiOpen(false);
                addFilter(matches[0]);
                setOpen(false);
              }
            }}
            placeholder={t("Filter by…")}
            className="mb-1 w-full rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          />
          <div className="max-h-56 overflow-y-auto">
            {matches.map((p) => (
              <button
                key={p.id}
                data-testid={`db-filter-pick-${p.id}`}
                onClick={() => {
                  db.setFilterUiOpen(false); // same-batch clear → editor auto-opens
                  addFilter(p);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <span className="w-4 shrink-0 text-center text-[10px] text-neutral-400">
                  {TYPE_ICON[p.type] ?? "•"}
                </span>
                <span className="truncate">{p.name}</span>
                <span className="ml-auto shrink-0 pl-2 text-[10px] text-neutral-400">
                  {TYPE_LABEL[p.type] ? t(TYPE_LABEL[p.type]) : p.type.replace("_", " ")}
                </span>
              </button>
            ))}
          </div>
          <button
            data-testid="db-filter-advanced"
            onClick={() => setMode("panel")}
            className="mt-1 flex w-full items-center gap-1 rounded border-t border-neutral-100 px-2 pb-1 pt-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-700"
          >
            <Plus size={12} /> {t("Advanced filter")}
          </button>
        </div>,
          document.body
        )}

      {open && mode === "panel" && (
        <div className="popover-anim absolute right-0 top-8 z-40 w-[28rem] rounded-lg border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          {filters.length === 0 && groups.length === 0 && (
            <p className="px-1 py-2 text-xs text-neutral-400">{t("No filters applied.")}</p>
          )}
          {filters.length + groups.length >= 2 && (
            <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-neutral-400">
              <span>{t("Match")}</span>
              <select
                data-testid="db-filter-conjunction"
                value={db.activeView.config.filterConjunction ?? "and"}
                onChange={(e) =>
                  db.patchView(
                    {
                      ...db.activeView.config,
                      filterConjunction: e.target.value as "and" | "or",
                    },
                    { draft: true }
                  )
                }
                className={selectCls}
              >
                <option value="and">{t("All (AND)")}</option>
                <option value="or">{t("Any (OR)")}</option>
              </select>
              <span>{t("Condition")}</span>
            </div>
          )}
          {filters.map((f, i) => {
            const prop = propById(f.propertyId);
            const ops = prop ? opsForType(prop.type) : [];
            return (
              <div key={i} className="mb-1 flex flex-wrap items-start gap-1">
                <MemorySelect
                  testid={`db-filter-prop-${i}`}
                  value={prop ? f.propertyId : undefined}
                  placeholder={t("(Deleted property)")}
                  options={propOptions(db.properties)}
                  onChange={(v) => {
                    const np = propById(v)!;
                    update(i, { propertyId: np.id, op: opsForType(np.type)[0], value: undefined });
                  }}
                />
                <MemorySelect
                  testid={`db-filter-op-${i}`}
                  value={f.op}
                  options={opOptions(t, ops)}
                  searchable={false}
                  onChange={(v) => update(i, { op: v as FilterOp, value: undefined })}
                />
                {prop && opNeedsValue(f.op) && (
                  <div className="min-w-0 flex-1">
                    <FilterValueEditor i={i} prop={prop} f={f} update={update} />
                  </div>
                )}
                <button
                  data-testid={`db-filter-remove-${i}`}
                  onClick={() => commit(filters.filter((_, idx) => idx !== i))}
                  className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-700"
                  aria-label={t("Remove filter")}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
          {groups.map((g, gi) => (
            <div
              key={gi}
              data-testid={`db-fgroup-${gi}`}
              className="mb-1 rounded-md border border-neutral-200 p-1.5 dark:border-neutral-600"
            >
              <div className="mb-1 flex items-center gap-1.5 text-xs text-neutral-400">
                <span>{t("Group — match")}</span>
                <select
                  data-testid={`db-fgroup-conj-${gi}`}
                  value={g.conjunction ?? "and"}
                  onChange={(e) =>
                    commitGroups(
                      groups.map((x, xi) =>
                        xi === gi ? { ...x, conjunction: e.target.value as "and" | "or" } : x
                      )
                    )
                  }
                  className={selectCls}
                >
                  <option value="and">{t("All (AND)")}</option>
                  <option value="or">{t("Any (OR)")}</option>
                </select>
                <button
                  data-testid={`db-fgroup-del-${gi}`}
                  onClick={() => commitGroups(groups.filter((_, xi) => xi !== gi))}
                  className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-700"
                  aria-label={t("Delete group")}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {g.filters.map((f, ri) => {
                const prop = propById(f.propertyId);
                const ops = prop ? opsForType(prop.type) : [];
                return (
                  <div key={ri} className="mb-1 flex flex-wrap items-start gap-1">
                    <MemorySelect
                      testid={`db-fgroup-prop-${gi}-${ri}`}
                      value={prop ? f.propertyId : undefined}
                      placeholder={t("(Deleted property)")}
                      options={propOptions(db.properties)}
                      onChange={(v) => {
                        const np = propById(v)!;
                        updateGroupRule(gi, ri, {
                          propertyId: np.id,
                          op: opsForType(np.type)[0],
                          value: undefined,
                        });
                      }}
                    />
                    <MemorySelect
                      testid={`db-fgroup-op-${gi}-${ri}`}
                      value={f.op}
                      options={opOptions(t, ops)}
                      searchable={false}
                      onChange={(v) =>
                        updateGroupRule(gi, ri, { op: v as FilterOp, value: undefined })
                      }
                    />
                    {prop && opNeedsValue(f.op) && (
                      <div className="min-w-0 flex-1">
                        <FilterValueEditor
                          i={`g${gi}x${ri}`}
                          prop={prop}
                          f={f}
                          update={(_, patch) => updateGroupRule(gi, ri, patch)}
                        />
                      </div>
                    )}
                    <button
                      data-testid={`db-fgroup-remove-${gi}-${ri}`}
                      onClick={() =>
                        commitGroups(
                          groups.map((x, xi) =>
                            xi === gi
                              ? { ...x, filters: x.filters.filter((_, fx) => fx !== ri) }
                              : x
                          )
                        )
                      }
                      className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-700"
                      aria-label={t("Remove rule")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
              <button
                data-testid={`db-fgroup-add-${gi}`}
                onClick={() => {
                  const p = db.properties[0];
                  if (!p) return;
                  commitGroups(
                    groups.map((x, xi) =>
                      xi === gi
                        ? {
                            ...x,
                            filters: [...x.filters, { propertyId: p.id, op: opsForType(p.type)[0] }],
                          }
                        : x
                    )
                  );
                }}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                <Plus size={12} /> {t("Add to group")}
              </button>
            </div>
          ))}
          <button
            data-testid="db-filter-add"
            onClick={() => addFilter()}
            className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <Plus size={12} /> {t("Add filter")}
          </button>
          <button
            data-testid="db-filter-add-group"
            onClick={() => commitGroups([...groups, { conjunction: "and", filters: [] }])}
            className="mt-0.5 flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <Plus size={12} /> {t("Add filter group")}
          </button>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// filter CHIPS: active filters render as always-visible pills
// under the toolbar ("Status is Done, In progress ∨"); clicking a pill opens a
// per-filter editor. Active SORTS show as pills in the same row (keep
// one shared rule bar). "+ Filter" adds inline.
// ===========================================================================

/** Human summary of a filter's value for its chip label. */
function valueSummary(
  t: T,
  prop: DbProperty,
  f: ViewFilter,
  members: { id: string; displayName: string }[]
): string {
  if (!opNeedsValue(f.op)) return "";
  const vals = Array.isArray(f.value) ? f.value : f.value === undefined ? [] : [f.value];
  if (!vals.length) return "…";
  const one = (v: unknown): string => {
    if (SELECTISH.includes(prop.type)) return findOption(prop, v)?.name ?? String(v);
    if (PERSONISH.includes(prop.type))
      return members.find((m) => m.id === v)?.displayName ?? String(v);
    if (DATEISH.includes(prop.type)) {
      const tok = DATE_TOKENS.find((x) => x.token === v) ?? WITHIN_TOKENS.find((x) => x.token === v);
      return tok ? t(tokenLabel(tok)) : String(v);
    }
    return String(v);
  };
  return vals.map(one).join(", ");
}

export function FilterChips() {
  const db = useDb();
  const t = useT();
  const config = db.activeView.config;
  const filters = config.filters ?? [];
  const sorts = config.sorts ?? [];
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

 // A freshly ADDED filter auto-opens its editor (whether it came from the
 // toolbar picker, the advanced panel, or the + Filter chip). Adjust-state-
 // during-render — no effect, so the popover opens in the same paint.
  const [prevLen, setPrevLen] = useState(filters.length);
  if (filters.length !== prevLen) {
    setPrevLen(filters.length);
    const last = filters[filters.length - 1];
 // suppressed while the advanced panel is open — it edits the rule itself
    if (filters.length > prevLen && last && !filterIsActive(last) && !db.filterUiOpen)
      setOpenIdx(filters.length - 1);
  }

  useEffect(() => {
    if (openIdx === null) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpenIdx(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [openIdx]);

  if ((!filters.length && !sorts.length) || !db.rulesRowOpen) return null;

  function commit(next: ViewFilter[]) {
    db.patchView({ ...config, filters: next }, { draft: true });
  }
  function update(i: number | string, patch: Partial<ViewFilter>) {
    commit(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  const propById = (id: string) => db.properties.find((p) => p.id === id);

 // Measured off the original's rule row (Projects › on-going projects,
 // 2026-08-27): 4px above, 4px more inside, then a 40px strip that scrolls
 // sideways (no wrapping) with 8px padding and 6px gaps. Every chip is 24
 // tall: 14px/24px text, 8px side padding, 32px radius, blue on
 // rgba(0,124,215,.094). Sorts come first, a 1px rule (mx 6) parts them from
 // the filters, and `+ Filter` closes the row in grey with a 12px right margin.
  const chipCls =
    "flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[32px] bg-[rgba(0,124,215,0.094)] px-2 text-[14px] leading-6 text-[rgb(39,131,222)] transition-colors hover:bg-[rgba(0,124,215,0.16)] dark:bg-blue-900/30 dark:text-blue-300";

  return (
    <div
      ref={ref}
      data-testid="db-filter-chips"
 // 4px under the tab row, then the original's 1px transparent top border and
 // 4px padding — 45 tall over the 40px strip, and the table follows directly
      className="mt-1 border-t border-transparent pt-1"
    >
      <div className="h-10 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex h-10 items-center gap-1.5 p-2 text-[14px]">
      {/* active sorts lead the row */}
      {sorts.map((s, i) => {
        const prop = propById(s.propertyId);
        if (!prop) return null;
        return (
          <button
            key={`s${i}`}
            data-testid={`db-sort-chip-${i}`}
            onClick={() =>
              db.patchView(
                {
                  ...config,
                  sorts: sorts.map((x, idx) =>
                    idx === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x
                  ),
                },
                { draft: true }
              )
            }
            aria-label={t("Toggle sort direction")}
            className={chipCls}
          >
            <SortArrowIcon dir={s.dir} />
            <span className="max-w-[180px] truncate">{prop.name}</span>
            <ChevronSmallIcon />
          </button>
        );
      })}
      {sorts.length > 0 && filters.length > 0 && (
        <div aria-hidden data-testid="db-rules-separator" className="mx-1.5 h-6 w-px shrink-0 bg-[rgba(42,28,0,0.07)] dark:bg-neutral-700" />
      )}
 {/* no and/or control in the row — the original keeps the conjunction
          inside the filter menu (our advanced panel has it) */}
      {filters.map((f, i) => {
        const prop = propById(f.propertyId);
        if (!prop)
          return (
 // orphaned rule (property deleted): inert for matching, but VISIBLE
 // and removable — never an invisible ghost
            <span
              key={i}
              data-testid={`db-filter-chip-${i}`}
              className="flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[32px] border border-dashed border-neutral-300 px-2 text-[14px] leading-6 text-neutral-400 dark:border-neutral-600"
            >
              {t("Deleted property")}
              <button
                data-testid={`db-fchip-remove-${i}`}
                onClick={() => commit(filters.filter((_, idx) => idx !== i))}
                aria-label={t("Remove filter")}
                className="hover:text-red-500"
              >
                <X size={14} />
              </button>
            </span>
          );
        const incomplete = !filterIsActive(f);
 // the original's chip reads `Status: In progress,Needs review` — the
 // operator is spelt out only when it is not the type's default one
        const defaultOp = opsForType(prop.type)[0];
        return (
          <div key={i} className="relative shrink-0">
            <button
              data-testid={`db-filter-chip-${i}`}
              onClick={() => setOpenIdx((v) => (v === i ? null : i))}
              className={
                incomplete
                  ? "flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[32px] border border-dashed border-neutral-300 px-2 text-[14px] leading-6 text-neutral-400 hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
                  : chipCls
              }
            >
              <PropertyTypeIcon type={prop.type} size={19.2} tone="current" />
              <span className="max-w-[180px] truncate">
                <span className="font-medium">{prop.name}</span>
                {incomplete ? (
                  ""
                ) : (
                  <>
                    {": "}
                    {f.op !== defaultOp && `${t(opLabel(f.op))} `}
                    {opNeedsValue(f.op) && valueSummary(t, prop, f, db.members)}
                  </>
                )}
              </span>
              <ChevronSmallIcon />
            </button>
            {openIdx === i && (
              <ChipEditor
                i={i}
                f={f}
                prop={prop}
                update={update}
                commit={commit}
                close={() => setOpenIdx(null)}
              />
            )}
          </div>
        );
      })}
      <button
        data-testid="db-filter-chip-add"
        onClick={() => {
          const prop = db.properties[0];
          if (!prop) return;
          commit([...filters, { propertyId: prop.id, op: opsForType(prop.type)[0] }]);
          setOpenIdx(filters.length);
        }}
        className="mr-3 flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl pl-[5px] pr-[9px] text-[14px] leading-6 text-[rgb(161,158,153)] transition-colors hover:bg-[rgba(33,27,23,0.05)] dark:hover:bg-neutral-800"
      >
        <PlusSmallIcon /> {t("Filter")}
      </button>
        </div>
      </div>
    </div>
  );
}

/** Per-chip editor popover: property × operator × type-aware value. */
function ChipEditor({
  i,
  f,
  prop,
  update,
  commit,
  close,
}: {
  i: number;
  f: ViewFilter;
  prop: DbProperty;
  update: (i: number | string, patch: Partial<ViewFilter>) => void;
  commit: (next: ViewFilter[]) => void;
  close: () => void;
}) {
  const db = useDb();
  const t = useT();
  const filters = db.activeView.config.filters ?? [];
  const ops = opsForType(prop.type);

  return (
    <div className="popover-anim absolute left-0 top-7 z-40 w-64 rounded-lg border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
      <div className="mb-1.5 flex items-center gap-1">
        <MemorySelect
          testid={`db-fchip-prop-${i}`}
          value={f.propertyId}
          options={propOptions(db.properties)}
          onChange={(v) => {
            const np = db.properties.find((p) => p.id === v)!;
            update(i, { propertyId: np.id, op: opsForType(np.type)[0], value: undefined });
          }}
        />
        <MemorySelect
          testid={`db-fchip-op-${i}`}
          value={f.op}
          options={opOptions(t, ops)}
          searchable={false}
          onChange={(v) => update(i, { op: v as FilterOp, value: undefined })}
        />
      </div>

      {opNeedsValue(f.op) && (
        <FilterValueEditor i={i} prop={prop} f={f} update={update} onCommit={close} />
      )}

      <button
        data-testid={`db-fchip-remove-${i}`}
        onClick={() => {
          close();
          commit(filters.filter((_, idx) => idx !== i));
        }}
        className="mt-1.5 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-700"
      >
        <Trash2 size={12} /> {t("Delete filter")}
      </button>
    </div>
  );
}
