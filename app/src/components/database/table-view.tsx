"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchored } from "@/hooks/use-anchored";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Pencil,
  ChevronRight,
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  Check,
  Copy,
  MessageSquare,
  PanelRight,
} from "lucide-react";
import type { DbView, DbProperty, DbRow, PropertyType } from "@/lib/db/schema";
import {
  applyView,
  computeCalc,
  buildGroups,
  isGroupable,
  orderedProperties,
  personLabels,
  visibleColumns,
  type RowGroup,
} from "@/lib/db-values";
import { UserAvatar } from "@/components/user-avatar";
import { fetchDatabaseSnapshot } from "@/lib/db-relation";
import { useDb, PROP_TYPES } from "./database-block";
import { PropertyCell } from "./property-cell";
import { RowMenu } from "./row-menu";
import { useDismiss } from "@/hooks/use-dismiss";
import { TYPE_ICON } from "./memory-select";

const NO_GROUP = "__nogroup__";

/** a row's own icon, copied from the database when the row was created */
function rowIcon(row: DbRow): string | null {
  const v = row.values.__icon;
  return typeof v === "string" && v ? v : null;
}

/** A full-page table spans the whole scroll container, whatever the window
 * width: the page is centred with a max width, so the distance from the content
 * column to the container's edge changes as the window resizes. Measured and
 * written to the element directly — through state it would race the table's own
 * re-renders, and it has to hold on every resize.
 *
 * The columns still rest where the page's text is: the same distance becomes
 * padding, which scrolls away with the content (that is how the original does
 * it — its columns rest at 374 and reach -226 as you scroll). */
function useFullBleed(ref: React.RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const host = (el.closest("main") ?? document.scrollingElement) as HTMLElement | null;
    const column = el.parentElement;
    if (!host || !column) return;
    const apply = () => {
      el.style.marginLeft = "0px";
      el.style.width = "auto";
      const h = host.getBoundingClientRect();
      const c = column.getBoundingClientRect();
      const inset = Math.max(0, Math.round(c.left - h.left));
      el.style.marginLeft = `${-inset}px`;
 // clientWidth, not the bounding rect: the rect is the border box and includes
 // the host's own vertical scrollbar (8px here — globals.css draws classic, not
 // overlay, bars). Sizing to it makes the table 8px wider than the host can
 // hold, so `main` grows a native horizontal scrollbar right under the floating
 // pill and you see two bars. That is exactly the bug this hunt was about.
      el.style.width = `${host.clientWidth}px`;
      el.style.paddingLeft = `${inset}px`;
 // the row gutter needs it too: a sticky child clamps to the scrollport's
 // CONTENT box, which this padding pushes inward, so the gutter has to subtract
 // it to reach the scroller's visible left edge
      el.style.setProperty("--db-inset", `${inset}px`);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => apply()) : null;
    ro?.observe(host);
    ro?.observe(column);
    window.addEventListener("resize", apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", apply);
      el.style.marginLeft = "";
      el.style.width = "";
      el.style.paddingLeft = "";
      el.style.removeProperty("--db-inset");
    };
  }, [ref, on]);
}

/** Render in chunks and grow as the bottom comes into view. The original loads
 * its rows the same way — 249 rows over 23 groups is 3,600 cells if you draw
 * them all at once, and the page took 12s to show its first row. */
function useIncremental(step: number, total: number) {
  const [limit, setLimit] = useState(step);
  const [seenTotal, setSeenTotal] = useState(total);
  const sentinel = useRef<HTMLDivElement | null>(null);
 // switching view (or filtering) starts the count over — adjusted during
 // render rather than in an effect, so there is no extra pass with the old list
  if (seenTotal !== total) {
    setSeenTotal(total);
    setLimit(step);
  }
  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= total || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setLimit((n) => n + step);
      },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [limit, total, step]);
  return { limit, sentinel };
}

