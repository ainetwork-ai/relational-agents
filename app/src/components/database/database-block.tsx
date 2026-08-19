"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Table2, KanbanSquare, List as ListIcon, LayoutGrid, LayoutDashboard, BarChart3, Plus, Maximize, Link as LinkIcon, ChevronDown, ChevronRight, FileText, Pencil, Paintbrush, SlidersHorizontal, Database as DatabaseGlyph, Copy as CopyIcon, Trash2, CalendarDays } from "lucide-react";
import { useDismiss } from "@/hooks/use-dismiss";
import { useAnchored } from "@/hooks/use-anchored";
import { createPortal } from "react-dom";
import type {
  Database,
  DbProperty,
  DbRow,
  DbView,
  PropertyType,
  PropertyConfig,
  ViewConfig,
  SelectOption,
} from "@/lib/db/schema";
import type { PublicUser } from "@/lib/auth/public-user";
import { newId } from "@/lib/compat";
import { usePageSync } from "@/hooks/use-page-sync";
import { usePagesStore } from "@/stores/pages";
import { useToastStore } from "@/stores/toast";
import { COLOR_CYCLE, filterIsActive, resolveDateValue, type RelatedSnapshots,
} from "@/lib/db-values";
import { fetchDatabaseSnapshot } from "@/lib/db-relation";
import { TableView } from "./table-view";
import { BoardView } from "./board-view";
import { ListView } from "./list-view";
import { GalleryView } from "./gallery-view";
import { CalendarView } from "./calendar-view";
import { TimelineView } from "./timeline-view";
import { DashboardView } from "./dashboard-view";
import { ChartView } from "./chart-view";
import { ViewOptions } from "./view-options";
import { FilterBar, FilterChips } from "./filter-bar";
import { SortBar } from "./sort-bar";
import { RowPeek } from "./row-peek";
import { PropertyEditPanel } from "./property-edit-panel";

// The context lives in its own module (see the note there) and is re-exported
// so the many `from "./database-block"` importers keep working. It is still
// exported so a standalone surface (the full-page row property panel) can
// provide a minimal DbApi and reuse PropertyCell without a DatabaseBlock.
export { DbCtx, useDb } from "./db-context";
export type { DbApi } from "./db-context";
import { DbCtx, useDb, type DbApi } from "./db-context";

/** One row of the view tab's menu, in the original's proportions: a 28px row
 *  inset 4px from the panel edge, 8px inner padding, 6px radius, a 20px icon
 *  slot and a 14px label. `soon` marks what this app cannot do yet — rendered
 *  disabled with the reason as the tooltip, like the 시작하기 row. */
