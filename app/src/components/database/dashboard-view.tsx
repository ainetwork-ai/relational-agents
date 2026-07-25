"use client";

import { useState } from "react";
import { Plus, X, ChevronLeft, ChevronRight, Pencil, Check } from "lucide-react";
import type { DashWidget, DbProperty, DbRow, DbView } from "@/lib/db/schema";
import { applyView, groupRowsBy, optionClass } from "@/lib/db-values";
import { useDb } from "./database-block";
import { BoardView } from "./board-view";

// ===========================================================================
// Dashboard view — per notion.com/help/dashboards: a widget canvas over one
// database. Up to 12 widgets, up to 4 per row (width = quarters of a row);
// each widget carries its own data config (group-by, aggregate, row cap).
// EDIT mode arranges/configures widgets; VIEW mode is for reading and
// clicking through. The view's own filters/sorts act as the global filter.
// ===========================================================================

const MAX_WIDGETS = 12;

const KINDS: { kind: DashWidget["kind"]; label: string }[] = [
  { kind: "counter", label: "Counter" },
  { kind: "bar", label: "Bar chart" },
  { kind: "donut", label: "Donut chart" },
  { kind: "table", label: "Table" },
  { kind: "board", label: "Board" },
  { kind: "list", label: "List" },
];

// SVG needs literal colors; these mirror the option-chip palette
const OPTION_HEX: Record<string, string> = {
  gray: "#9ca3af", blue: "#60a5fa", green: "#4ade80", red: "#f87171",
  yellow: "#facc15", purple: "#c084fc", orange: "#fb923c", pink: "#f472b6",
};

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Group rows and aggregate a value per group (count, or sum of a number). */
function seriesFor(rows: DbRow[], prop: DbProperty | undefined, w: DashWidget) {
  const groups = groupRowsBy(rows, prop) ?? [];
  const colorOf = (key: string) => prop?.config.options?.find((o) => o.id === key)?.color ?? "gray";
  return groups
    .map((g) => ({
      key: g.key,
      label: g.label,
      color: colorOf(g.key),
      value:
        w.aggregate === "sum" && w.aggregatePropertyId
          ? g.rows.reduce((a, r) => a + (Number(r.values[w.aggregatePropertyId!]) || 0), 0)
          : g.rows.length,
    }))
    .filter((s) => s.value > 0);
}

function aggLabel(w: DashWidget, props: DbProperty[]) {
  if (w.aggregate === "sum") {
    const p = props.find((x) => x.id === w.aggregatePropertyId);
    return p ? `Sum of ${p.name}` : "Sum";
  }
  return "Count";
}

