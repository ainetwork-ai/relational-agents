"use client";

import { createContext, useContext } from "react";
import type {
  DbProperty,
  DbRow,
  DbView,
  PropertyType,
  PropertyConfig,
  ViewConfig,
  SelectOption,
} from "@/lib/db/schema";
import type { PublicUser } from "@/lib/auth/public-user";
import type { RelatedSnapshots } from "@/lib/db-values";

interface DbApi {
  databaseId: string;
  properties: DbProperty[];
  /** target-db snapshots for relation/rollup filters & sorts, keyed by db id */
  related: RelatedSnapshots;
  rows: DbRow[];
  members: PublicUser[];
  me: string | null;
  /** what one row is called — the original's Projects says "새 프로젝트" */
  itemName: string;
  /** rendered as the page itself (not an inline block) */
  fullPage: boolean;
  /** the database's icon. Every row of the original's table carries it
   * (`/icons/iterate_blue.svg` in each title cell) because a row IS a page and
   * inherits the database's icon; pages nested inside a row do not. For a
   * full-page database that icon is the page's own. */
  icon: string | null;
  activeView: DbView;
  /** all databases in the workspace — for the relation target picker */
  allDatabases: { id: string; title: string }[];
  updateRow: (rowId: string, values: Record<string, unknown>) => void;
  addRow: (values?: Record<string, unknown>, parentRowId?: string) => Promise<DbRow | null>;
  deleteRow: (rowId: string) => void;
  /** manual reorder: fractional position between neighbors (drag a row grip) */
  moveRow: (rowId: string, position: number) => void;
  addProperty: (name: string, type: PropertyType) => Promise<DbProperty | null>;
  addSelectOption: (prop: DbProperty, name: string) => Promise<SelectOption>;
  toggleMulti: (rowId: string, propId: string, optId: string) => void;
  updateProperty: (
    id: string,
    patch: { name?: string; type?: PropertyType; config?: PropertyConfig; position?: number }
  ) => void;
  deleteProperty: (id: string) => void;
  patchView: (config: ViewConfig, opts?: { draft?: boolean }) => void;
  openRow: (rowId: string) => void;
  /** open a column's header menu from somewhere else — the Status menu's
   * 속성 편집 row, which the original also points at the property editor */
  editProperty: (propId: string | null) => void;
  editingPropertyId: string | null;
  /** true while the toolbar Filter popover (advanced panel) is open — the
 * chips row suppresses its auto-open-editor so both surfaces never show
 * the same filter editor at once */
  filterUiOpen: boolean;
  setFilterUiOpen: (open: boolean) => void;
}

// Anchored on globalThis, not a bare module-level createContext: Turbopack's
// production build instantiates this module TWICE (verified by tagging the
// built chunks — the factory ran two times), so a plain `createContext` yields
// two context objects; DatabaseBlock provides one while useDb reads the other,
// and every database render dies with the error below. Prod-only: dev serves
// singleton modules. Extracting the context to this tiny module did NOT stop
// the duplication — the whole subgraph is duplicated — so the object identity
// itself is pinned outside the module system.
const g = globalThis as { __ainmemDbCtx?: ReturnType<typeof createContext<DbApi | null>> };
export const DbCtx = (g.__ainmemDbCtx ??= createContext<DbApi | null>(null));
export type { DbApi };
export function useDb() {
  const ctx = useContext(DbCtx);
  if (!ctx) throw new Error("useDb outside DatabaseBlock");
  return ctx;
}