export function TableView({ view }: { view: DbView }) {
  const db = useDb();
  const visible = applyView(db.rows, db.properties, view.config, db.me, db.related);
 // per-view property visibility AND order (hiddenProperties / propertyOrder)
  const cols = visibleColumns(db.properties, view.config);
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
          frozenLefts={frozenLefts}
          showIcon={view.config.showPageIcon ?? true}
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
 // top level — it must not disappear with its parent
    const present = new Set(rows.map((r) => r.id));
    for (const r of rows) if (!r.parentRowId || !present.has(r.parentRowId)) emit(r, 0);
    return out;
  }

 // General group-by: any groupable property (select/status/person/checkbox)
 // partitions the rows into sections. null = flat.
  const groupProp = db.properties.find(
    (p) => p.id === view.config.groupByPropertyId && isGroupable(p)
  );
  const groups: RowGroup[] = buildGroups(visible, groupProp, db.members) ?? [
    { key: NO_GROUP, label: "", rows: visible, preset: undefined },
  ];
 // collapse state lives in the view so it survives a reload, as in Notion
 // Frozen columns: the view says how many stay put while the rest scrolls
 // sideways (-1 = none, which is what the original uses — its TL column scrolls
 // away with everything else). Each frozen column sticks at the running width
 // of the ones before it.
  const frozenTo = view.config.frozenColumnIndex ?? -1;
  const frozenLefts: (number | null)[] = [];
  {
    let acc = 0;
    cols.forEach((p, i) => {
      if (i <= frozenTo) {
        frozenLefts[i] = acc;
        acc += view.config.widths?.[p.id] ?? 176;
      } else frozenLefts[i] = null;
    });
  }
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useFullBleed(scrollerRef, db.fullPage);
  const collapsedGroups = view.config.collapsedGroups ?? [];
  const hideEmptyGroups = view.config.hideEmptyGroups ?? true;
  const shownGroups = hideEmptyGroups ? groups.filter((g) => g.rows.length > 0) : groups;
  const grouped = !!groupProp;
  const { limit, sentinel } = useIncremental(grouped ? 4 : 60, grouped ? shownGroups.length : visible.length);
  const setCollapsedGroups = (keys: string[]) =>
    db.patchView({ ...view.config, collapsedGroups: keys });

  return (
    <div className="relative">
      {/* Two things at once, both taken from the original.

          Where the columns REST: lined up with the view tabs, one gutter width
          (36px) right of the row's checkbox zone. With its content area
          starting at 270 the original rests its columns at 374 and its zone at
          338; ours rest at 304 and 268.

          How far they can SCROLL: the original's scroller is the whole content
          area, so scrolling sideways carries the columns to the content's left
          edge and out of sight (374 → -226 at scrollLeft 600). Ours used to be
          a box starting at 268, which meant no column could ever pass 268 and
          the table kept a gap from the sidebar however far you dragged.

          So the box is full width (-mx-16 cancels the page's inset) and the
          resting position comes from padding inside it (pl-16), which scrolls
          away with the content.

          The visible bar is the floating db-hscroll pill below, which tracks
          this box — so the NATIVE bar here must be hidden or there are two.
          `[scrollbar-width:none]` never did it: globals.css sets
          `* { scrollbar-width: thin }` unlayered, and unlayered CSS beats any
          Tailwind utility whatever its specificity. `.no-native-scrollbar`
          (globals.css, unlayered, later) is the one that holds. */}
      <div
        ref={scrollerRef}
 // full-page: margin/width/padding are measured against the scroll container
 // (see useFullBleed) because the page is centred with a max width, so a fixed
 // -mx-16 only worked while the window was narrow enough for that centring to
 // be zero — past that the table started further and further right.
        // inline, not a class: `* { scrollbar-width: thin }` in globals.css is
        // unlayered and beat the utility, and an inline style beats both — this
        // one must hold or the page shows the native bar AND the pill below.
        style={{ scrollbarWidth: "none" }}
        className={`no-native-scrollbar overflow-x-auto ${db.fullPage ? "" : "-ml-9 w-full pl-9"}`}
      >
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
        {grouped ? (
 // Grouped: every section carries its own column header row, add-row and
 // header affordances — the shape of the grouped table in `target.html`.
          shownGroups.slice(0, limit).map((g) => (
              <GroupSection
                key={g.key}
                group={g}
                view={view}
                cols={cols}
                groupProp={groupProp}
                collapsed={collapsedGroups.includes(g.key)}
                onToggle={() =>
                  setCollapsedGroups(
                    collapsedGroups.includes(g.key)
                      ? collapsedGroups.filter((k) => k !== g.key)
                      : [...collapsedGroups, g.key]
                  )
                }
                onCollapseAll={() => setCollapsedGroups(groups.map((x) => x.key))}
                onExpandAll={() => setCollapsedGroups([])}
                renderRows={renderRows}
                frozenLefts={frozenLefts}
              />
          ))
        ) : (
          <>
            <HeaderRow cols={cols} view={view} frozenLefts={frozenLefts} />
            {renderRows(visible.slice(0, limit))}
            <AddRowButton testid="db-add-row" onClick={() => db.addRow()} />
          </>
        )}
        {limit < (grouped ? shownGroups.length : visible.length) && (
          <div ref={sentinel} data-testid="db-load-more" className="h-8" />
        )}

        {/* calculation footer — selects fade in on row hover; a
            chosen calc stays visible */}
        <div className="group/calcrow flex border-t border-neutral-200 dark:border-neutral-700">
          {cols.map((p) => (
            <CalcCell key={p.id} view={view} prop={p} rows={visible} />
          ))}
        </div>
        </div>
      </div>
      <BottomScrollbar scrollerRef={scrollerRef} />
    </div>
  );
}

