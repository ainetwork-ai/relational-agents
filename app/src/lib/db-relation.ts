import type { DbProperty, DbRow } from "@/lib/db/schema";

/** Minimal snapshot shape the relation/rollup cells consume from
 * GET /api/databases/{id}. */
export interface DbSnapshot {
  database: { id: string; title: string };
  properties: DbProperty[];
  rows: DbRow[];
}

/** Fetch a target database snapshot; null on any failure. */
export async function fetchDatabaseSnapshot(
  databaseId: string
): Promise<DbSnapshot | null> {
  try {
    const res = await fetch(`/api/databases/${databaseId}`);
    if (!res.ok) return null;
    return (await res.json()) as DbSnapshot;
  } catch {
    return null;
  }
}

/** The human label for a target row = its title property value, falling back
 * to a generic "Untitled" so a chip always shows text. */
export function targetRowLabel(snap: DbSnapshot | null, rowId: string): string {
  if (!snap) return "";
  const titleProp = snap.properties.find((p) => p.type === "title");
  const row = snap.rows.find((r) => r.id === rowId);
  if (!row) return "";
  const v = titleProp ? row.values[titleProp.id] : undefined;
  return typeof v === "string" && v.trim() ? v : "Untitled";
}