function TabMenuItem({
  testid,
  icon,
  label,
  onClick,
  soon,
  right,
}: {
  testid: string;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  soon?: string;
  right?: React.ReactNode;
}) {
  const disabled = !onClick;
  return (
    <button
      role="menuitem"
      data-testid={testid}
      disabled={disabled}
      title={soon}
      aria-disabled={disabled}
      onClick={onClick}
      className={`mx-1 flex h-7 items-center gap-2 rounded-md px-2 text-left text-sm ${
        disabled
          ? "cursor-not-allowed text-neutral-400 opacity-60 dark:text-neutral-500"
          : "text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
      }`}
    >
      <span
        className={`flex w-5 shrink-0 items-center justify-center ${
          disabled ? "" : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right}
    </button>
  );
}

/**
 * Expand an inline database into a full page.
 *
 * Sits in the toolbar, not behind the "..." menu: Notion puts this on the
 * inline database itself, and a reader looking for it there found nothing —
 * the one action that changes how the whole block is presented was filed under
 * per-view settings.
 */
function DbExpandButton({ databaseId }: { databaseId: string }) {
  const router = useRouter();

  async function openFullPage() {
    const res = await fetch(`/api/databases/${databaseId}/fullpage`, { method: "POST" });
    if (res.ok) router.push(`/p/${(await res.json()).pageId}`);
  }

  return (
    <button
      data-testid="db-open-fullpage"
      onClick={() => void openFullPage()}
      aria-label="Open as full page"
      data-tip="Open as full page"
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      <Maximize size={14} />
    </button>
  );
}

/** "Link a database" picker — stays behind the "..." menu; it is a rarer action
 *  and has no top-level equivalent in Notion's inline toolbar. */
function DbSourceControls() {
  const db = useDb();
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);

  async function linkDb(id: string) {
    setPickerOpen(false);
    const res = await fetch(`/api/databases/${id}/link`, { method: "POST" });
    if (res.ok) router.push(`/p/${(await res.json()).pageId}`);
  }

  return (
    <>
      <div className="relative">
        <button
          data-testid="db-link-picker"
          onClick={() => setPickerOpen((v) => !v)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <LinkIcon size={12} /> Link
        </button>
        {pickerOpen && (
          <div className="popover-anim absolute right-0 top-8 z-40 max-h-56 w-52 overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-400">
              Link a database
            </p>
            {db.allDatabases.map((d) => (
              <button
                key={d.id}
                data-testid={`db-link-db-${d.id}`}
                onClick={() => void linkDb(d.id)}
                className="w-full truncate rounded px-2 py-1 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                {d.title || "Untitled"}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Reusable row templates: a template is a row flagged
 * values.__template (never shown in views/calcs). The New-row menu lets you
 * define templates and create a real row pre-filled from one. */
function TemplateMenu() {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const titleProp = db.properties.find((p) => p.type === "title");
  const templates = db.rows.filter((r) => r.values.__template);
  return (
    <div className="relative">
      <button
        data-testid="db-template-menu-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <Plus size={12} /> Templates
      </button>
      {open && (
        <div
          data-testid="db-template-menu"
          className="popover-anim absolute right-0 top-8 z-40 w-64 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        >
          {templates.length === 0 && (
            <p className="px-2 py-1 text-xs text-neutral-400">No templates yet.</p>
          )}
          {templates.map((t) => (
            <div
              key={t.id}
              data-testid={`db-template-${t.id}`}
              className="mb-1 flex items-center gap-1 rounded px-1 py-0.5"
            >
              {titleProp && (
                <input
                  data-testid={`db-cell-${t.id}-${titleProp.id}`}
                  defaultValue={String(t.values[titleProp.id] ?? "")}
                  placeholder="Template name"
                  onBlur={(e) => db.updateRow(t.id, { [titleProp.id]: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-neutral-200 bg-transparent px-1.5 py-1 text-xs outline-none dark:border-neutral-600 dark:text-neutral-200"
                />
              )}
              <button
                data-testid={`db-template-default-${t.id}`}
                onClick={() => {
                  const making = !t.values.__default;
 // single default: clear the flag on every other template
                  for (const other of db.rows.filter(
                    (r) => r.values.__template && r.values.__default && r.id !== t.id
                  ))
                    db.updateRow(other.id, { __default: null });
                  db.updateRow(t.id, { __default: making ? true : null });
                }}
                title="Use as the default for New rows"
                className={`shrink-0 rounded px-1.5 py-1 text-xs ${
                  t.values.__default
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
                    : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                }`}
              >
                Default
              </button>
              <button
                data-testid={`db-add-row-template-${t.id}`}
                onClick={() => {
                  const vals: Record<string, unknown> = { ...t.values };
                  delete vals.__template;
                  void db.addRow(vals);
                  setOpen(false);
                }}
                className="shrink-0 rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white hover:bg-blue-600"
              >
                Use
              </button>
            </div>
          ))}
          <button
            data-testid="db-template-new"
            onClick={() => void db.addRow({ __template: true })}
            className="mt-1 flex w-full items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <Plus size={12} /> New template
          </button>
        </div>
      )}
    </div>
  );
}

export const PROP_TYPES: { type: PropertyType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "select", label: "Select" },
  { type: "multi_select", label: "Multi-select" },
  { type: "status", label: "Status" },
  { type: "date", label: "Date" },
  { type: "person", label: "Person" },
  { type: "checkbox", label: "Checkbox" },
  { type: "url", label: "URL" },
  { type: "relation", label: "Relation" },
  { type: "formula", label: "Formula" },
  { type: "rollup", label: "Rollup" },
  { type: "email", label: "Email" },
  { type: "phone", label: "Phone" },
  { type: "files", label: "Files & media" },
  { type: "created_time", label: "Created time" },
  { type: "last_edited_time", label: "Last edited time" },
  { type: "created_by", label: "Created by" },
  { type: "last_edited_by", label: "Last edited by" },
];

export function DatabaseBlock({
  databaseId,
  fullPage,
  linkedViewId,
  initialViewType,
}: {
  databaseId: string;
  /** page whose whole body IS this database (Open as full page) */
  fullPage?: boolean;
  /** id of the embedded view this linked block should show */
  linkedViewId?: string;
  /** slash-insert preset (e.g. "dashboard"): ensure a view of this type
 * exists on first load and open on it */
  initialViewType?: string;
}) {
  const [database, setDatabase] = useState<Database | null>(null);
  const [properties, setProperties] = useState<DbProperty[]>([]);
  const [rows, setRows] = useState<DbRow[]>([]);
  const [views, setViews] = useState<DbView[]>([]);
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [allDatabases, setAllDatabases] = useState<{ id: string; title: string }[]>([]);
  const [related, setRelated] = useState<RelatedSnapshots>({});
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [addPropOpen, setAddPropOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuBtn = useRef<HTMLButtonElement>(null);
  const viewMenuPop = useRef<HTMLDivElement>(null);
  const [tabMenuViewId, setTabMenuViewId] = useState<string | null>(null);
 // the tab the menu hangs under — set by whichever gesture opened it (clicking
 // the active tab, or right-clicking any tab, as the original allows)
  const tabMenuAnchor = useRef<HTMLElement | null>(null);
  const tabMenuPop = useRef<HTMLDivElement>(null);
  useAnchored(tabMenuViewId !== null, tabMenuAnchor, tabMenuPop, { align: "start" });
  useDismiss(tabMenuViewId !== null, () => setTabMenuViewId(null), tabMenuAnchor, tabMenuPop);
  useEffect(() => {
    if (!viewMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewMenuOpen]);
 // portalled and placed: measured at 1280x480 with the toolbar low in the
 // window, the page's scroller cut the Add-view list by 209px
  useAnchored(viewMenuOpen, viewMenuBtn, viewMenuPop, { align: "end" });
  useDismiss(viewMenuOpen, () => setViewMenuOpen(false), viewMenuBtn, viewMenuPop);
  const [addViewOpen, setAddViewOpen] = useState(false);
  const addViewBtn = useRef<HTMLButtonElement>(null);
  const addViewPop = useRef<HTMLDivElement>(null);
 // the blue 새로 만들기 button's caret: the original opens a template menu there
  const [newMoreOpen, setNewMoreOpen] = useState(false);
  const newMoreBtn = useRef<HTMLButtonElement>(null);
  const newMorePop = useRef<HTMLDivElement>(null);
  useAnchored(newMoreOpen, newMoreBtn, newMorePop, { align: "end" });
  useDismiss(newMoreOpen, () => setNewMoreOpen(false), newMoreBtn, newMorePop);
  useAnchored(addViewOpen, addViewBtn, addViewPop, { align: "start" });
  useDismiss(addViewOpen, () => setAddViewOpen(false), addViewBtn, addViewPop);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
 // the peek opened because the row was just created, so the title takes the
 // caret — opening an existing row to read it must not
  const [openedNewRow, setOpenedNewRow] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [filterUiOpen, setFilterUiOpen] = useState(false);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [viewNameDraft, setViewNameDraft] = useState("");
 // View-tab overflow: tabs that don't fit collapse behind an
 // "N more" dropdown. Widths come from an invisible measurement row.
  const tabsAreaRef = useRef<HTMLDivElement | null>(null);
  // the view-tabs/toolbar row — the 속성 편집 sidebar docks against its
  // bottom-right corner, as the original docks under its sticky toolbar
  const viewBarRef = useRef<HTMLDivElement | null>(null);
  const tabsMeasureRef = useRef<HTMLDivElement | null>(null);
  const [visibleTabCount, setVisibleTabCount] = useState(Number.MAX_SAFE_INTEGER);
  const [moreTabsOpen, setMoreTabsOpen] = useState(false);

 // Latest-committed mirrors so rapid successive edits (e.g. creating two
 // options back-to-back) don't read a stale closure and clobber each other.
 // Handlers also sync these synchronously; this effect catches external
 // updates (SSE / initial load) after commit.
  const rowsRef = useRef(rows);
  const propsRef = useRef(properties);
 // stable per-mount client id for SSE echo suppression (view sync)
  const [clientId] = useState(() => newId());
 // "Save for everyone": filter/sort edits stage HERE (this window only)
 // until saved to the server or reset
  const [draftConfigs, setDraftConfigs] = useState<Record<string, ViewConfig>>({});
 // mirrors for callbacks declared before activeView/me are derived (synced in
 // an effect after the activeView memo below)
  const activeViewRef = useRef<DbView | undefined>(undefined);
  const meRef = useRef<string | null>(null);
  useEffect(() => {
    rowsRef.current = rows;
    propsRef.current = properties;
  }, [rows, properties]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [snap, mem, meRes, dbs] = await Promise.all([
        fetch(`/api/databases/${databaseId}`).then((r) => (r.ok ? r.json() : null)),
 // the DATABASE's workspace roster — the switcher's active workspace may be
 // a different one, and person ids must still resolve to names
        fetch(`/api/databases/${databaseId}/members`).then((r) => (r.ok ? r.json() : { members: [] })),
        fetch(`/api/auth/me`).then((r) => (r.ok ? r.json() : { user: null })),
        fetch(`/api/databases`).then((r) => (r.ok ? r.json() : { databases: [] })),
      ]);
      if (!alive || !snap) return;
      setDatabase(snap.database);
      setProperties(snap.properties);
      setRows(snap.rows);
      setViews(snap.views);
 // a linked block opens on its embedded view; an inline block opens on its
 // first NON-embedded view (never a linked view).
      const initialView = linkedViewId
        ? snap.views.find((v: DbView) => v.id === linkedViewId)
        : initialViewType
          ? snap.views.find((v: DbView) => v.type === initialViewType)
          : snap.views.find((v: DbView) => !v.config.embedded);
      setActiveViewId((initialView ?? snap.views[0])?.id ?? null);
 // slash presets like "Dashboard view" want that view to exist up front
      if (initialViewType && !snap.views.some((v: DbView) => v.type === initialViewType)) {
        const res = await fetch(`/api/databases/${databaseId}/views`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: initialViewType }),
        });
        if (res.ok && alive) {
          const { view } = await res.json();
          setViews((prev) => [...prev, view]);
          setActiveViewId(view.id);
        }
      }
      setMembers(mem.members ?? []);
      setMe(meRes.user?.id ?? null);
      setAllDatabases(dbs.databases ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [databaseId, linkedViewId]);

 // Re-pull the snapshot after destructive ops: a file-backed (OKF) database
 // has positional row/column ids (`row3`, `col2`) that SHIFT when one is
 // spliced from the CSV — optimistic local state would misalign after that.
  const refreshSnapshot = useCallback(async () => {
    const snap = await fetch(`/api/databases/${databaseId}`).then((r) =>
      r.ok ? r.json() : null
    );
    if (!snap) return;
    setDatabase(snap.database);
    setProperties(snap.properties);
    setRows(snap.rows);
    setViews(snap.views);
  }, [databaseId]);

  const updateRow = useCallback(
    (rowId: string, values: Record<string, unknown>) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, values: { ...r.values, ...values } } : r
        )
      );
      void fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
    },
    [databaseId]
  );

 // a row created inside a filtered view pre-fills the filters' values
 // so it doesn't instantly vanish from the view that created it.
  const seedFromFilters = useCallback((): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const NON_SEEDABLE = [
      "created_time",
      "last_edited_time",
      "created_by",
      "last_edited_by",
      "formula",
      "rollup",
      "relation",
    ];
    for (const f of activeViewRef.current?.config.filters ?? []) {
      if (!filterIsActive(f)) continue;
      const prop = propsRef.current.find((p) => p.id === f.propertyId);
      if (!prop || NON_SEEDABLE.includes(prop.type)) continue;
      const first = Array.isArray(f.value) ? f.value[0] : f.value;
      if (f.op === "checked" && prop.type === "checkbox") out[prop.id] = true;
      else if (f.op === "is_me" && prop.type === "person" && meRef.current)
        out[prop.id] = [meRef.current];
      else if (f.op === "equals" && first !== undefined) {
        if (prop.type === "multi_select") out[prop.id] = [first];
        else if (prop.type === "date") out[prop.id] = resolveDateValue(first);
        else out[prop.id] = first;
      } else if (f.op === "contains" && prop.type === "multi_select" && first !== undefined) {
        out[prop.id] = [first];
      }
    }
    return out;
  }, []);

 /** A row's body is a real page, created the first time the row is opened —
  *  a table of 500 rows should not mint 500 pages up front. */
  const ensureRowPage = useCallback(
    async (row: DbRow) => {
      if (typeof row.values["__page"] === "string") return;
      const titleProp = propsRef.current.find((p) => p.type === "title");
      const title = (titleProp && (row.values[titleProp.id] as string)) || "Untitled";
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
 // rowForDatabaseId → the server parents the page under the database's
 // host page, which is what the full-page breadcrumb walks
        body: JSON.stringify({ title, rowForDatabaseId: databaseId }),
      });
      if (res.ok) updateRow(row.id, { __page: (await res.json()).page.id as string });
    },
    [updateRow, databaseId]
  );

 // a full-page database's icon is the page's own icon
  const pathname = usePathname();
  const hostPageId = pathname?.match(/\/p\/([0-9a-f-]{36})/)?.[1] ?? null;
  const hostPageIcon = usePagesStore((st) => (hostPageId ? (st.pages[hostPageId]?.icon ?? null) : null));

  const hostIconRef = useRef<string | null>(null);
  useEffect(() => {
    hostIconRef.current = fullPage ? hostPageIcon : null;
  }, [fullPage, hostPageIcon]);

  const addRow = useCallback(
    async (values: Record<string, unknown> = {}, parentRowId?: string) => {
 // "default template": a template row flagged __default pre-fills
 // every plain New row (explicit values and filter seeds still win)
      const def = rowsRef.current.find((r) => r.values.__template && r.values.__default);
      const templateSeed: Record<string, unknown> = {};
      if (def) {
        for (const [k, v] of Object.entries(def.values)) {
          if (k === "__template" || k === "__default" || k === "__page") continue;
          templateSeed[k] = v;
        }
      }
 // A new row takes the database's icon, once, at creation — that is how the
 // original's rows come to carry `/icons/iterate_blue.svg` (99 of 100 do; one
 // was changed afterwards). It is a copy, not a live link, which is why a page
 // made *inside* a row doesn't get one. See docs/notion-icon-policy.md.
      const iconSeed: Record<string, unknown> =
        hostIconRef.current && !values.__template ? { __icon: hostIconRef.current } : {};
 // a status property's 기본 option (속성 편집's "기본으로 설정") pre-fills new
 // rows — the original's new pages never start with an empty Status
      const statusSeed: Record<string, unknown> = {};
      for (const p of propsRef.current) {
        if (p.type === "status" && p.config.defaultOptionId) statusSeed[p.id] = p.config.defaultOptionId;
      }
      const seeded = { ...statusSeed, ...templateSeed, ...iconSeed, ...seedFromFilters(), ...values };
      const res = await fetch(`/api/databases/${databaseId}/rows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: seeded, parentRowId }),
      });
      if (!res.ok) return null;
      const { row } = await res.json();
      setRows((prev) => [...prev, row]);
 // Notion opens what you just made: 새로 만들기 (and a group's 새 프로젝트 row)
 // lands in the side peek, ready to be named. A sub-item or a template
 // definition is not an entry you were about to write, so it stays put.
      if (!parentRowId && !seeded.__template) {
        await ensureRowPage(row as DbRow);
        setOpenedNewRow(true);
        setOpenRowId(row.id as string);
      }
      return row as DbRow;
    },
    [databaseId, seedFromFilters, ensureRowPage]
  );

  const deleteRow = useCallback(
    (rowId: string) => {
      const gone = rowsRef.current.find((r) => r.id === rowId);
      setRows((prev) => prev.filter((r) => r.id !== rowId));
 // OKF row ids are positional and shift on splice → refetch. Postgres ids
 // are stable — skip the refetch (its late response would clobber rows
 // added in the meantime, e.g. delete → board "+ New" race).
      const isUuidDb = /^[0-9a-f-]{36}$/i.test(databaseId);
      void fetch(`/api/databases/${databaseId}/rows/${rowId}`, { method: "DELETE" }).then(() => {
        if (!isUuidDb) return refreshSnapshot();
      });
      if (gone)
        useToastStore.getState().show("Row deleted", {
          onUndo: async () => {
 // re-create with the same values (a fresh id — references aside,
 // the CONTENT comes back, which is what undo is for)
            await fetch(`/api/databases/${databaseId}/rows`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ values: gone.values, parentRowId: gone.parentRowId ?? null }),
            });
            await refreshSnapshot();
          },
        });
    },
    [databaseId, refreshSnapshot]
  );

 // Manual reorder. OKF row ids are positional and shift on move — always
 // refetch the snapshot after the PATCH lands.
  const moveRow = useCallback(
    (rowId: string, position: number) => {
      setRows((prev) =>
        [...prev]
          .map((r) => (r.id === rowId ? { ...r, position } : r))
          .sort((a, b) => a.position - b.position)
      );
      void fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position }),
      }).then(() => refreshSnapshot());
    },
    [databaseId, refreshSnapshot]
  );

  const openRow = useCallback(
    async (rowId: string) => {
      const row = rowsRef.current.find((r) => r.id === rowId);
      if (!row) return;
      await ensureRowPage(row);
      setOpenedNewRow(false);
      setOpenRowId(rowId);
    },
    [ensureRowPage]
  );

  const addView = useCallback(
    async (type: DbView["type"]) => {
      const res = await fetch(`/api/databases/${databaseId}/views`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
 // board default grouping: a status property, else a select NAMED like
 // one (an imported CSV's "Status" column infers as select, not
 // status), else any select
          config:
            type === "board"
              ? {
                  groupByPropertyId: (
                    propsRef.current.find((p) => p.type === "status") ??
                    propsRef.current.find(
                      (p) => p.type === "select" && /status|state/i.test(p.name)
                    ) ??
                    propsRef.current.find((p) => p.type === "select")
                  )?.id,
                }
              : {},
        }),
      });
      if (!res.ok) return;
      const { view } = await res.json();
      setViews((prev) => [...prev, view]);
      setActiveViewId(view.id);
    },
    [databaseId]
  );

 // Rename a view — persists via PATCH name.
  const renameView = useCallback(
    (viewId: string, name: string) => {
      const clean = name.trim();
      if (!clean) return;
      setViews((prev) => prev.map((v) => (v.id === viewId ? { ...v, name: clean } : v)));
      void fetch(`/api/databases/${databaseId}/views/${viewId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: clean }),
      });
    },
    [databaseId]
  );

 // Duplicate a view: same type + config, "<name> (copy)".
  const duplicateView = useCallback(
    async (viewId: string) => {
      const src = views.find((v) => v.id === viewId);
      if (!src) return;
      const res = await fetch(`/api/databases/${databaseId}/views`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: src.type, name: `${src.name} (copy)`, config: src.config }),
      });
      if (!res.ok) return;
      const { view } = await res.json();
      setViews((prev) => [...prev, view]);
      setActiveViewId(view.id);
    },
    [databaseId, views]
  );

 // Delete a view. The last remaining tab keeps
 // its ✕ hidden, so a database always has at least one view.
  const deleteView = useCallback(
    async (viewId: string) => {
      const gone = views.find((v) => v.id === viewId);
      setViews((prev) => prev.filter((v) => v.id !== viewId));
      setActiveViewId((cur) => (cur === viewId ? null : cur));
      await fetch(`/api/databases/${databaseId}/views/${viewId}`, { method: "DELETE" });
      void refreshSnapshot();
      if (gone)
        useToastStore.getState().show(`View "${gone.name}" deleted`, {
          onUndo: async () => {
            const res = await fetch(`/api/databases/${databaseId}/views`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: gone.name, type: gone.type }),
            });
            if (res.ok) {
              const { view } = (await res.json()) as { view: { id: string } };
              await fetch(`/api/databases/${databaseId}/views/${view.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ config: gone.config }),
              });
            }
            await refreshSnapshot();
          },
        });
    },
    [databaseId, views, refreshSnapshot]
  );

  const addProperty = useCallback(
    async (name: string, type: PropertyType) => {
      const config = type === "select" || type === "status" ? { options: [] } : {};
      const res = await fetch(`/api/databases/${databaseId}/properties`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, type, config }),
      });
      if (!res.ok) return null;
      const { property } = await res.json();
      setProperties((prev) => [...prev, property]);
 // returned so a caller can go straight on to editing what it just made —
 // the row page's Add a property turns into that property's editor
      return property as DbProperty;
    },
    [databaseId]
  );

  const addSelectOption = useCallback(
    async (prop: DbProperty, name: string): Promise<SelectOption> => {
 // read the freshest options from the ref, not the passed closure, so
 // two creates in quick succession accumulate instead of clobbering.
      const base = propsRef.current.find((p) => p.id === prop.id) ?? prop;
      const opt: SelectOption = {
        id: newId(),
        name,
        color: COLOR_CYCLE[(base.config.options?.length ?? 0) % COLOR_CYCLE.length],
      };
      const options = [...(base.config.options ?? []), opt];
      const nextProps = propsRef.current.map((p) =>
        p.id === prop.id ? { ...p, config: { ...p.config, options } } : p
      );
      propsRef.current = nextProps; // sync so a rapid next call sees it
      setProperties(nextProps);
      await fetch(`/api/databases/${databaseId}/properties/${prop.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { ...base.config, options } }),
      });
      return opt;
    },
    [databaseId]
  );

  const toggleMulti = useCallback(
    (rowId: string, propId: string, optId: string) => {
      let finalArr: string[] = [];
      const nextRows = rowsRef.current.map((r) => {
        if (r.id !== rowId) return r;
        const arr = Array.isArray(r.values[propId]) ? (r.values[propId] as string[]) : [];
        finalArr = arr.includes(optId) ? arr.filter((x) => x !== optId) : [...arr, optId];
        return { ...r, values: { ...r.values, [propId]: finalArr } };
      });
      rowsRef.current = nextRows; // sync for rapid successive toggles/creates
      setRows(nextRows);
      void fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { [propId]: finalArr } }),
      });
    },
    [databaseId]
  );

  const updateProperty = useCallback(
    (
      id: string,
      patch: { name?: string; type?: PropertyType; config?: PropertyConfig; position?: number }
    ) => {
      const nextProps = propsRef.current
        .map((p) =>
          p.id === id
            ? {
                ...p,
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.type !== undefined ? { type: patch.type } : {}),
                ...(patch.config !== undefined ? { config: patch.config } : {}),
                ...(patch.position !== undefined ? { position: patch.position } : {}),
              }
            : p
        )
        .sort((a, b) => a.position - b.position);
      propsRef.current = nextProps; // sync so a rapid next config edit sees it
      setProperties(nextProps);
      void fetch(`/api/databases/${databaseId}/properties/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    [databaseId]
  );

  const deleteProperty = useCallback(
    (id: string) => {
      setProperties((prev) => prev.filter((p) => p.id !== id));
      void fetch(`/api/databases/${databaseId}/properties/${id}`, { method: "DELETE" }).then(() =>
        refreshSnapshot()
      );
    },
    [databaseId, refreshSnapshot]
  );

 // A linked block shows ONLY its embedded view; an inline block hides embedded
 // (linked) views from its own tab bar.
  const tabViews = useMemo(
    () =>
      linkedViewId
        ? views.filter((v) => v.id === linkedViewId)
        : views.filter((v) => !v.config.embedded),
    [views, linkedViewId]
  );
  const activeView = useMemo(() => {
    const v = views.find((x) => x.id === activeViewId) ?? tabViews[0] ?? views[0];
    if (!v) return v;
    const draft = draftConfigs[v.id];
    return draft ? { ...v, config: draft } : v;
  }, [views, activeViewId, tabViews, draftConfigs]);

 // How many view tabs fit on one line. The hidden measurement row always
 // renders every tab; the visible row shows the first `visibleTabCount` and
 // an "N more" chip for the rest.
  useLayoutEffect(() => {
    const area = tabsAreaRef.current;
    const meas = tabsMeasureRef.current;
    if (!area || !meas) return;
    const GAP = 4; // gap-1
    const MORE_W = 84; // reserved for the "N more ⌄" chip
    const ADD_W = 32; // trailing "+ add view" button
    const compute = () => {
      const kids = [...meas.children] as HTMLElement[];
      const widths = kids.map((k) => k.offsetWidth + GAP);
      const avail = area.clientWidth - ADD_W;
      const total = widths.reduce((a, b) => a + b, 0);
      if (total <= avail) {
        setVisibleTabCount(widths.length);
        return;
      }
      let used = 0;
      let count = 0;
      for (const w of widths) {
        if (used + w + MORE_W > avail) break;
        used += w;
        count++;
      }
      setVisibleTabCount(count);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(area);
    return () => ro.disconnect();
  }, [tabViews, database?.title]);
  useEffect(() => {
    activeViewRef.current = activeView;
    meRef.current = me;
  }, [activeView, me]);

 // Typing a filter value patches per keystroke — coalesce the NETWORK writes
 // (leading + trailing debounce; the optimistic local update stays instant).
  const patchNet = useRef<{ timer: ReturnType<typeof setTimeout> | null; lastSent: number }>({
    timer: null,
    lastSent: 0,
  });
  const patchViewConfig = useCallback(
    (config: ViewConfig, opts?: { draft?: boolean }) => {
      const vid = activeView?.id;
      if (!vid) return;
 // filter/sort edits stage locally; once a draft exists, EVERY further
 // change joins it (mixed edits must not half-persist)
      if (opts?.draft || draftConfigs[vid]) {
        setDraftConfigs((prev) => ({ ...prev, [vid]: config }));
        return;
      }
      setViews((prev) => prev.map((v) => (v.id === vid ? { ...v, config } : v)));
      const send = () => {
        patchNet.current.lastSent = Date.now();
        void fetch(`/api/databases/${databaseId}/views/${vid}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-client-id": clientId },
          body: JSON.stringify({ config }),
        });
      };
      if (patchNet.current.timer) clearTimeout(patchNet.current.timer);
      if (Date.now() - patchNet.current.lastSent > 500) send();
      else patchNet.current.timer = setTimeout(send, 350);
    },
    [databaseId, activeView?.id, draftConfigs, clientId]
  );

  const saveDraft = useCallback(async () => {
    const vid = activeView?.id;
    if (!vid) return;
    const draft = draftConfigs[vid];
    if (!draft) return;
    setViews((prev) => prev.map((v) => (v.id === vid ? { ...v, config: draft } : v)));
    setDraftConfigs((prev) => {
      const next = { ...prev };
      delete next[vid];
      return next;
    });
    await fetch(`/api/databases/${databaseId}/views/${vid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-client-id": clientId },
      body: JSON.stringify({ config: draft }),
    });
  }, [databaseId, activeView?.id, draftConfigs, clientId]);

  const resetDraft = useCallback(() => {
    const vid = activeView?.id;
    if (!vid) return;
    setDraftConfigs((prev) => {
      const next = { ...prev };
      delete next[vid];
      return next;
    });
  }, [activeView?.id]);

 // live view-settings sync (scienario 3): other windows' filter/sort/view
 // changes arrive over the db-id SSE channel; our own echo is suppressed
  usePageSync(databaseId, clientId, () => {
    void refreshSnapshot();
  });

 // prefetch every relation-target snapshot so filters/sorts on relation &
 // rollup properties can resolve synchronously in applyView
  useEffect(() => {
    const ids = new Set<string>();
    for (const p of properties) {
      if (p.config.relationDatabaseId) ids.add(p.config.relationDatabaseId);
      if (p.config.mirrorOf?.databaseId) ids.add(p.config.mirrorOf.databaseId);
    }
    if (!ids.size) return;
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        [...ids].map(async (id) => [id, await fetchDatabaseSnapshot(id)] as const)
      );
      if (!alive) return;
      const next: RelatedSnapshots = {};
      for (const [id, snap] of entries) {
        if (snap) next[id] = { properties: snap.properties, rows: snap.rows };
      }
      setRelated(next);
    })();
    return () => {
      alive = false;
    };
  }, [properties]);

  const api = useMemo<DbApi>(
    () => ({
      databaseId,
      properties,
      related,
      rows,
      members,
      me,
      itemName: database?.itemName || "페이지",
      fullPage: !!fullPage,
      icon: fullPage ? hostPageIcon : null,
      allDatabases,
      activeView: activeView!,
      updateRow,
      addRow,
      deleteRow,
      moveRow,
      addProperty,
      addSelectOption,
      toggleMulti,
      updateProperty,
      deleteProperty,
      patchView: patchViewConfig,
      openRow,
      editProperty: setEditingPropertyId,
      editingPropertyId,
      filterUiOpen,
      setFilterUiOpen,
    }),
    [databaseId, properties, related, rows, members, me, allDatabases, activeView, updateRow, addRow, deleteRow, moveRow, addProperty, addSelectOption, toggleMulti, updateProperty, deleteProperty, patchViewConfig, openRow, editingPropertyId, filterUiOpen, database?.itemName, fullPage, hostPageIcon]
  );

  if (!database || !activeView) {
    return (
      <div className="my-2 h-24 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800" />
    );
  }

 // No width cap on a full-page database: the original gives it the whole
 // content area, and a cap centred the block, so where the table rested — and
 // where its horizontal scroll began — moved with the window.
 //
 // -ml-9 takes back the 44px the page adds for text: measured from the
 // original's padding edge, its title sits at +44 and its collection at +8.
  const wrapperTestId = fullPage
    ? "db-fullpage"
    : linkedViewId
      ? `db-linked-${databaseId}`
      : undefined;

  return (
    <DbCtx.Provider value={api}>
      <div
        data-testid={`database-${databaseId}`}
        {...(wrapperTestId ? { "data-variant": fullPage ? "fullpage" : "linked" } : {})}
        className={`my-2 w-full ${fullPage ? "-ml-9" : ""}`}
      >
        {/* A marker for tests to tell the two embeddings apart. It used to also
            print "FULL-PAGE DATABASE" / "LINKED VIEW" on screen — scaffolding
            that reached users and that Notion has no equivalent of. */}
        {wrapperTestId && <div data-testid={wrapperTestId} hidden />}
        <div ref={viewBarRef} data-testid="db-view-bar" className="mb-1.5 flex items-center gap-1 border-b border-neutral-200 pb-1.5 dark:border-neutral-800">
          {/* Inline databases carry their name here, as Notion's do. A full-page
              one must not: the page title above IS the database name, and
              printing it twice reads as a bug. */}
          {!fullPage && (
            <span className="mr-2 whitespace-nowrap text-sm font-semibold text-neutral-800 dark:text-neutral-100">
              {database.title}
            </span>
          )}
          {/* tabs that don't fit collapse behind the "N more" dropdown */}
          <div ref={tabsAreaRef} className="relative flex min-w-0 flex-1 items-center gap-1">
          <div
            ref={tabsMeasureRef}
            aria-hidden
 // h-0 w-0 overflow-hidden, not just `invisible`: a hidden element still takes
 // part in layout, so this row (every tab at full width) pushed the PAGE's
 // scroll width out and gave <main> a second horizontal scrollbar. Zero-sized
 // and clipped, it contributes nothing while its children keep measuring their
 // natural width (they are shrink-0).
            className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-0 items-center gap-1 overflow-hidden"
          >
            {tabViews.map((v) => (
              <span
                key={v.id}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2 py-1 text-xs"
              >
                <Table2 size={20} />
                {v.name}
                <span className="ml-0.5 px-0.5">⋯</span>
              </span>
            ))}
          </div>
          {tabViews.slice(0, visibleTabCount).map((v) =>
            renamingViewId === v.id ? (
              <input
                key={v.id}
                data-testid={`db-view-rename-input-${v.id}`}
                autoFocus
                value={viewNameDraft}
                onChange={(e) => setViewNameDraft(e.target.value)}
                onBlur={() => {
                  setRenamingViewId(null);
                  renameView(v.id, viewNameDraft);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenamingViewId(null);
                }}
                className="w-24 rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
              />
            ) : (
            <button
              key={v.id}
              data-testid={`db-view-tab-${v.id}`}
              data-view-type={v.type}
              onClick={(e) => {
                if (v.id === activeView.id) {
                  tabMenuAnchor.current = e.currentTarget;
                  setTabMenuViewId((cur) => (cur === v.id ? null : v.id));
                } else setActiveViewId(v.id);
              }}
 // right-click opens the same menu on ANY tab, as the original does
              onContextMenu={(e) => {
                e.preventDefault();
                tabMenuAnchor.current = e.currentTarget;
                setTabMenuViewId((cur) => (cur === v.id ? null : v.id));
              }}
              onDoubleClick={() => {
                setViewNameDraft(v.name);
                setRenamingViewId(v.id);
              }}
              // measured on the original (e2e/fixtures/notion-view-tabs.json):
              // a 32-tall pill, 12px inner padding, 20px icon, 6px gap, label
              // 14px/500. The active one carries rgba(33,27,23,.05); the others
              // carry nothing and are grey. We had 12px text on an underline.
              className={`relative flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[20px] px-3 text-[14px] font-medium leading-5 transition-colors ${
                v.id === activeView.id
                  ? "bg-[rgba(33,27,23,0.05)] text-[rgb(44,44,43)] dark:bg-neutral-700/50 dark:text-neutral-100"
                  : "text-[rgb(125,122,117)] hover:bg-[rgba(33,27,23,0.03)] dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {v.type === "board" ? (
                <KanbanSquare size={20} />
              ) : v.type === "list" ? (
                <ListIcon size={20} />
              ) : v.type === "gallery" ? (
                <LayoutGrid size={20} />
              ) : v.type === "dashboard" ? (
                <LayoutDashboard size={20} />
              ) : v.type === "chart" ? (
                <BarChart3 size={20} />
              ) : (
                <Table2 size={20} />
              )}
              {v.name}
              {/* no ⋯ in the tab: the original's active tab measures 168px of
                  icon + label and nothing else. Clicking the tab you are already
                  on is what opens its menu. */}
              {v.id === activeView.id && (
                <span
                  role="button"
                  aria-label="View actions"
                  data-testid={`db-view-tabmenu-${v.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    tabMenuAnchor.current = (e.currentTarget as HTMLElement).closest("button");
                    setTabMenuViewId((cur) => (cur === v.id ? null : v.id));
                  }}
                  className="hidden"
                />
              )}
              {/* The tab's menu, as the original builds it (user-supplied DOM
                  capture): a 220px dialog under the tab, items in sections
                  split by hairlines — 이름 바꾸기 / 다음과 같이 표시 / 보기 편집 /
                  데이터베이스 ‖ 보기 링크 복사 ‖ 보기 복제 / 보기 삭제 ‖ 캘린더에서
                  관리하기. What this app cannot do yet stays visible but
                  disabled, with the reason as the tooltip (the 시작하기 row's
                  rule): dropping rows would misrepresent both this app and
                  the design being copied. */}
              {tabMenuViewId === v.id &&
                createPortal(
                <div
                  ref={tabMenuPop}
                  style={{ visibility: "hidden" }}
                  data-testid={`db-view-tabmenu-pop-${v.id}`}
                  role="menu"
                  className="popover-anim fixed z-50 flex w-[220px] cursor-default flex-col rounded-[10px] border border-neutral-200 bg-white text-left font-normal shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <div className="flex flex-col py-1">
                    <TabMenuItem
                      testid={`db-view-rename-${v.id}`}
                      icon={<Pencil size={18} />}
                      label="이름 바꾸기"
                      onClick={() => {
                        setTabMenuViewId(null);
                        setViewNameDraft(v.name);
                        setRenamingViewId(v.id);
                      }}
                    />
                    <TabMenuItem
                      testid={`db-view-showas-${v.id}`}
                      icon={<Paintbrush size={18} />}
                      label="다음과 같이 표시"
                      soon="보기 타입 변경은 아직 없습니다 — +로 새 보기를 추가하세요"
                      right={<ChevronRight size={14} className="shrink-0 text-neutral-400" />}
                    />
                    <TabMenuItem
                      testid={`db-view-edit-${v.id}`}
                      icon={<SlidersHorizontal size={18} />}
                      label="보기 편집"
                      soon="여기서는 아직 못 엽니다 — 툴바의 보기 설정을 쓰세요"
                    />
                    <TabMenuItem
                      testid={`db-view-source-${v.id}`}
                      icon={<DatabaseGlyph size={18} />}
                      label="데이터베이스"
                      soon="원본 데이터베이스로 이동은 아직 없습니다"
                      right={
                        <span className="flex min-w-0 shrink items-center gap-1 text-xs text-neutral-400">
                          <span className="truncate">{database.title || "제목 없음"}</span>
                          <ChevronRight size={14} className="shrink-0" />
                        </span>
                      }
                    />
                  </div>
                  <div className="flex flex-col border-t border-neutral-100 py-1 dark:border-neutral-700/60">
                    <TabMenuItem
                      testid={`db-view-copylink-${v.id}`}
                      icon={<LinkIcon size={18} />}
                      label="보기 링크 복사"
                      soon="보기 링크는 아직 없습니다"
                    />
                  </div>
                  <div className="flex flex-col border-t border-neutral-100 py-1 dark:border-neutral-700/60">
                    <TabMenuItem
                      testid={`db-view-duplicate-${v.id}`}
                      icon={<CopyIcon size={18} />}
                      label="보기 복제"
                      onClick={() => {
                        setTabMenuViewId(null);
                        void duplicateView(v.id);
                      }}
                    />
                    <TabMenuItem
                      testid={`db-view-delete-${v.id}`}
                      icon={<Trash2 size={18} />}
                      label="보기 삭제"
                      soon={tabViews.length <= 1 ? "마지막 보기는 삭제할 수 없습니다" : undefined}
                      onClick={
                        tabViews.length > 1
                          ? () => {
                              setTabMenuViewId(null);
                              void deleteView(v.id);
                            }
                          : undefined
                      }
                    />
                  </div>
                  <div className="flex flex-col border-t border-neutral-100 py-1 dark:border-neutral-700/60">
                    <TabMenuItem
                      testid={`db-view-calendar-${v.id}`}
                      icon={<CalendarDays size={18} />}
                      label="캘린더에서 관리하기"
                      soon="캘린더 연동은 아직 없습니다"
                    />
                  </div>
                </div>,
                document.body
              )}
            </button>
            )
          )}
          {tabViews.length > visibleTabCount && (
            <div className="relative shrink-0">
              <button
                data-testid="db-view-more"
                onClick={() => setMoreTabsOpen((v) => !v)}
                // 85×32 pill, 14px/400 grey, text only — the original's
                // overflow button has no caret
                className="flex h-8 items-center whitespace-nowrap rounded-[20px] px-2.5 text-[14px] leading-5 text-[rgb(125,122,117)] transition-colors hover:bg-[rgba(33,27,23,0.03)] dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                {tabViews.length - visibleTabCount}개 더 보기
              </button>
              {moreTabsOpen && (
                <div className="popover-anim absolute left-0 top-8 z-40 flex w-44 flex-col rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
                  {tabViews.slice(visibleTabCount).map((v) => (
                    <button
                      key={v.id}
                      data-testid={`db-view-more-${v.id}`}
                      data-view-type={v.type}
                      onClick={() => {
                        setMoreTabsOpen(false);
                        setActiveViewId(v.id);
                      }}
                      className={`flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                        v.id === activeView.id
                          ? "font-medium text-neutral-800 dark:text-neutral-100"
                          : "text-neutral-600 dark:text-neutral-300"
                      }`}
                    >
                      {v.type === "board" ? (
                        <KanbanSquare size={13} />
                      ) : v.type === "list" ? (
                        <ListIcon size={13} />
                      ) : v.type === "gallery" ? (
                        <LayoutGrid size={13} />
                      ) : v.type === "dashboard" ? (
                        <LayoutDashboard size={13} />
                      ) : v.type === "chart" ? (
                        <BarChart3 size={13} />
                      ) : (
                        <Table2 size={13} />
                      )}
                      {v.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="relative">
            <button
              ref={addViewBtn}
              data-testid="db-add-view"
              onClick={() => setAddViewOpen((v) => !v)}
              aria-label="Add view"
              data-tip="Add view"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <Plus size={12} />
            </button>
            {addViewOpen &&
              createPortal(
                <div
                  ref={addViewPop}
                  style={{ visibility: "hidden" }}
                  className="popover-anim fixed z-50 w-36 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                >
                {(["table", "board", "list", "gallery", "calendar", "timeline", "chart", "dashboard"] as const).map((t) => (
                  <button
                    key={t}
                    data-testid={`db-add-view-${t}`}
                    onClick={async () => {
                      setAddViewOpen(false);
                      await addView(t);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm capitalize text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    {t}
                  </button>
                ))}
                </div>,
                document.body
              )}
          </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <FilterBar />
            <SortBar />
            <ViewOptions />
            {!fullPage && !linkedViewId && <DbExpandButton databaseId={databaseId} />}
            {/* overflow: secondary view actions live behind ⋯ */}
            <div className="relative">
              <button
                ref={viewMenuBtn}
                data-testid="db-view-menu"
                onClick={() => setViewMenuOpen((v) => !v)}
                aria-label="View options"
                data-tip="More view actions"
                className="rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                ⋯
              </button>
              {viewMenuOpen &&
                createPortal(
                  <div
                    ref={viewMenuPop}
                    style={{ visibility: "hidden" }}
                    className="popover-anim fixed z-50 flex w-44 flex-col items-stretch gap-0.5 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                  >
                    {!fullPage && !linkedViewId && <DbSourceControls />}
                    <TemplateMenu />
                  </div>,
                  document.body
                )}
            </div>
            {/* the original's primary is a SPLIT button: 80×28 + a 24×28 caret,
                radius 6, rgb(39,131,222), with a hairline between them. The caret
                menu (templates) is not built, so it says why on hover. */}
            <div className="order-last ml-1 flex h-7 shrink-0 items-stretch overflow-hidden rounded-[6px] bg-[rgb(39,131,222)]">
              <button
                data-testid="db-new-row"
                onClick={() => void addRow({})}
 // 80px in the original for this label — a minimum, so a longer one still fits
                className="flex min-w-[80px] items-center justify-center px-3 text-[14px] font-medium leading-5 text-white transition-colors hover:bg-[rgb(35,118,199)]"
              >
                {/* the toolbar's primary reads 새로 만들기 in the original; the
                    item name (새 프로젝트) is what a GROUP's add-row says */}
                새로 만들기
              </button>
              <span className="w-px bg-white/25" aria-hidden="true" />
              <button
                ref={newMoreBtn}
                data-testid="db-new-row-more"
                aria-label="추가 옵션 더 보기"
                onClick={() => setNewMoreOpen((v) => !v)}
                className="flex w-6 items-center justify-center text-white/80 transition-colors hover:bg-[rgb(35,118,199)] hover:text-white"
              >
                <ChevronDown size={16} />
              </button>
            </div>
            {newMoreOpen &&
              createPortal(
                <div
                  ref={newMorePop}
                  data-testid="db-new-row-menu"
                  style={{ visibility: "hidden" }}
                  className="popover-anim fixed z-50 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                >
 {/* the original's caret menu, read off it: a 템플릿 heading, the database's
     own templates under its name, then 기본 → 비어 있음, then 새 템플릿 */}
                  <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-neutral-400">템플릿</p>
                  <p className="truncate px-3 pb-0.5 text-[11px] text-neutral-400">
                    {database.title || "데이터베이스"}
                  </p>
                  {rows.filter((r) => r.values.__template).length === 0 && (
                    <p className="px-3 pb-1 text-[13px] text-neutral-400">템플릿이 아직 없습니다</p>
                  )}
                  {rows.filter((r) => r.values.__template).map((t) => (
                    <button
                      key={t.id}
                      data-testid={`db-new-from-template-${t.id}`}
                      onClick={() => {
                        const vals: Record<string, unknown> = { ...t.values };
                        delete vals.__template;
                        delete vals.__default;
                        setNewMoreOpen(false);
                        void addRow(vals);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                    >
                      <FileText size={15} className="shrink-0 text-neutral-400" />
                      <span className="truncate">
                        {String(t.values[properties.find((p) => p.type === "title")?.id ?? ""] ?? "") ||
                          "제목 없는 템플릿"}
                      </span>
                    </button>
                  ))}
                  <p className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium text-neutral-400">기본</p>
                  <button
                    data-testid="db-new-empty"
                    onClick={() => {
                      setNewMoreOpen(false);
                      void addRow({});
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <FileText size={15} className="shrink-0 text-neutral-400" />
                    비어 있음
                  </button>
                  <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />
                  <button
                    data-testid="db-new-template"
                    onClick={() => {
                      setNewMoreOpen(false);
                      void addRow({ __template: true });
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    <Plus size={15} className="shrink-0 text-neutral-400" />
                    새 템플릿
                  </button>
                </div>,
                document.body
              )}
            {activeView?.type !== "table" && (
            <div className="relative">
              <button
                data-testid="db-add-prop"
                onClick={() => setAddPropOpen((v) => !v)}
                aria-label="Add property"
                data-tip="Add property"
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Plus size={14} />
              </button>
              {addPropOpen && (
                <div className="popover-anim absolute right-0 top-8 z-40 w-40 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
                  {PROP_TYPES.map((pt) => (
                    <button
                      key={pt.type}
                      data-testid={`db-add-prop-${pt.type}`}
                      onClick={async () => {
                        setAddPropOpen(false);
                        await addProperty(pt.label, pt.type);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                    >
                      {pt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        {/* editable database description. A full-page database's description is
            the PAGE's — it renders above the view tabs under the title, behind
            설명 표시 / 설명 숨기기 (page-view.tsx). Inline databases keep it here. */}
        {!fullPage && (
        <input
          data-testid="db-description"
          defaultValue={database.description ?? ""}
          key={`desc-${database.description ?? ""}`}
          placeholder="Add a description…"
          onBlur={(e) => {
            const v = e.target.value;
            if (v === (database.description ?? "")) return;
            setDatabase((d) => (d ? { ...d, description: v } : d));
            void fetch(`/api/databases/${databaseId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ description: v }),
            });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="mb-1 w-full bg-transparent px-1 text-xs text-neutral-500 outline-none placeholder:text-neutral-300 dark:text-neutral-400 dark:placeholder:text-neutral-600"
        />
        )}

        {/* chips: active filters stay visible + editable inline */}
        <FilterChips />
        {activeView && draftConfigs[activeView.id] && (
          <div
            data-testid="view-draft-bar"
            className="mt-1 flex items-center gap-2 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          >
            <span>View changed — visible only to you</span>
            <button
              data-testid="view-draft-save"
              onClick={() => void saveDraft()}
              className="rounded bg-blue-500 px-2 py-0.5 font-medium text-white hover:bg-blue-600"
            >
              Save for everyone
            </button>
            <button
              data-testid="view-draft-reset"
              onClick={resetDraft}
              className="rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/40"
            >
              Reset
            </button>
          </div>
        )}

        {activeView.type === "board" ? (
          <BoardView view={activeView} />
        ) : activeView.type === "list" ? (
          <ListView view={activeView} />
        ) : activeView.type === "gallery" ? (
          <GalleryView view={activeView} />
        ) : activeView.type === "calendar" ? (
          <CalendarView view={activeView} />
        ) : activeView.type === "timeline" ? (
          <TimelineView view={activeView} />
        ) : activeView.type === "dashboard" ? (
          <DashboardView view={activeView} />
        ) : activeView.type === "chart" ? (
          <ChartView view={activeView} />
        ) : (
          <TableView view={activeView} />
        )}

        {openRowId && (
          <RowPeek
            rowId={openRowId}
            autoFocusTitle={openedNewRow}
            onClose={() => {
              setOpenRowId(null);
              setOpenedNewRow(false);
            }}
          />
        )}
        {/* 속성 편집 — the sidebar the Status menu's footer opens. Only status
            properties get it; every other type keeps the column-header menu. */}
        {(() => {
          const editing = properties.find((p) => p.id === editingPropertyId);
          return editing && editing.type === "status" ? (
            <PropertyEditPanel
              prop={editing}
              anchorRef={viewBarRef}
              onClose={() => setEditingPropertyId(null)}
            />
          ) : null;
        })()}
      </div>
    </DbCtx.Provider>
  );
}