/** The horizontal scrollbar the original keeps at the bottom of the SCREEN, not
 * at the end of a 2,700px-tall table where nobody can reach it. `sticky` does
 * not hold in this page's layout, so the bar is fixed and follows the table's
 * own left edge and width; the table hides its native bar and the two scroll
 * each other. */
/** Measured off the original on 2026-08-06 (CDP screenshot of its page
 * scroller, read pixel by pixel — dpr 2 × clip scale, so divide by 6, not 3):
 * a 15px track carrying an 8px thumb, i.e. 3.5px of groove on every side.
 * `el.offsetHeight - el.clientHeight` on `.notion-scroller.vertical.horizontal`
 * confirms the 15. An earlier pass here put an 11px thumb in that 15px track by
 * eye and it read as too thick — the original's bar is thinner than it looks,
 * because most of the 15px is groove. */
const BAR_H = 15;
const BAR_INSET = 3.5;

function BottomScrollbar({ scrollerRef }: { scrollerRef: React.RefObject<HTMLDivElement | null> }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
 // The bar is fixed to the window, so it would sit ON TOP of whatever row
 // happens to be at the bottom edge — and the page showed through the gaps
 // around the thumb. A native scrollbar does not do that: it takes its height
 // out of the scrollport. A bottom border on the scroll container is the same
 // thing — the scrollport is the padding box, so content is clipped above the
 // border and the strip the bar sits in shows only the app background.
    const host = sc.closest("main") as HTMLElement | null;
    const reserve = (on: boolean) => {
      if (!host) return;
      host.style.borderBottomStyle = on ? "solid" : "";
      host.style.borderBottomColor = on ? "transparent" : "";
      host.style.borderBottomWidth = on ? `${BAR_H}px` : "";
    };

 // Drawn rather than delegated to a native scrollbar: this browser renders
 // overlay scrollbars, which appear only mid-scroll — no use as the one thing
 // telling the reader the table continues to the right. Written straight to the
 // DOM because it runs on every scroll frame.
    const layout = () => {
      const track = trackRef.current;
      const thumb = thumbRef.current;
      if (!track || !thumb) return;
      const r = sc.getBoundingClientRect();
      const scrollable = sc.scrollWidth - sc.clientWidth;
 // Reserving depends only on whether the table scrolls sideways, never on
 // whether the bar is currently on screen: tying it to visibility would make
 // the reserved strip appear and disappear, resizing the scrollport, which
 // moves the table, which re-runs this — an oscillation.
      reserve(scrollable >= 2);
      const onScreen = r.top < window.innerHeight - 40 && r.bottom > 140;
      if (scrollable < 2 || !onScreen) {
        track.style.display = "none";
        return;
      }
      track.style.display = "";
      track.style.left = `${Math.round(r.left)}px`;
      track.style.width = `${Math.round(r.width)}px`;
      const travel = Math.max(0, Math.round(r.width) - BAR_INSET * 2);
      const ratio = sc.clientWidth / sc.scrollWidth;
      const thumbW = Math.max(40, Math.round(travel * ratio));
      thumb.style.width = `${thumbW}px`;
      thumb.style.transform = `translateX(${Math.round((sc.scrollLeft / scrollable) * (travel - thumbW))}px)`;
    };

    layout();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => layout()) : null;
    ro?.observe(sc);
    window.addEventListener("scroll", layout, true);
    window.addEventListener("resize", layout);
    return () => {
      ro?.disconnect();
      window.removeEventListener("scroll", layout, true);
      window.removeEventListener("resize", layout);
      reserve(false);
    };
  }, [scrollerRef]);

 // drag the thumb, or click anywhere on the track to jump there
  const seek = (clientX: number, grabOffset: number) => {
    const sc = scrollerRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!sc || !track || !thumb) return;
    const r = track.getBoundingClientRect();
    const thumbW = thumb.offsetWidth;
 // the thumb runs inside the track's inset, not edge to edge
    const travel = r.width - BAR_INSET * 2 - thumbW;
    if (travel <= 0) return;
    const x = Math.min(Math.max(clientX - r.left - BAR_INSET - grabOffset, 0), travel);
    sc.scrollLeft = (x / travel) * (sc.scrollWidth - sc.clientWidth);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    e.preventDefault();
    const tr = thumb.getBoundingClientRect();
    const onThumb = e.clientX >= tr.left && e.clientX <= tr.right;
    const grab = onThumb ? e.clientX - tr.left : thumb.offsetWidth / 2;
    seek(e.clientX, grab);
    const move = (ev: PointerEvent) => seek(ev.clientX, grab);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

 // Flush to the bottom edge, on the window's own edge with nothing under it:
 // the original's bar is a NATIVE one on its page scroller, styled
 // `* { scrollbar-width: 15px; scrollbar-color: #D3D1CB rgba(0,0,0,0) }`
 // (target.html line 2). Floating it 8px up as a rounded pill left a strip of
 // page showing beneath, which reads as a widget hovering over the table.
 //
 // The track paints the app background rather than nothing: it sits in the
 // strip reserved above, and a see-through groove shows the clipped edge of
 // the last row through the gaps around the thumb.
  return (
    <div
      ref={trackRef}
      data-testid="db-hscroll"
      onPointerDown={onPointerDown}
      style={{ display: "none", height: BAR_H, paddingLeft: BAR_INSET, paddingRight: BAR_INSET }}
      className="fixed bottom-0 z-30 flex cursor-pointer items-center bg-white dark:bg-[#191919]"
    >
      <div
        ref={thumbRef}
        data-testid="db-hscroll-thumb"
        style={{ height: BAR_H - BAR_INSET * 2 }}
 // #D3D1CB is the original's thumb, opaque (`scrollbar-color: #D3D1CB
 // rgba(0,0,0,0)`, and a screenshot reads rgb(211,209,204) off the pixels).
 // Dark mode is not measured — switching the original's theme would change
 // the user's own setting — so it keeps a matching neutral.
        className="rounded-full bg-[#D3D1CB] transition-colors hover:bg-[#B9B7B1] dark:bg-[#5A5A5A] dark:hover:bg-[#6E6E6E]"
      />
    </div>
  );
}

