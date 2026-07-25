"use client";

import { useEffect, useMemo, useState } from "react";
import type { DbProperty, DbRow, DbView, SelectOption, ViewConfig } from "@/lib/db/schema";
import type { PublicUser } from "@/lib/auth/public-user";
import { newId } from "@/lib/compat";
import { COLOR_CYCLE } from "@/lib/db-values";
import { DbCtx, type DbApi } from "./database-block";
import { PropertyCell } from "./property-cell";

/** Full-page row properties (opening a database row shows title +
 * EDITABLE properties + body). Self-hides when the page isn't a row's page.
 * Provides a minimal DbApi so the real PropertyCell editors work here —
 * never a second, diverging editor surface. */
export function RowPropertiesPanel({ pageId }: { pageId: string }) {
  const [ref, setRef] = useState<{ databaseId: string; rowId: string } | null>(null);
  const [properties, setProperties] = useState<DbProperty[]>([]);
  const [rows, setRows] = useState<DbRow[]>([]);
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [allDatabases, setAllDatabases] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`/api/pages/${pageId}/row`).then((x) =>
        x.ok ? x.json() : { ref: null }
      );
      if (!alive || !r.ref) return;
      const [snap, mem, meRes, dbs] = await Promise.all([
        fetch(`/api/databases/${r.ref.databaseId}`).then((x) => (x.ok ? x.json() : null)),
        fetch(`/api/workspace/members`).then((x) => (x.ok ? x.json() : { members: [] })),
        fetch(`/api/auth/me`).then((x) => (x.ok ? x.json() : { user: null })),
        fetch(`/api/databases`).then((x) => (x.ok ? x.json() : { databases: [] })),
      ]);
      if (!alive || !snap) return;
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
    const updateRow = (rowId: string, values: Record<string, unknown>) => {
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, ...values } } : r))
      );
      void fetch(`/api/databases/${ref.databaseId}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
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
      allDatabases,
      activeView: view,
      updateRow,
      addRow: async () => null,
      deleteRow: () => {},
      moveRow: () => {},
      addProperty: async () => {},
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
          headers: { "content-type": "application/json" },
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
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
      },
      deleteProperty: () => {},
      patchView: () => {},
      openRow: () => {},
      filterUiOpen: false,
      setFilterUiOpen: () => {},
    };
  }, [ref, properties, rows, members, me, allDatabases]);

  const row = ref ? rows.find((r) => r.id === ref.rowId) : undefined;
  if (!api || !row) return null;

  return (
    <DbCtx.Provider value={api}>
      <div
        data-testid="page-row-props"
        className="mb-4 mt-3 space-y-0.5 border-b border-neutral-100 pb-4 dark:border-neutral-800"
      >
        {properties
          .filter((p) => p.type !== "title")
          .map((p) => (
            <div key={p.id} className="flex items-start gap-2">
              <span className="mt-1.5 w-32 shrink-0 truncate text-sm text-neutral-400">
                {p.name}
              </span>
              <div className="min-w-0 flex-1">
                <PropertyCell prop={p} row={row} />
              </div>
            </div>
          ))}
      </div>
    </DbCtx.Provider>
  );
}
