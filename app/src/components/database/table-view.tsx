"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Pencil, Maximize2, ChevronRight, GripVertical } from "lucide-react";
import type { DbView, DbProperty, DbRow, PropertyType } from "@/lib/db/schema";
import { applyView, computeCalc } from "@/lib/db-values";
import { fetchDatabaseSnapshot } from "@/lib/db-relation";
import { useDb, PROP_TYPES } from "./database-block";
import { PropertyCell } from "./property-cell";
import { TYPE_ICON } from "./notion-select";

const NO_GROUP = "__nogroup__";

export function TableView({ view }: { view: DbView }) {
  const db = useDb();
  const visible = applyView(db.rows, db.properties, view.config, db.me, db.related);
  // per-view property visibility (ViewOptions → config.hiddenProperties)
  const hidden = view.config.hiddenProperties ?? [];
  const cols = db.properties.filter((p) => !hidden.includes(p.id));
  // sub-item collapse state (rows in this set have their children hidden)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // row multi-select: hover checkboxes + a bulk action bar
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggleChecked = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleCollapse = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Render a group's rows as a hierarchy: each top-level row (parentRowId null)
  // followed by its (recursively) nested children when expanded.
  function renderRows(rows: DbRow[]): ReactNode[] {
    const childrenOf = new Map<string, DbRow[]>();
    for (const r of rows)
      if (r.parentRowId) {
        const list = childrenOf.get(r.parentRowId) ?? [];
        list.push(r);
        childrenOf.set(r.parentRowId, list);
      }
    const out: React.ReactNode[] = [];
    const emit = (row: DbRow, depth: number) => {
      const kids = childrenOf.get(row.id) ?? [];
      out.push(
        <RowLine
          key={row.id}
          row={row}
          cols={cols}
          widths={view.config.widths}
          depth={depth}
          hasChildren={kids.length > 0}
          collapsed={collapsed.has(row.id)}
          onToggle={() => toggleCollapse(row.id)}
          onAddSub={() => void db.addRow({}, row.id)}
          checked={checked.has(row.id)}
          onCheck={() => toggleChecked(row.id)}
        />
      );
      if (!collapsed.has(row.id)) for (const k of kids) emit(k, depth + 1);
    };
    // a sub-item whose parent is filtered OUT still shows, flattened to the
    // top level (Notion) — it must not disappear with its parent
    const present = new Set(rows.map((r) => r.id));
    for (const r of rows) if (!r.parentRowId || !present.has(r.parentRowId)) emit(r, 0);
    return out;
  }

  // General group-by: any select/status property can partition the rows into
  // labelled sections. null = flat.
  const groupProp = db.properties.find(
    (p) => p.id === view.config.groupByPropertyId && (p.type === "select" || p.type === "status")
  );
  const groupable = db.properties.filter((p) => p.type === "select" || p.type === "status");

  let groups: { key: string; label: string; rows: DbRow[] }[] = [
    { key: NO_GROUP, label: "", rows: visible },
  ];
  if (groupProp) {
    const opts = groupProp.config.options ?? [];
    groups = [
      ...opts.map((o) => ({
        key: o.id,
        label: o.name,
        rows: visible.filter((r) => r.values[groupProp.id] === o.id),
      })),
      {
        key: NO_GROUP,
        label: `No ${groupProp.name}`,
        rows: visible.filter((r) => {
          const v = r.values[groupProp.id];
          return !v || !opts.some((o) => o.id === v);
        }),
      },
    ];
  }

  return (
    <div className="w-full overflow-x-auto">
      {checked.size > 0 && (
        <div
          data-testid="db-bulk-bar"
          className="popover-anim sticky left-0 top-0 z-30 mb-1 flex items-center gap-2 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
        >
          <span data-testid="db-bulk-count">{checked.size} selected</span>
          <button
            data-testid="db-bulk-delete"
            onClick={() => {
              for (const id of checked) db.deleteRow(id);
              setChecked(new Set());
            }}
            className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30"
          >
            Delete
          </button>
          <button
            data-testid="db-bulk-clear"
            onClick={() => setChecked(new Set())}
            className="ml-auto rounded px-1.5 py-0.5 hover:bg-white/20"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
      )}
      <div className="min-w-max" data-dbtable>
        {/* group-by control */}
        

        {/* header */}
        <div className="flex border-b border-neutral-200 dark:border-neutral-700">
          <div className="w-24 shrink-0" />
          {cols.map((p) => (
            <ColumnHeader key={p.id} prop={p} view={view} />
          ))}
          <AddPropertyHeader />
        </div>

        {/* rows (optionally grouped) */}
        {groups.map((g) =>
          groupProp && g.rows.length === 0 ? null : (
            <div key={g.key} data-testid={`db-group-${g.key}`}>
              {groupProp && (
                <div
                  data-testid={`db-group-header-${g.key}`}
                  className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50/70 px-2 py-1 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-400"
                >
                  <span>{g.label}</span>
                  <span className="text-neutral-300 dark:text-neutral-600">{g.rows.length}</span>
                </div>
              )}
              {renderRows(g.rows)}
            </div>
          )
        )}

        {/* add row */}
        <button
          data-testid="db-add-row"
          onClick={() => db.addRow()}
          className="flex w-full items-center gap-1 px-2 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-600 dark:hover:bg-neutral-800"
        >
          <Plus size={13} /> New
        </button>

        {/* calculation footer — selects fade in on row hover (Notion); a
            chosen calc stays visible */}
        <div className="group/calcrow flex border-t border-neutral-200 dark:border-neutral-700">
          <div className="w-24 shrink-0" />
          {cols.map((p) => (
            <CalcCell key={p.id} view={view} prop={p} rows={visible} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Notion places "add a property" as a "+" header cell at the right end of
 * the table, not in the toolbar. */
function AddPropertyHeader() {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        data-testid="db-add-prop"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add property"
        data-tip="Add property"
        className="flex h-full w-9 items-center justify-center text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        <Plus size={14} />
      </button>
      {open && (
        <div className="popover-anim absolute right-0 top-8 z-40 w-40 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          {PROP_TYPES.map((pt) => (
            <button
              key={pt.type}
              data-testid={`db-add-prop-${pt.type}`}
              onClick={async () => {
                setOpen(false);
                await db.addProperty(pt.label, pt.type);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {pt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CALC_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Calculate" },
  { value: "count", label: "Count all" },
  { value: "count_values", label: "Count values" },
  { value: "empty", label: "Count empty" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
];

function CalcCell({ view, prop, rows }: { view: DbView; prop: DbProperty; rows: DbRow[] }) {
  const db = useDb();
  const calc = view.config.calcs?.[prop.id] ?? "";
  return (
    <div style={{ width: view.config.widths?.[prop.id] ?? 176 }} className="shrink-0 border-l border-neutral-100 px-1 py-0.5 first:border-l-0 dark:border-neutral-800">
      <select
        data-testid={`db-calc-${prop.id}`}
        value={calc}
        onChange={(e) =>
          db.patchView({
            ...view.config,
            calcs: { ...(view.config.calcs ?? {}), [prop.id]: e.target.value },
          })
        }
        className={`w-full bg-transparent text-[11px] text-neutral-400 outline-none transition-opacity ${
          calc ? "" : "opacity-0 focus:opacity-100 group-hover/calcrow:opacity-100"
        }`}
      >
        {CALC_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {calc && (
        <div
          data-testid={`db-calc-value-${prop.id}`}
          className="px-1 pb-0.5 text-right text-xs font-medium text-neutral-600 dark:text-neutral-300"
        >
          {computeCalc(rows, prop.id, calc)}
        </div>
      )}
    </div>
  );
}

/** Arrow/Tab navigation between table cells. Only fires when the cell
 * wrapper itself is focused — keys inside cell editors are untouched. */
function onCellNavKey(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.target !== e.currentTarget) return;
  const cell = e.currentTarget;
  const rowEl = cell.parentElement;
  const table = cell.closest("[data-dbtable]");
  if (!rowEl || !table) return;
  const cells = Array.from(rowEl.querySelectorAll<HTMLElement>(":scope > [data-cellnav]"));
  const colIdx = cells.indexOf(cell);
  const rows = Array.from(table.querySelectorAll<HTMLElement>("[data-dbrow]"));
  const rowIdx = rows.indexOf(rowEl as HTMLElement);
  const focusCell = (r: number, c: number) => {
    const target = rows[r]?.querySelectorAll<HTMLElement>(":scope > [data-cellnav]")[c];
    if (target) {
      e.preventDefault();
      target.focus();
    }
  };
  switch (e.key) {
    case "ArrowRight":
      focusCell(rowIdx, colIdx + 1);
      break;
    case "ArrowLeft":
      focusCell(rowIdx, colIdx - 1);
      break;
    case "ArrowDown":
      focusCell(rowIdx + 1, colIdx);
      break;
    case "ArrowUp":
      focusCell(rowIdx - 1, colIdx);
      break;
    case "Tab":
      if (e.shiftKey) {
        if (colIdx > 0) focusCell(rowIdx, colIdx - 1);
        else focusCell(rowIdx - 1, cells.length - 1);
      } else {
        if (colIdx < cells.length - 1) focusCell(rowIdx, colIdx + 1);
        else focusCell(rowIdx + 1, 0);
      }
      break;
    case "Enter": {
      const inner = cell.querySelector<HTMLElement>(
        "input, textarea, button, [contenteditable], [tabindex]"
      );
      if (inner) {
        e.preventDefault();
        inner.focus();
        inner.click();
      }
      break;
    }
  }
}

function RowLine({
  row,
  cols,
  widths,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggle,
  onAddSub,
  checked = false,
  onCheck,
}: {
  row: DbRow;
  cols: DbProperty[];
  widths?: Record<string, number>;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  onAddSub?: () => void;
  checked?: boolean;
  onCheck?: () => void;
}) {
  const db = useDb();
  return (
    <div
      data-testid={`db-row-${row.id}`}
      data-dbrow
      style={{ paddingLeft: depth * 24 }}
      className={`group/dbrow flex border-b border-neutral-100 hover:bg-neutral-50/60 dark:border-neutral-800 dark:hover:bg-neutral-800/30 ${
        checked ? "bg-blue-50/70 dark:bg-blue-900/20" : ""
      }`}
    >
      <div className="flex w-24 shrink-0 items-start justify-start gap-0.5 pl-1 pt-1">
        <input
          type="checkbox"
          data-testid={`db-row-check-${row.id}`}
          checked={checked}
          onChange={() => onCheck?.()}
          aria-label="Select row"
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-500 transition-opacity ${
            checked ? "opacity-100" : "opacity-0 group-hover/dbrow:opacity-100"
          }`}
        />
        <button
          data-testid={`db-row-drag-${row.id}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const onUp = (ev: PointerEvent) => {
              window.removeEventListener("pointerup", onUp);
              const el = document.elementFromPoint(ev.clientX, ev.clientY);
              const target = el?.closest(".group\\/dbrow") as HTMLElement | null;
              const tid = target?.getAttribute("data-testid")?.replace("db-row-", "");
              if (!tid || tid === row.id) return;
              const t = db.rows.find((r) => r.id === tid);
              if (!t) return;
              const rect = target!.getBoundingClientRect();
              const before = ev.clientY < rect.y + rect.height / 2;
              db.moveRow(row.id, t.position + (before ? -0.5 : 0.5));
            };
            window.addEventListener("pointerup", onUp);
          }}
          aria-label="Drag to reorder row"
          className="shrink-0 cursor-grab text-neutral-300 opacity-0 transition-opacity hover:text-neutral-500 group-hover/dbrow:opacity-100"
        >
          <GripVertical size={11} />
        </button>
        {hasChildren ? (
          <button
            data-testid={`db-row-expand-${row.id}`}
            onClick={onToggle}
            aria-label={collapsed ? "Expand sub-items" : "Collapse sub-items"}
            className="shrink-0 text-neutral-400 hover:text-neutral-600"
          >
            <ChevronRight
              size={13}
              className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
            />
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <button
          data-testid={`db-open-row-${row.id}`}
          onClick={() => db.openRow(row.id)}
          aria-label="Open row as page"
          title="Open as page"
          className="flex items-center gap-0.5 rounded border border-transparent px-0.5 py-0.5 text-[11px] font-medium text-neutral-400 opacity-0 transition-all hover:border-neutral-200 hover:bg-white hover:text-neutral-700 group-hover/dbrow:opacity-100 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Maximize2 size={11} />
        </button>
        <button
          data-testid={`db-subitem-add-${row.id}`}
          onClick={onAddSub}
          aria-label="Add sub-item"
          title="Add sub-item"
          className="shrink-0 text-neutral-300 opacity-0 transition-opacity hover:text-blue-500 group-hover/dbrow:opacity-100"
        >
          <Plus size={12} />
        </button>
        <button
          data-testid={`db-del-row-${row.id}`}
          onClick={() => db.deleteRow(row.id)}
          aria-label="Delete row"
          className="mt-0.5 shrink-0 text-neutral-300 opacity-0 transition-opacity hover:text-red-500 group-hover/dbrow:opacity-100"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {cols.map((p) =>
        p.type === "title" ? (
          // Title cell: hovering it reveals an "OPEN" button at the right edge
          // opens the row's page (its full mapped content).
          <div
            key={p.id}
            style={{ width: widths?.[p.id] ?? 176 }}
            tabIndex={0}
            data-cellnav
            onKeyDown={onCellNavKey}
            className="group/titlecell relative flex shrink-0 items-center border-l border-neutral-100 first:border-l-0 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <PropertyCell prop={p} row={row} />
            </div>
            <button
              data-testid={`db-title-open-${row.id}`}
              onClick={() => db.openRow(row.id)}
              aria-label="Open"
              title="Open"
              // opacity-0 alone still intercepts clicks — disable pointer events
              // until hover so the invisible button never swallows a title click
              className="pointer-events-none absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px] font-medium text-neutral-500 opacity-0 shadow-sm transition-opacity hover:bg-neutral-50 hover:text-neutral-700 group-hover/titlecell:pointer-events-auto group-hover/titlecell:opacity-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <Maximize2 size={10} /> OPEN
            </button>
          </div>
        ) : (
          <div
            key={p.id}
            style={{ width: widths?.[p.id] ?? 176 }}
            tabIndex={0}
            data-cellnav
            onKeyDown={onCellNavKey}
            className="shrink-0 border-l border-neutral-100 first:border-l-0 dark:border-neutral-800"
          >
            <PropertyCell prop={p} row={row} />
          </div>
        )
      )}
    </div>
  );
}

function ColumnHeader({ prop, view }: { prop: DbProperty; view: DbView }) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  // two-step confirm before the irreversible property delete
  const [delArmed, setDelArmed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // disarm whenever the menu closes (render-time adjustment, not an effect)
  if (!open && delArmed) setDelArmed(false);
  const [draft, setDraft] = useState(prop.name);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function sortBy(dir: "asc" | "desc") {
    db.patchView({ ...view.config, sorts: [{ propertyId: prop.id, dir }] });
    setOpen(false);
  }

  // drag a column header onto another to reorder properties (persists position).
  function onDragPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", onUp);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const header = el?.closest('[data-testid^="db-prop-header-"]') as HTMLElement | null;
      if (!header) return;
      const targetId = header.getAttribute("data-testid")!.replace("db-prop-header-", "");
      if (targetId === prop.id) return;
      const target = db.properties.find((p) => p.id === targetId);
      if (!target) return;
      const rect = header.getBoundingClientRect();
      const before = ev.clientX < rect.x + rect.width / 2;
      db.updateProperty(prop.id, { position: target.position + (before ? -0.5 : 0.5) });
    };
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={ref}
      style={{ width: view.config.widths?.[prop.id] ?? 176 }}
      className="group/col relative shrink-0 border-l border-neutral-200 first:border-l-0 dark:border-neutral-700"
    >
      {/* drag the right edge to resize the column (persists per view) */}
      <div
        data-testid={`db-col-resize-${prop.id}`}
        onPointerDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = view.config.widths?.[prop.id] ?? 176;
          const onMove = (ev: PointerEvent) => {
            const w = Math.max(80, startW + (ev.clientX - startX));
            db.patchView({
              ...view.config,
              widths: { ...(view.config.widths ?? {}), [prop.id]: w },
            });
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
        className="absolute -right-0.5 top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-blue-400/70 hover:bg-blue-300/60"
      />
      <button
        data-testid={`db-col-drag-${prop.id}`}
        onPointerDown={onDragPointerDown}
        aria-label="Drag to reorder column"
        className="absolute right-0.5 top-1 z-10 cursor-grab text-neutral-300 opacity-0 transition-opacity hover:text-neutral-500 group-hover/col:opacity-100 dark:text-neutral-600"
      >
        <GripVertical size={11} />
      </button>
      {renaming ? (
        <input
          data-testid={`db-prop-rename-input-${prop.id}`}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setRenaming(false);
            if (draft.trim() && draft !== prop.name) db.updateProperty(prop.id, { name: draft.trim() });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="w-full bg-white px-2 py-1 text-xs outline-none dark:bg-neutral-900 dark:text-neutral-200"
        />
      ) : (
        <button
          data-testid={`db-prop-header-${prop.id}`}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          <span className="w-3.5 shrink-0 text-center text-[10px] text-neutral-400">
            {TYPE_ICON[prop.type] ?? "•"}
          </span>
          <span className="truncate">{prop.name}</span>
        </button>
      )}
      {open && (
        <div className="popover-anim absolute left-0 top-7 z-40 w-40 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <MenuItem
            testid={`db-prop-rename-${prop.id}`}
            icon={<Pencil size={12} />}
            label="Rename"
            onClick={() => {
              setOpen(false);
              setDraft(prop.name);
              setRenaming(true);
            }}
          />
          <MenuItem
            testid={`db-prop-sort-asc-${prop.id}`}
            icon={<ArrowUp size={12} />}
            label="Sort ascending"
            onClick={() => sortBy("asc")}
          />
          <MenuItem
            testid={`db-prop-sort-desc-${prop.id}`}
            icon={<ArrowDown size={12} />}
            label="Sort descending"
            onClick={() => sortBy("desc")}
          />
          {prop.type !== "title" && (
            <MenuItem
              testid={`db-prop-delete-${prop.id}`}
              icon={<Trash2 size={12} />}
              label={delArmed ? "Delete? This can't be undone" : "Delete property"}
              danger
              onClick={() => {
                if (!delArmed) {
                  setDelArmed(true);
                  return;
                }
                setDelArmed(false);
                setOpen(false);
                db.deleteProperty(prop.id);
              }}
            />
          )}
          {AUTOFILLABLE.includes(prop.type) && (
            <MenuItem
              testid={`db-ai-autofill-${prop.id}`}
              icon={<span className="text-[11px]">✨</span>}
              label="AI autofill empty cells"
              onClick={() => {
                setOpen(false);
                void aiAutofill(db, prop);
              }}
            />
          )}
          {prop.type !== "title" && <PropTypeEditor prop={prop} />}
          {(prop.type === "relation" ||
            prop.type === "formula" ||
            prop.type === "rollup") && <PropConfigEditor prop={prop} />}
          {prop.type === "number" && <NumberConfigEditor prop={prop} />}
          {prop.type === "date" && <DateConfigEditor prop={prop} />}
        </div>
      )}
    </div>
  );
}

const TYPE_CHOICES: PropertyType[] = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "person",
  "checkbox",
  "url",
  "email",
  "phone",
  "files",
];

/** Change a column's type in place (Notion "Edit property → Type"). Values are
 * re-interpreted under the new type; a file-backed db re-derives from the CSV. */
function PropTypeEditor({ prop }: { prop: DbProperty }) {
  const db = useDb();
  const choices = TYPE_CHOICES.includes(prop.type) ? TYPE_CHOICES : [prop.type, ...TYPE_CHOICES];
  return (
    <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-700">
      <label className="mb-1 block text-[10px] font-medium uppercase text-neutral-400">Type</label>
      <select
        data-testid={`db-prop-type-${prop.id}`}
        value={prop.type}
        onChange={(e) => db.updateProperty(prop.id, { type: e.target.value as PropertyType })}
        className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
      >
        {choices.map((t) => (
          <option key={t} value={t}>
            {t.replace("_", " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Date column config: yearly recurrence (birthdays / anniversaries) — the
 * calendar view then matches on month/day across every year. */
function DateConfigEditor({ prop }: { prop: DbProperty }) {
  const db = useDb();
  const cfg = prop.config;
  const yearly = cfg.recurring === "yearly";
  return (
    <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-700">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
        <input
          type="checkbox"
          data-testid={`db-date-recurring-${prop.id}`}
          checked={yearly}
          onChange={(e) =>
            db.updateProperty(prop.id, {
              config: { ...cfg, recurring: e.target.checked ? "yearly" : undefined },
            })
          }
        />
        Repeat yearly (calendar)
      </label>
    </div>
  );
}

/** Number column config: value format + number/bar display. */
function NumberConfigEditor({ prop }: { prop: DbProperty }) {
  const db = useDb();
  const cfg = prop.config;
  return (
    <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-700">
      <label className="mb-1 block text-[10px] font-medium uppercase text-neutral-400">Format</label>
      <select
        data-testid={`db-number-format-${prop.id}`}
        value={cfg.numberFormat ?? "number"}
        onChange={(e) => db.updateProperty(prop.id, { config: { ...cfg, numberFormat: e.target.value } })}
        className="mb-2 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <option value="number">Number</option>
        <option value="percent">Percent</option>
        <option value="currency">Currency (USD)</option>
        <option value="comma">Comma separated</option>
      </select>
      <label className="mb-1 block text-[10px] font-medium uppercase text-neutral-400">Show as</label>
      <select
        data-testid={`db-number-display-${prop.id}`}
        value={cfg.display ?? "number"}
        onChange={(e) => db.updateProperty(prop.id, { config: { ...cfg, display: e.target.value } })}
        className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <option value="number">Number</option>
        <option value="bar">Bar</option>
      </select>
    </div>
  );
}

/** The per-type configuration UI that appears inside an open column-header menu
 * for relation / formula / rollup properties. */
function PropConfigEditor({ prop }: { prop: DbProperty }) {
  const db = useDb();
  const config = prop.config;

  if (prop.type === "relation") {
    return <RelationConfigEditor prop={prop} />;
  }

  if (prop.type === "formula") {
    return (
      <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-700">
        <label className="mb-1 block text-[10px] font-medium uppercase text-neutral-400">
          Formula
        </label>
        <input
          data-testid={`db-formula-config-${prop.id}`}
          defaultValue={config.formula ?? ""}
          placeholder={'prop("A") + prop("B")'}
          onChange={(e) =>
            db.updateProperty(prop.id, { config: { ...config, formula: e.target.value } })
          }
          onBlur={(e) =>
            db.updateProperty(prop.id, { config: { ...config, formula: e.target.value } })
          }
          className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
        />
      </div>
    );
  }

  // rollup
  return <RollupConfigEditor prop={prop} />;
}

/** Relation target picker. Fetches the workspace's databases FRESH when opened
 * so a database created after this view mounted is still selectable. */
function RelationConfigEditor({ prop }: { prop: DbProperty }) {
  const db = useDb();
  const config = prop.config;
  // optimistic two-way state: the checkbox must flip synchronously; the mirror
  // property is created/removed in the background
  const [twoWayLocal, setTwoWayLocal] = useState<boolean | null>(null);
  const [dbs, setDbs] = useState<{ id: string; title: string }[]>(db.allDatabases);
  useEffect(() => {
    let alive = true;
    fetch("/api/databases")
      .then((r) => (r.ok ? r.json() : { databases: [] }))
      .then((d) => alive && setDbs(d.databases ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-700">
      <label className="mb-1 block text-[10px] font-medium uppercase text-neutral-400">
        Related to
      </label>
      <select
        data-testid="relation-target-select"
        value={config.relationDatabaseId ?? ""}
        onChange={(e) =>
          db.updateProperty(prop.id, {
            config: { ...config, relationDatabaseId: e.target.value },
          })
        }
        className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <option value="">Select a database…</option>
        {dbs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </select>
      {config.relationDatabaseId && !config.mirrorOf && (
        <label className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <input
            type="checkbox"
            data-testid="relation-two-way"
            checked={twoWayLocal ?? !!config.twoWayPropId}
            onChange={(e) => {
              setTwoWayLocal(e.target.checked);
              void (async () => {
                if (e.target.checked) {
                  // create a computed mirror property on the target database
                  const myTitle =
                    db.allDatabases.find((d) => d.id === db.databaseId)?.title ?? "Related";
                  const res = await fetch(
                    `/api/databases/${config.relationDatabaseId}/properties`,
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        name: `↔ ${myTitle}`,
                        type: "relation",
                        config: {
                          relationDatabaseId: db.databaseId,
                          mirrorOf: { databaseId: db.databaseId, propId: prop.id },
                        },
                      }),
                    }
                  );
                  if (!res.ok) {
                    setTwoWayLocal(null);
                    return;
                  }
                  const { property } = (await res.json()) as { property: { id: string } };
                  db.updateProperty(prop.id, {
                    config: { ...config, twoWayPropId: property.id },
                  });
                } else {
                  if (config.twoWayPropId)
                    await fetch(
                      `/api/databases/${config.relationDatabaseId}/properties/${config.twoWayPropId}`,
                      { method: "DELETE" }
                    );
                  db.updateProperty(prop.id, {
                    config: { ...config, twoWayPropId: undefined },
                  });
                }
              })();
            }}
          />
          Show on the related database (two-way)
        </label>
      )}
    </div>
  );
}

function RollupConfigEditor({ prop }: { prop: DbProperty }) {
  const db = useDb();
  const config = prop.config;
  const rollup = config.rollup ?? {};
  const relationProps = db.properties.filter((p) => p.type === "relation");
  const relProp = db.properties.find((p) => p.id === rollup.relationPropertyId);
  const relatedDbId = relProp?.config.relationDatabaseId;

  // the target property list = properties of the RELATED db. When it's the
  // current db (self-relation) db.properties already has them; otherwise fetch.
  const [targetProps, setTargetProps] = useState<DbProperty[]>(db.properties);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!relatedDbId) {
        if (alive) setTargetProps(db.properties);
        return;
      }
      const snap = await fetchDatabaseSnapshot(relatedDbId);
      if (alive) setTargetProps(snap?.properties ?? db.properties);
    })();
    return () => {
      alive = false;
    };
  }, [relatedDbId, db.properties]);

  // read the freshest config at call time (not the captured render closure) so
  // three rapid select changes accumulate instead of clobbering each other.
  const patch = (next: Record<string, unknown>) => {
    const cur = db.properties.find((p) => p.id === prop.id)?.config ?? config;
    const curRollup = cur.rollup ?? {};
    db.updateProperty(prop.id, { config: { ...cur, rollup: { ...curRollup, ...next } } });
  };

  return (
    <div
      data-testid={`db-rollup-config-${prop.id}`}
      className="space-y-1.5 border-t border-neutral-100 px-3 py-2 dark:border-neutral-700"
    >
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase text-neutral-400">
          Relation
        </label>
        <select
          data-testid={`db-rollup-relation-${prop.id}`}
          value={rollup.relationPropertyId ?? ""}
          onChange={(e) => patch({ relationPropertyId: e.target.value })}
          className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <option value="">Select…</option>
          {relationProps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase text-neutral-400">
          Property
        </label>
        <select
          data-testid={`db-rollup-target-${prop.id}`}
          value={rollup.targetPropertyId ?? ""}
          onChange={(e) => patch({ targetPropertyId: e.target.value })}
          className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <option value="">Select…</option>
          {targetProps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase text-neutral-400">
          Calculate
        </label>
        <select
          data-testid={`db-rollup-fn-${prop.id}`}
          value={rollup.function ?? "sum"}
          onChange={(e) => patch({ function: e.target.value })}
          className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <option value="sum">Sum</option>
          <option value="count">Count</option>
          <option value="avg">Average</option>
        </select>
      </div>
    </div>
  );
}

function MenuItem({
  testid,
  icon,
  label,
  onClick,
  danger,
}: {
  testid: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
        danger ? "text-red-500" : "text-neutral-700 dark:text-neutral-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

const AUTOFILLABLE: PropertyType[] = ["text", "select", "status", "number", "email", "phone", "url"];

/** Notion AI database autofill: fill EMPTY cells of a column from each row's
 * other primitive values via the local model; persists through the normal
 * row PATCH path (OKF + Postgres identical). Caps at 10 rows per click. */
async function aiAutofill(db: ReturnType<typeof useDb>, prop: DbProperty) {
  const optionByName = new Map(
    (prop.config.options ?? []).map((o) => [o.name.toLowerCase(), o.id])
  );
  const targets = db.rows
    .filter((r) => !r.values.__template)
    .filter((r) => {
      const v = r.values[prop.id];
      return v === undefined || v === null || v === "";
    })
    .slice(0, 10);
  if (!targets.length) return;

  const rowCtx = targets.map((r) => {
    const context: Record<string, string> = {};
    for (const p of db.properties) {
      if (p.id === prop.id) continue;
      const v = r.values[p.id];
      if (v === undefined || v === null || v === "") continue;
      if (p.config.options?.length) {
        const names = (Array.isArray(v) ? v : [v])
          .map((x) => p.config.options!.find((o) => o.id === x)?.name)
          .filter(Boolean);
        if (names.length) context[p.name] = names.join(", ");
      } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        context[p.name] = String(v);
      }
    }
    return { rowId: r.id, context };
  });

  const res = await fetch("/api/ai/autofill", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      propertyName: prop.name,
      propertyType: prop.type,
      options: (prop.config.options ?? []).map((o) => o.name),
      rows: rowCtx,
    }),
  }).catch(() => null);
  if (!res?.ok) return;
  const { values } = (await res.json()) as { values: Record<string, string> };
  for (const [rowId, raw] of Object.entries(values)) {
    // select-ish values persist as OPTION IDS, everything else as the string
    const v = optionByName.size ? optionByName.get(raw.toLowerCase()) : raw;
    if (v === undefined) continue;
    db.updateRow(rowId, { [prop.id]: prop.type === "number" ? Number(v) || 0 : v });
  }
}