/** The column header row. A grouped table repeats it inside every section
 * (`target.html` carries 10 `notion-table-view-header-row`s for 10 groups). */
function HeaderRow({
  cols,
  view,
  frozenLefts,
}: {
  cols: DbProperty[];
  view: DbView;
  frozenLefts: (number | null)[];
}) {
  return (
    <div className="flex border-b border-neutral-200 dark:border-neutral-700">
      {cols.map((p, i) => (
        <ColumnHeader key={p.id} prop={p} view={view} frozenLeft={frozenLefts[i]} />
      ))}
 {/* the column grid ends here — the original closes it with the table's own
     right edge and puts + / ⋯ BEYOND that line, with no cell borders of their
     own (e2e/fixtures/notion-header-tail.json). Ours had the + inside the grid,
     which is why it read as part of the last property's column. */}
      <div className="w-px shrink-0 self-stretch bg-neutral-200 dark:bg-neutral-700" />
      <HeaderTail />
    </div>
  );
}

function AddRowButton({ testid, onClick }: { testid: string; onClick: () => void }) {
  const label = `새 ${useDb().itemName}`;
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className="flex w-full items-center gap-1 px-2 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-600 dark:hover:bg-neutral-800"
    >
      <span className="sticky left-2 flex items-center gap-1">
        <Plus size={13} /> {label}
      </span>
    </button>
  );
}

/** One group-by section of a grouped table: a header carrying the group value,
 * its options menu and "add a page to this group", then the section's own
 * column header row, rows and add-row. */
