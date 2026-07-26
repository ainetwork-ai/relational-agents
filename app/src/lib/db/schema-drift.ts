import "server-only";
import { is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { db } from "./index";
import * as schema from "./schema";

/**
 * Does the database have what this build expects?
 *
 * Schema changes are applied with `drizzle-kit push`, by hand, against one
 * database at a time — dev and live are deliberately separate (docs/deployment
 * 3.3), and pushing automatically at boot would hand a deploy the power to drop
 * a column without anyone reading the diff. The cost of that choice is that a
 * build can reach an older database and only find out deep inside a route,
 * where it surfaces as `column "call_id" does not exist` in a request log.
 *
 * So: read-only, at startup. It cannot fix anything and does not try. It says
 * what is missing and which command applies it.
 */

export interface SchemaDrift {
  ok: boolean;
  missingTables: string[];
  /** `table.column` for columns the code knows about and the database does not */
  missingColumns: string[];
  /** set when the check itself could not run (no database, no permission) */
  error?: string;
}

function expected(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    out.set(cfg.name, new Set(cfg.columns.map((c) => c.name)));
  }
  return out;
}

export async function checkSchemaDrift(): Promise<SchemaDrift> {
  const want = expected();
  try {
    const rows = (await db.execute(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`
    )) as unknown as { rows: { table_name: string; column_name: string }[] };
    const have = new Map<string, Set<string>>();
    for (const r of rows.rows ?? []) {
      if (!have.has(r.table_name)) have.set(r.table_name, new Set());
      have.get(r.table_name)!.add(r.column_name);
    }

    const missingTables: string[] = [];
    const missingColumns: string[] = [];
    for (const [table, columns] of want) {
      const actual = have.get(table);
      if (!actual) {
        missingTables.push(table);
        continue;
      }
      for (const c of columns) if (!actual.has(c)) missingColumns.push(`${table}.${c}`);
    }
   // Extra columns the database has and the code does not are none of our
   // business: an older build talking to a newer database still works.
    return {
      ok: missingTables.length === 0 && missingColumns.length === 0,
      missingTables,
      missingColumns,
    };
  } catch (err) {
    return { ok: false, missingTables: [], missingColumns: [], error: String(err) };
  }
}

/** One block in the log at startup, or nothing at all when the schema matches. */
export function reportSchemaDrift(drift: SchemaDrift): void {
  if (drift.ok) return;
  const lines = [
    "",
    "  ┌─ DATABASE SCHEMA IS BEHIND THIS BUILD ─────────────────────────",
  ];
  if (drift.error) lines.push(`  │ the check could not run: ${drift.error}`);
  for (const t of drift.missingTables) lines.push(`  │ missing table:  ${t}`);
  for (const c of drift.missingColumns) lines.push(`  │ missing column: ${c}`);
  lines.push(
    "  │",
    "  │ Queries touching these will fail at request time.",
    "  │ Apply with:  pnpm db:push   (against THIS deployment's POSTGRES_URL)",
    "  └────────────────────────────────────────────────────────────────",
    ""
  );
  console.error(lines.join("\n"));
}
