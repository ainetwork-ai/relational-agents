"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DbProperty, DbRow, DbView, SelectOption, ViewConfig } from "@/lib/db/schema";
import type { PublicUser } from "@/lib/auth/public-user";
import { newId } from "@/lib/compat";
import { COLOR_CYCLE } from "@/lib/db-values";
import { usePageSync } from "@/hooks/use-page-sync";
import { useRowDetails } from "@/stores/row-details";
import { DbCtx, type DbApi } from "./database-block";
import { PanelCloseButton, RowDetailsPanel, RowPropertyBlock } from "./row-property-block";

/** A database row opened as a FULL page: the same property block the side
 * peek draws (toggle · pinned band · 댓글) above the body, and 세부 정보 보기
 * hanging a 385px 속성 sidebar down the window's right edge — the original's
 * layout, measured 2026-08-27 (e2e/fixtures/notion-row-props.json).
 *
 * Self-hides when the page isn't a row's page (the body renders plain).
 * Provides a minimal DbApi so the real PropertyCell editors work here — never
 * a second, diverging editor surface. Listens on the database's SSE channel,
 * so a value changed anywhere else (a table in another window, the board, a
 * peek) shows here at once — and its own edits reach those the same way. */
export function RowPropertiesPanel({
  pageId,
  locked = false,
  children,
}: {
  pageId: string;
  locked?: boolean;
  children?: ReactNode;
}) {
  const [ref, setRef] = useState<{ databaseId: string; rowId: string } | null | undefined>(
    undefined
  );
  const [properties, setProperties] = useState<DbProperty[]>([]);
  const [rows, setRows] = useState<DbRow[]>([]);
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [allDatabases, setAllDatabases] = useState<{ id: string; title: string }[]>([]);
  const detailsOpen = useRowDetails((s) => s.open);
  const setDetailsOpen = useRowDetails((s) => s.setOpen);
 // leaving the page closes the sidebar — the next page must not open narrowed
  useEffect(() => () => setDetailsOpen(false), [setDetailsOpen]);
  const [clientId] = useState(() => newId());

  const refresh = useCallback(async (databaseId: string) => {
    const snap = await fetch(`/api/databases/${databaseId}`).then((x) => (x.ok ? x.json() : null));
    if (!snap) return false;
    setProperties(snap.properties);
    setRows(snap.rows);
    return true;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`/api/pages/${pageId}/row`).then((x) =>
        x.ok ? x.json() : { ref: null }
      );
      if (!alive) return;
      if (!r.ref) {
        setRef(null);
        return;
      }
      const [snap, mem, meRes, dbs] = await Promise.all([
        fetch(`/api/databases/${r.ref.databaseId}`).then((x) => (x.ok ? x.json() : null)),
 // the database's own workspace roster, not the switcher's active workspace
        fetch(`/api/databases/${r.ref.databaseId}/members`).then((x) => (x.ok ? x.json() : { members: [] })),
        fetch(`/api/auth/me`).then((x) => (x.ok ? x.json() : { user: null })),
        fetch(`/api/databases`).then((x) => (x.ok ? x.json() : { databases: [] })),
      ]);
      if (!alive) return;
      if (!snap) {
        setRef(null);
        return;
      }
      setProperties(snap.properties);
      setRows(snap.rows);
      setMembers(mem.members ?? []);
      setMe(meRes.user?.id ?? null);
      setAllDatabases(dbs.databases ?? []);
      setRef(r.ref);
    })();
    return () => {
      alive = false;
    };
  }, [pageId]);

 // live: someone else's edit to any row of this database (own echo
 // suppressed). Until the row lookup answers, this rides the page's own
 // stream — already open for the editor, so the shared pool gains nothing.
  usePageSync(ref?.databaseId ?? pageId, clientId, () => {
    if (ref) void refresh(ref.databaseId);
  });

  const api = useMemo<DbApi | null>(() => {
    if (!ref) return null;
    const view = {
      id: "row-page",
      databaseId: ref.databaseId,
      name: "Table",
      type: "table",
      config: {} as ViewConfig,
      position: 1,
    } as DbView;
    const headers = { "content-type": "application/json", "x-client-id": clientId };
    const updateRow = (rowId: string, values: Record<string, unknown>) => {
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, ...values } } : r))
      );
      void fetch(`/api/databases/${ref.databaseId}/rows/${rowId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ values }),
      });
    };
    return {
      databaseId: ref.databaseId,
      properties,
      related: {},
      rows,
      members,
      me,
      itemName: "페이지",
      fullPage: false,
      icon: null,
      allDatabases,
      activeView: view,
      updateRow,
      addRow: async () => null,
      deleteRow: () => {},
      moveRow: () => {},
 // DbApi hands back the property it made; this surface makes none
      addProperty: async () => null,
      addSelectOption: async (prop: DbProperty, name: string) => {
        const opt: SelectOption = {
          id: newId(),
          name,
          color: COLOR_CYCLE[(prop.config.options?.length ?? 0) % COLOR_CYCLE.length],
        };
        const options = [...(prop.config.options ?? []), opt];
        setProperties((prev) =>
          prev.map((p) => (p.id === prop.id ? { ...p, config: { ...p.config, options } } : p))
        );
        await fetch(`/api/databases/${ref.databaseId}/properties/${prop.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ config: { ...prop.config, options } }),
        });
        return opt;
      },
      toggleMulti: (rowId: string, propId: string, optId: string) => {
        const row = rows.find((r) => r.id === rowId);
        const arr = Array.isArray(row?.values[propId]) ? (row!.values[propId] as string[]) : [];
        const next = arr.includes(optId) ? arr.filter((x) => x !== optId) : [...arr, optId];
        updateRow(rowId, { [propId]: next });
      },
      updateProperty: (id, patch) => {
        setProperties((prev) =>
          prev.map((p) => (p.id === id ? ({ ...p, ...patch } as DbProperty) : p))
        );
        void fetch(`/api/databases/${ref.databaseId}/properties/${id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(patch),
        });
      },
      deleteProperty: () => {},
      patchView: () => {},
      openRow: () => {},
 // this surface has no column headers to open, so the Status menu's 속성 편집
 // has nowhere to go here
      editProperty: () => {},
      editingPropertyId: null,
      filterUiOpen: false,
      setFilterUiOpen: () => {},
      rulesRowOpen: false,
      setRulesRowOpen: () => {},
    };
  }, [ref, properties, rows, members, me, allDatabases, clientId]);

  const row = ref ? rows.find((r) => r.id === ref.rowId) : undefined;
 // not a row's page — or not known yet: the body renders plain at once (it
 // is server-rendered; holding it for the lookup would blank every page's
 // first paint) and a row page grows its block above it when the answer lands
  if (!api || !row) return <>{children}</>;

  return (
    <DbCtx.Provider value={api}>
      <div data-testid="page-row-props" className={locked ? "pointer-events-none opacity-90" : undefined}>
        <RowPropertyBlock
          row={row}
          surface="full"
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen(!detailsOpen)}
          commentsPageId={pageId}
        >
          <div className={locked ? "pointer-events-auto opacity-100" : undefined}>{children}</div>
        </RowPropertyBlock>
      </div>
      {detailsOpen && (
 // the original's notion-update-sidebar: 385px, the window's full height at
 // the right edge, its own scroller with 20/16 insets
        <RowDetailsPanel
          row={row}
          className="fixed right-0 top-0 z-40 h-full w-[385px] border-l border-[rgba(55,53,47,0.09)] pb-4 pl-5 pr-4 pt-11 dark:border-neutral-800"
        >
          {/* 패널 닫기 — always shown on a full page, round, in the top bar 9px
              in from the panel's edge (measured 2026-08-27) */}
          <PanelCloseButton round onClick={() => setDetailsOpen(false)} className="absolute" style={{ left: 9, top: 10 }} />
        </RowDetailsPanel>
      )}
    </DbCtx.Provider>
  );
}