function GroupSection({
  group,
  groupProp,
  view,
  cols,
  collapsed,
  onToggle,
  onCollapseAll,
  onExpandAll,
  renderRows,
  frozenLefts,
}: {
  group: RowGroup;
  groupProp: DbProperty;
  view: DbView;
  cols: DbProperty[];
  collapsed: boolean;
  onToggle: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  renderRows: (rows: DbRow[]) => ReactNode[];
  frozenLefts: (number | null)[];
}) {
  const db = useDb();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const showCount = view.config.showGroupCount ?? false;

  useDismiss(menuOpen, () => setMenuOpen(false), menuRef);

 // a person section is headed by that person's own face
  const groupPerson =
    groupProp.type === "person" ? personLabels(db.members, group.preset)[0] : undefined;

 // a row added inside a section must carry that section's value
  const addToGroup = () =>
    void db.addRow(group.preset === undefined ? {} : { [groupProp.id]: group.preset });

  return (
    <div data-testid={`db-group-${group.key}`}>
      <div
        data-testid={`db-group-header-${group.key}`}
        className="group/gh flex h-9 items-center border-b border-neutral-100 dark:border-neutral-800"
      >
        <div className="sticky left-0 z-[3] flex items-center gap-1 bg-[var(--background)] pl-1 pr-2">
          <button
            data-testid={`db-group-toggle-${group.key}`}
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "열기" : "닫기"}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            <ChevronDown
              size={13}
              className={`transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
            />
          </button>
          <span className="flex min-w-0 items-center gap-1.5 rounded px-1 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            {groupPerson && (
              <UserAvatar
                user={{ displayName: groupPerson.label, avatarUrl: groupPerson.avatarUrl }}
                size={20}
              />
            )}
            <span className="truncate">{group.label}</span>
          </span>
          {showCount && (
            <span
              data-testid={`db-group-count-${group.key}`}
              className="text-xs text-neutral-400 dark:text-neutral-500"
            >
              {group.rows.length}
            </span>
          )}
          <div className="relative flex items-center gap-0.5 opacity-0 transition-opacity group-hover/gh:opacity-100">
            <button
              data-testid={`db-group-options-${group.key}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="그룹 옵션 표시"
              aria-expanded={menuOpen}
              className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            >
              <MoreHorizontal size={14} />
            </button>
            <button
              data-testid={`db-group-add-${group.key}`}
              onClick={addToGroup}
              aria-label={`그룹에 새 ${db.itemName} 추가`}
              className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            >
              <Plus size={14} />
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                data-testid={`db-group-menu-${group.key}`}
                className="popover-anim absolute left-0 top-7 z-50 w-44 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
              >
                <GroupMenuItem
                  testid={`db-group-menu-collapse-all-${group.key}`}
                  label="모든 그룹 접기"
                  onClick={() => {
                    setMenuOpen(false);
                    onCollapseAll();
                  }}
                />
                <GroupMenuItem
                  testid={`db-group-menu-expand-all-${group.key}`}
                  label="모든 그룹 펼치기"
                  onClick={() => {
                    setMenuOpen(false);
                    onExpandAll();
                  }}
                />
                <GroupMenuItem
                  testid={`db-group-menu-count-${group.key}`}
                  label="그룹 개수 표시"
                  checked={showCount}
                  onClick={() => {
                    setMenuOpen(false);
                    db.patchView({ ...view.config, showGroupCount: !showCount });
                  }}
                />
                <GroupMenuItem
                  testid={`db-group-menu-hide-empty-${group.key}`}
                  label="빈 그룹 숨기기"
                  checked={view.config.hideEmptyGroups ?? true}
                  onClick={() => {
                    setMenuOpen(false);
                    db.patchView({
                      ...view.config,
                      hideEmptyGroups: !(view.config.hideEmptyGroups ?? true),
                    });
                  }}
                />
                <GroupMenuItem
                  testid={`db-group-menu-ungroup-${group.key}`}
                  label="그룹화 제거"
                  onClick={() => {
                    setMenuOpen(false);
                    db.patchView({
                      ...view.config,
                      groupByPropertyId: undefined,
                      collapsedGroups: [],
                    });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {!collapsed && (
        <>
          <HeaderRow cols={cols} view={view} frozenLefts={frozenLefts} />
          {renderRows(group.rows)}
          <AddRowButton testid={`db-group-add-row-${group.key}`} onClick={addToGroup} />
        </>
      )}
    </div>
  );
}

function GroupMenuItem({
  testid,
  label,
  onClick,
  checked,
}: {
  testid: string;
  label: string;
  onClick: () => void;
  checked?: boolean;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
    >
      <span className="w-3.5">{checked && <Check size={13} />}</span>
      {label}
    </button>
  );
}

/** What a cell offers on hover — only what was actually measured on the
 * original (docs/notion-projects-spec.md). A cell WITH a value shows 댓글 at its
 * right edge (24×20, 7px in); date and number also show 클립보드에 복사;
 * `Created time`, read-only, shows the copy button alone. An EMPTY cell shows
 * nothing, and so does any type not in these lists — text, url, checkbox,
 * relation and the rest are unmeasured, and guessing at them is how the wrong
 * things ended up here before. */
const COMMENT_TYPES: PropertyType[] = [
  "person",
  "status",
  "select",
  "multi_select",
  "date",
  "number",
];
const COPY_TYPES: PropertyType[] = ["date", "number", "created_time"];

function CellActions({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const [copied, setCopied] = useState(false);
  const canComment = COMMENT_TYPES.includes(prop.type);
  const canCopy = COPY_TYPES.includes(prop.type);
  const value = row.values[prop.id];
  const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
 // created_time has no stored value but always reads as filled
  const filled = prop.type === "created_time" ? true : !empty;
  if ((!canComment && !canCopy) || !filled) return null;

  const copy = (e: React.MouseEvent) => {
    const cell = (e.currentTarget as HTMLElement).closest("[data-cellnav]");
    void navigator.clipboard?.writeText((cell?.textContent ?? String(value ?? "")).trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 900);
  };

  return (
    // These belong to the ONE cell the pointer is in, not to the row: the
    // original shows 댓글 for the hovered COLUMN only, while 열기 (a row-level
    // action) is what follows the row. Keyed to /dbrow, every qualifying cell
    // in the row lit up at once.
    <div className="pointer-events-none absolute right-[7px] top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover/dbcell:pointer-events-auto group-hover/dbcell:opacity-100">
      {canComment && (
        <button
          data-testid={`db-cell-comment-${row.id}-${prop.id}`}
          aria-label="댓글"
          title="셀 댓글은 아직 없습니다"
          disabled
          className="flex h-5 w-6 cursor-not-allowed items-center justify-center rounded border border-neutral-200 bg-white text-neutral-300 shadow-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-600"
        >
          <MessageSquare size={12} />
        </button>
      )}
      {canCopy && (
        <button
          data-testid={`db-cell-copy-${row.id}-${prop.id}`}
          aria-label="클립보드에 복사"
          title="클립보드에 복사"
          onClick={copy}
          className="flex h-5 w-6 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
        </button>
      )}
    </div>
  );
}

/** Opaque backing for a frozen column: cells scrolling underneath must not show
 * through, so the frozen cell repaints the row's background itself — base first,
 * then the hover/selected tint, in the same order the row paints them. */
function FrozenBg({ checked }: { checked?: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 bg-[var(--background)]"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 -z-10 ${
          checked ? "bg-blue-50/70 dark:bg-blue-900/20" : ""
        }`}
      />
    </>
  );
}

/**  places "add a property" as a "+" header cell at the right end of
 * the table, not in the toolbar. */
/** The header row's tail: add a property, and show/hide properties. Measured
 *  from the original — two 28x28 controls with 16px icons, sitting outside the
 *  column grid (e2e/fixtures/notion-header-tail.json). */
function HeaderTail() {
  return (
    <div className="flex shrink-0 items-center gap-0 px-0 py-1">
      <AddPropertyHeader />
      <PropertyVisibilityHeader />
    </div>
  );
}

/** The ⋯ beside it. In the original its tooltip is "속성 표시 또는 숨기기", and it
 *  opens exactly that list — so it opens ours (the same toggles the view
 *  settings panel carries), anchored to itself. */
function PropertyVisibilityHeader() {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useAnchored(open, btnRef, popRef, { align: "end" });
  useDismiss(open, () => setOpen(false), btnRef, popRef);
  const hidden = db.activeView.config.hiddenProperties ?? [];
  const toggle = (id: string) =>
    db.patchView({
      ...db.activeView.config,
      hiddenProperties: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id],
    });
  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        data-testid="db-header-props"
        onClick={() => setOpen((v) => !v)}
        aria-label="속성 표시 또는 숨기기"
        data-tip="속성 표시 또는 숨기기"
        className="flex h-7 w-7 items-center justify-center rounded-md text-[#7d7a75] transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <MoreHorizontal size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            data-testid="db-header-props-popover"
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 w-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
          >
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-neutral-400">
              속성 표시 또는 숨기기
            </p>
            {db.properties.map((p) => (
              <label
                key={p.id}
                data-testid={`db-header-prop-${p.id}`}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <input
                  type="checkbox"
                  checked={!hidden.includes(p.id)}
                  onChange={() => toggle(p.id)}
                  className="h-3.5 w-3.5 accent-blue-500"
                />
                <span className="w-3.5 shrink-0 text-center text-[10px] text-neutral-400">
                  {TYPE_ICON[p.type] ?? "•"}
                </span>
                <span className="truncate">{p.name}</span>
              </label>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

function AddPropertyHeader() {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
 // portalled and placed: this list of property types is 618px tall, and the
 // table's own horizontal scroller cut 454px of it off
  useAnchored(open, btnRef, popRef, { align: "end" });
  useDismiss(open, () => setOpen(false), btnRef, popRef);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={btnRef}
        data-testid="db-add-prop"
        onClick={() => setOpen((v) => !v)}
        aria-label="속성 추가"
        data-tip="속성 추가"
        className="flex h-7 w-7 items-center justify-center rounded-md text-[#7d7a75] transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <Plus size={16} />
      </button>
      {open &&
        createPortal(
        <div ref={popRef}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 overflow-y-auto w-40 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
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
        </div>,
          document.body
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
  frozenLefts,
  showIcon = true,
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
  frozenLefts: (number | null)[];
  showIcon?: boolean;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  onAddSub?: () => void;
  checked?: boolean;
  onCheck?: () => void;
}) {
  const db = useDb();
 // the ⠿ handle is the menu's anchor AND its toggle: a boolean, not a pointer
 // position, so the menu opens in the same place however precisely you click
 // and a second click on the handle closes it instead of reopening 1px over
  const [menuOpen, setMenuOpen] = useState(false);
  const dragRef = useRef<HTMLButtonElement>(null);
  return (
    <div
      data-testid={`db-row-${row.id}`}
      data-dbrow
 // no tint on hover: the original leaves a hovered row exactly as it was and
 // only brings out its controls (checked rows still tint, to show a selection)
      className={`group/dbrow relative flex border-b border-neutral-100 dark:border-neutral-800 ${
        checked ? "bg-blue-50/70 dark:bg-blue-900/20" : ""
      }`}
    >
      {/* The row's grip and checkbox, in the page inset left of the first cell.
          They take no width, off a zero-width sticky anchor.

          The anchor's `left` is `37px − the table's own left inset`, and the two
          sit at −62 and −26 from it, so BOTH states land where the original's
          do (measured at scrollLeft 0 / 400 / 1250):

            not scrolled  anchor at the row's own start → ⠿ row−62, ☐ row−26
            scrolled      a sticky child clamps to the scrollport's CONTENT box,
                          which the full-bleed padding pushes inward — subtract
                          it and the clamp lands at scroller+37, so ☐ sits at
                          scroller+11 and the ⠿ passes the edge, out of sight

          `left-0` pinned them at a fixed viewport spot instead, so scrolling
          slid the cells UNDER them and the checkbox sat on top of a name. */}
      <div className="sticky z-[4] w-0 shrink-0" style={{ left: "calc(37px - var(--db-inset, 0px))" }}>
        <div
          className={`absolute top-0 flex h-[37px] items-center transition-opacity ${
            checked ? "opacity-100" : "opacity-0 group-hover/dbrow:opacity-100"
          }`}
        >
          <button
            data-testid={`db-row-drag-${row.id}`}
            style={{ position: "absolute", left: -62 }}
            ref={dragRef}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
 // click opens the row menu, drag reorders — the handle does both in the
 // original, told apart by whether the pointer moved
              const from = { x: e.clientX, y: e.clientY };
              const onUp = (ev: PointerEvent) => {
                window.removeEventListener("pointerup", onUp);
                if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 4) {
                  setMenuOpen((v) => !v);
                  return;
                }
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
            // the original's own words for this handle, read off it (our "열
            // 메뉴" read as COLUMN menu, which is not what it opens)
            aria-label="드래그하여 이동하고 클릭하여 메뉴를 여세요"
            className="shrink-0 cursor-grab text-neutral-300 hover:text-neutral-500"
          >
            <GripVertical size={16} />
          </button>
          <input
            type="checkbox"
            data-testid={`db-row-check-${row.id}`}
            checked={checked}
            onChange={() => onCheck?.()}
            aria-label="Select row"
            style={{ position: "absolute", left: -26 }}
            className="h-4 w-4 shrink-0 rounded-[3px] accent-blue-500"
          />
        </div>
      </div>
      {cols.map((p, i) =>
        p.type === "title" ? (
 // Title cell: hovering it reveals a "사이드 보기" button at the right edge
 // opens the row's page (its full mapped content).
          <div
            key={p.id}
            style={{
              width: widths?.[p.id] ?? 176,
              ...(frozenLefts[i] != null ? { left: frozenLefts[i]! } : {}),
            }}
            tabIndex={0}
            data-cellnav
            onKeyDown={onCellNavKey}
            className={`group/titlecell relative flex h-[37px] shrink-0 items-center overflow-hidden border-l border-neutral-100 first:border-l-0 dark:border-neutral-800 ${
              frozenLefts[i] != null ? "sticky z-[2]" : ""
            }`}
          >
            {frozenLefts[i] != null && <FrozenBg checked={checked} />}
            {/* sub-item indent and its toggle sit inside the title cell */}
            {depth > 0 && <span className="shrink-0" style={{ width: depth * 18 }} />}
            {hasChildren ? (
              <button
                data-testid={`db-row-expand-${row.id}`}
                onClick={onToggle}
                aria-label={collapsed ? "하위 항목 펼치기" : "하위 항목 접기"}
                className="ml-1 shrink-0 text-neutral-400 hover:text-neutral-600"
              >
                <ChevronRight
                  size={13}
                  className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
                />
              </button>
            ) : (
              depth > 0 && <span className="ml-1 w-[13px] shrink-0" />
            )}
            {/* The row's OWN icon, copied from the database when the row was
                made and changeable per row — see docs/notion-icon-policy.md.
                Rows that predate the copy fall back to the database's. */}
            {showIcon && (rowIcon(row) ?? db.icon) && (
              <span className="ml-1 shrink-0 text-[13px] leading-none" aria-hidden="true">
                {rowIcon(row) ?? db.icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <PropertyCell prop={p} row={row} />
            </div>
            <button
              data-testid={`db-title-open-${row.id}`}
              onClick={() => db.openRow(row.id)}
              aria-label="사이드 보기에서 열기"
              title="사이드 보기에서 열기"
 // opacity-0 alone still intercepts clicks — disable pointer events
 // until hover so the invisible button never swallows a title click
              className="pointer-events-none absolute right-[7px] top-1/2 z-10 flex h-5 -translate-y-1/2 items-center gap-0.5 rounded border border-neutral-200 bg-white px-1.5 text-[11px] font-medium text-neutral-600 opacity-0 shadow-sm transition-opacity hover:bg-neutral-50 group-hover/dbcell:pointer-events-auto group-hover/dbcell:opacity-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <PanelRight size={11} /> 열기
            </button>
            {/* the row actions that used to sit in the gutter now hover here,
                left of 열기 */}
            <div className="pointer-events-none absolute right-14 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1.5 opacity-0 transition-opacity group-hover/dbcell:pointer-events-auto group-hover/dbcell:opacity-100">
              <button
                data-testid={`db-subitem-add-${row.id}`}
                onClick={onAddSub}
                aria-label="하위 항목 추가"
                title="하위 항목 추가"
                className="text-neutral-300 hover:text-blue-500"
              >
                <Plus size={13} />
              </button>
              
            </div>
          </div>
        ) : (
          <div
            key={p.id}
            style={{
              width: widths?.[p.id] ?? 176,
              ...(frozenLefts[i] != null ? { left: frozenLefts[i]! } : {}),
            }}
            tabIndex={0}
            data-cellnav
            onKeyDown={onCellNavKey}
 // one line per cell: the original's table views all carry `table_wrap: false`,
 // so a cell with five team chips is clipped rather than growing the row
 // relative: the hover actions are absolutely placed at this cell's right
 // edge. Without it they resolved against the row — 2,900px wide — and sat off
 // screen past the last column, which is why the 댓글 button never showed.
            className={`group/dbcell relative flex h-[37px] shrink-0 items-center overflow-hidden border-l border-neutral-100 first:border-l-0 dark:border-neutral-800 ${
              frozenLefts[i] != null ? "sticky z-[2]" : ""
            }`}
          >
            {frozenLefts[i] != null && <FrozenBg checked={checked} />}
            {/* min-w-0: a flex item's automatic minimum is its content, so a
                one-line cell (a select chip, a row of team chips) refused to
                shrink and simply overflowed under the next column, where
                overflow-hidden cut it without an ellipsis */}
            <div className="min-w-0 flex-1">
              <PropertyCell prop={p} row={row} />
            </div>
            <CellActions prop={p} row={row} />
          </div>
        )
      )}
      {menuOpen && (
        <RowMenu row={row} triggerRef={dragRef} onClose={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

function ColumnHeader({
  prop,
  view,
  frozenLeft,
}: {
  prop: DbProperty;
  view: DbView;
  frozenLeft?: number | null;
}) {
  const db = useDb();
  const [selfOpen, setSelfOpen] = useState(false);
  const headerBtn = useRef<HTMLButtonElement>(null);
  const headerPop = useRef<HTMLDivElement>(null);
 // the Status menu's 속성 편집 asks for THIS column's menu by id; derived rather
 // than copied into state, so no effect has to sync the two
  const open = selfOpen || db.editingPropertyId === prop.id;
 // portalled and placed: on a right-hand column this menu hung 94px past the
 // window, and inside the table's scroller it had nowhere to go
  useAnchored(open, headerBtn, headerPop, { align: "start" });
  const setOpen = (v: boolean) => {
    setSelfOpen(v);
    if (!v && db.editingPropertyId === prop.id) db.editProperty(null);
  };
 // two-step confirm before the irreversible property delete
  const [delArmed, setDelArmed] = useState(false);
  const [renaming, setRenaming] = useState(false);
 // disarm whenever the menu closes (render-time adjustment, not an effect)
  if (!open && delArmed) setDelArmed(false);
  const [draft, setDraft] = useState(prop.name);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(open, () => setOpen(false), ref);

  function sortBy(dir: "asc" | "desc") {
    db.patchView({ ...view.config, sorts: [{ propertyId: prop.id, dir }] });
    setOpen(false);
  }

 // Drag a column header onto another to reorder columns. The order belongs to
 // THIS view (config.propertyOrder), so the same database can start with TL in
 // one view and Team in another, as the original does.
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
 // start from the order as rendered, so the first drag in a view that has
 // never been reordered doesn't scramble the rest
      const ids = orderedProperties(db.properties, view.config).map((p) => p.id);
      const from = ids.indexOf(prop.id);
      let to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return;
      const rect = header.getBoundingClientRect();
      if (ev.clientX >= rect.x + rect.width / 2) to += 1;
      if (to > from) to -= 1;
      ids.splice(to, 0, ...ids.splice(from, 1));
      db.patchView({ ...view.config, propertyOrder: ids });
    };
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={ref}
      style={{
        width: view.config.widths?.[prop.id] ?? 176,
        ...(frozenLeft != null ? { left: frozenLeft } : {}),
      }}
      className={`group/col relative shrink-0 border-l border-neutral-200 first:border-l-0 dark:border-neutral-700 ${
        frozenLeft != null ? "sticky z-[3] bg-[var(--background)]" : ""
      }`}
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
          ref={headerBtn}
          data-testid={`db-prop-header-${prop.id}`}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          <span className="w-3.5 shrink-0 text-center text-[10px] text-neutral-400">
            {TYPE_ICON[prop.type] ?? "•"}
          </span>
          <span className="truncate">{prop.name}</span>
        </button>
      )}
      {open &&
        createPortal(
        <div
          ref={headerPop}
          style={{ visibility: "hidden" }}
          className="popover-anim fixed z-50 w-40 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        >
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
        </div>,
          document.body
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

/** Change a column's type in place. Values are
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

/** AI database autofill: fill EMPTY cells of a column from each row's
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