export function DashboardView({ view }: { view: DbView }) {
  const db = useDb();
  const rows = applyView(db.rows, db.properties, view.config, db.me, db.related);
  const titleProp = db.properties.find((p) => p.type === "title");
  const groupable = db.properties.filter((p) => p.type === "select" || p.type === "status");
  const numberProps = db.properties.filter((p) => p.type === "number");
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // an unconfigured dashboard gets a sensible starter layout (not persisted
  // until the user edits — Notion also auto-suggests the first arrangement)
  const widgets: DashWidget[] =
    view.config.widgets ??
    ([
      { id: "w-count", kind: "counter", width: 1, aggregate: "count" },
      groupable[0] && { id: "w-donut", kind: "donut", width: 1, groupByPropertyId: groupable[0].id, aggregate: "count" },
      groupable[0] && { id: "w-bar", kind: "bar", width: 2, groupByPropertyId: groupable[0].id, aggregate: "count" },
      { id: "w-table", kind: "table", width: 4, limit: 5 },
    ].filter(Boolean) as DashWidget[]);

  const save = (next: DashWidget[]) => db.patchView({ ...view.config, widgets: next });
  const patchWidget = (id: string, patch: Partial<DashWidget>) =>
    save(widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const move = (id: string, dir: -1 | 1) => {
    const i = widgets.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const addWidget = (kind: DashWidget["kind"]) => {
    if (widgets.length >= MAX_WIDGETS) return;
    const w: DashWidget = {
      id: newId(),
      kind,
      width: kind === "table" || kind === "board" ? 4 : 1,
      aggregate: "count",
      groupByPropertyId: groupable[0]?.id,
      limit: 5,
    };
    save([...widgets, w]);
  };

  const rowTitle = (r: DbRow) => (titleProp && (r.values[titleProp.id] as string)) || "Untitled";

  // ---- per-kind bodies -------------------------------------------------------

  const renderCounter = (w: DashWidget) => {
    const value =
      w.aggregate === "sum" && w.aggregatePropertyId
        ? rows.reduce((a, r) => a + (Number(r.values[w.aggregatePropertyId!]) || 0), 0)
        : rows.length;
    return (
      <div className="flex h-full flex-col justify-center py-2">
        <div data-testid={`db-dashw-value-${w.id}`} className="text-2xl font-bold tracking-tight text-neutral-800 dark:text-neutral-100">
          {Number.isInteger(value) ? value : value.toFixed(1)}
        </div>
        <div className="mt-0.5 text-[11px] font-medium text-neutral-400">{aggLabel(w, db.properties)}</div>
      </div>
    );
  };

  const renderBar = (w: DashWidget) => {
    const prop = db.properties.find((p) => p.id === w.groupByPropertyId) ?? groupable[0];
    const series = seriesFor(rows, prop, w);
    const max = Math.max(1, ...series.map((s) => s.value));
    if (!prop) return <p className="text-xs text-neutral-400">Pick a select/status property.</p>;
    return (
      <div className="flex flex-col gap-1.5 py-1">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className={`w-24 shrink-0 truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${optionClass(s.color)}`}>{s.label}</span>
            <div className="h-3.5 flex-1 overflow-hidden rounded-sm bg-neutral-100 dark:bg-neutral-700/60">
              <div className={`h-full rounded-sm ${optionClass(s.color)}`} style={{ width: `${Math.round((s.value / max) * 100)}%` }} />
            </div>
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-neutral-500">{s.value}</span>
          </div>
        ))}
        {series.length === 0 && <p className="text-xs text-neutral-400">No values yet</p>}
      </div>
    );
  };

  const renderDonut = (w: DashWidget) => {
    const prop = db.properties.find((p) => p.id === w.groupByPropertyId) ?? groupable[0];
    const series = seriesFor(rows, prop, w);
    const total = series.reduce((a, s) => a + s.value, 0);
    const R = 34, C = 2 * Math.PI * R, GAP = series.length > 1 ? 2 : 0;
    let acc = 0;
    return (
      <div className="flex items-center gap-3 py-1">
        <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0 -rotate-90">
          {series.map((s) => {
            const len = total ? (s.value / total) * C : 0;
            const el = (
              <circle
                key={s.key}
                cx="44" cy="44" r={R} fill="none"
                stroke={OPTION_HEX[s.color] ?? OPTION_HEX.gray}
                strokeWidth="11"
                strokeDasharray={`${Math.max(len - GAP, 0.5)} ${C - Math.max(len - GAP, 0.5)}`}
                strokeDashoffset={-acc}
              />
            );
            acc += len;
            return el;
          })}
          <text x="44" y="44" transform="rotate(90 44 44)" textAnchor="middle" dominantBaseline="central" className="fill-neutral-800 text-base font-bold dark:fill-neutral-100">
            {total}
          </text>
        </svg>
        <div className="flex min-w-0 flex-col gap-1">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: OPTION_HEX[s.color] ?? OPTION_HEX.gray }} />
              <span className="truncate">{s.label}</span>
              <span className="ml-auto pl-2 tabular-nums text-neutral-400">{s.value}</span>
            </div>
          ))}
          {series.length === 0 && <p className="text-xs text-neutral-400">No values yet</p>}
        </div>
      </div>
    );
  };

  const renderTable = (w: DashWidget) => {
    const hidden = new Set(view.config.hiddenProperties ?? []);
    const cols = db.properties.filter((p) => p.type !== "title" && !hidden.has(p.id)).slice(0, 3);
    const list = rows.slice(0, w.limit ?? 5);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-neutral-400">
              <th className="py-1 pr-2 font-medium">{titleProp?.name ?? "Name"}</th>
              {cols.map((c) => (
                <th key={c.id} className="py-1 pr-2 font-medium">{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr
                key={r.id}
                data-testid={`db-dashw-row-${r.id}`}
                onClick={() => db.openRow(r.id)}
                className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
              >
                <td className="max-w-[220px] truncate py-1.5 pr-2 font-medium text-neutral-800 dark:text-neutral-100">{rowTitle(r)}</td>
                {cols.map((c) => {
                  const v = r.values[c.id];
                  const opt = c.config.options?.find((o) => o.id === v);
                  return (
                    <td key={c.id} className="max-w-[160px] truncate py-1.5 pr-2 text-neutral-500">
                      {opt ? <span className={`rounded px-1.5 py-0.5 text-[11px] ${optionClass(opt.color)}`}>{opt.name}</span> : String(v ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="py-2 text-xs text-neutral-400">No items</p>}
      </div>
    );
  };

  const renderList = (w: DashWidget) => (
    <div className="flex flex-col">
      {rows.slice(0, w.limit ?? 5).map((r) => (
        <button
          key={r.id}
          data-testid={`db-dashw-row-${r.id}`}
          onClick={() => db.openRow(r.id)}
          className="truncate rounded px-1.5 py-1 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700/60"
        >
          {rowTitle(r)}
        </button>
      ))}
      {rows.length === 0 && <p className="text-xs text-neutral-400">No items</p>}
    </div>
  );

  const renderBoard = (w: DashWidget) => (
    <div className="overflow-x-auto">
      <BoardView view={{ ...view, type: "board", config: { ...view.config, groupByPropertyId: w.groupByPropertyId ?? groupable[0]?.id } }} />
    </div>
  );

  const BODY: Record<DashWidget["kind"], (w: DashWidget) => React.ReactNode> = {
    counter: renderCounter,
    bar: renderBar,
    donut: renderDonut,
    table: renderTable,
    board: renderBoard,
    list: renderList,
  };

  const widgetTitle = (w: DashWidget) => {
    if (w.title) return w.title;
    const g = db.properties.find((p) => p.id === w.groupByPropertyId);
    if (w.kind === "counter") return aggLabel(w, db.properties);
    if (w.kind === "bar" || w.kind === "donut") return g ? `${aggLabel(w, db.properties)} by ${g.name}` : KINDS.find((k) => k.kind === w.kind)!.label;
    return KINDS.find((k) => k.kind === w.kind)!.label;
  };

  return (
    <div data-testid="db-dashboard-view" className="flex flex-col gap-2 py-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-neutral-400">
          {widgets.length}/{MAX_WIDGETS} widgets
        </span>
        <div className="ml-auto flex items-center gap-1">
          {editing && (
            <div className="relative">
              <button
                data-testid="db-dashw-add"
                onClick={() => setAddOpen((v) => !v)}
                disabled={widgets.length >= MAX_WIDGETS}
                className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Plus size={12} /> Add widget
              </button>
              {addOpen && (
                <div className="popover-anim absolute right-0 top-8 z-40 w-36 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
                  {KINDS.map((k) => (
                    <button
                      key={k.kind}
                      data-testid={`db-dashw-add-${k.kind}`}
                      onClick={() => {
                        setAddOpen(false);
                        addWidget(k.kind);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            data-testid="db-dash-edit"
            onClick={() => setEditing((v) => !v)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
              editing
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            {editing ? <Check size={12} /> : <Pencil size={12} />}
            {editing ? "Done" : "Edit widgets"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {widgets.map((w) => (
          <div
            key={w.id}
            data-testid={`db-dashw-${w.id}`}
            style={{ gridColumn: `span ${Math.min(w.width, 4)} / span ${Math.min(w.width, 4)}` }}
            className="min-w-0 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-800/60"
          >
            <div className="mb-1.5 flex items-center gap-1">
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{widgetTitle(w)}</span>
              {editing && (
                <span className="ml-auto flex shrink-0 items-center gap-0.5">
                  <button data-testid={`db-dashw-left-${w.id}`} onClick={() => move(w.id, -1)} aria-label="Move left" className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"><ChevronLeft size={12} /></button>
                  <button data-testid={`db-dashw-right-${w.id}`} onClick={() => move(w.id, 1)} aria-label="Move right" className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"><ChevronRight size={12} /></button>
                  <button data-testid={`db-dashw-remove-${w.id}`} onClick={() => save(widgets.filter((x) => x.id !== w.id))} aria-label="Remove widget" className="rounded p-0.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"><X size={12} /></button>
                </span>
              )}
            </div>

            {editing && (
              <div className="mb-2 flex flex-wrap items-center gap-1">
                <select
                  data-testid={`db-dashw-kind-${w.id}`}
                  value={w.kind}
                  onChange={(e) => patchWidget(w.id, { kind: e.target.value as DashWidget["kind"] })}
                  className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>{k.label}</option>
                  ))}
                </select>
                {(w.kind === "bar" || w.kind === "donut" || w.kind === "board") && (
                  <select
                    data-testid={`db-dashw-group-${w.id}`}
                    value={w.groupByPropertyId ?? ""}
                    onChange={(e) => patchWidget(w.id, { groupByPropertyId: e.target.value || undefined })}
                    className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                  >
                    {groupable.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
                {(w.kind === "counter" || w.kind === "bar" || w.kind === "donut") && (
                  <select
                    data-testid={`db-dashw-agg-${w.id}`}
                    value={w.aggregate === "sum" ? w.aggregatePropertyId ?? "" : "count"}
                    onChange={(e) =>
                      patchWidget(
                        w.id,
                        e.target.value === "count"
                          ? { aggregate: "count", aggregatePropertyId: undefined }
                          : { aggregate: "sum", aggregatePropertyId: e.target.value }
                      )
                    }
                    className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                  >
                    <option value="count">Count</option>
                    {numberProps.map((p) => (
                      <option key={p.id} value={p.id}>Sum of {p.name}</option>
                    ))}
                  </select>
                )}
                {(w.kind === "table" || w.kind === "list") && (
                  <select
                    data-testid={`db-dashw-limit-${w.id}`}
                    value={w.limit ?? 5}
                    onChange={(e) => patchWidget(w.id, { limit: Number(e.target.value) })}
                    className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                  >
                    {[5, 10, 25, 50, 100].map((n) => (
                      <option key={n} value={n}>{n} items</option>
                    ))}
                  </select>
                )}
                <select
                  data-testid={`db-dashw-width-${w.id}`}
                  value={w.width}
                  onChange={(e) => patchWidget(w.id, { width: Number(e.target.value) as DashWidget["width"] })}
                  className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}/4 width</option>
                  ))}
                </select>
              </div>
            )}

            {BODY[w.kind](w)}
          </div>
        ))}
      </div>
    </div>
  );
}
