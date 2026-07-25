import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { dbRows } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import {
  isOkfId,
  decodeId,
  writeDbCell,
  writeDbDeleteRow,
  writeDbMoveRow,
  okfDatabaseSnapshot,
  okfSerializeCell,
} from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** PATCH { values } → merges into the row's value map → { row }. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ databaseId: string; rowId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId, rowId } = await params;

  const body = await req.json().catch(() => ({}));
  const patch = (body?.values ?? {}) as Record<string, unknown>;

  // file-backed database: write each changed cell to the .csv. Values arrive
  // in editor shape (option ids, id arrays, {start,end} dates) — serialize via
  // the META-AWARE snapshot properties so authored option ids resolve to the
  // display names the CSV stores. Synthetic keys (e.g. __page) are skipped.
  if (isOkfId(databaseId)) {
    try {
      const rel = decodeId(databaseId);
      const snap = await okfDatabaseSnapshot(databaseId, rel);
      if (!snap) return NextResponse.json({ error: "Not found" }, { status: 404 });
      for (const [propId, value] of Object.entries(patch)) {
        if (!/^col\d+$/.test(propId)) continue;
        const prop = snap.properties.find((p) => p.id === propId);
        if (!prop) continue;
        writeDbCell(rel, rowId, propId, okfSerializeCell(prop, value));
      }
      // manual reorder: physical CSV order is the order (ids shift → client refetches)
      if (typeof body?.position === "number") writeDbMoveRow(rel, rowId, body.position);
      const now = new Date();
      return NextResponse.json({
        row: { id: rowId, databaseId, values: patch, position: 0, createdAt: now, updatedAt: now },
      });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Atomic jsonb merge at the SQL level. A read-modify-write here loses data
  // under concurrent PATCHes (assignee + due edited near-simultaneously each
  // read the same base and the later write clobbers the earlier) — caught by
  // the CAP1 project-tracker journey. `values || set - delKey` is one statement.
  const setKeys: Record<string, unknown> = {};
  const delKeys: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delKeys.push(k);
    else setKeys[k] = v;
  }

  let expr = sql`${dbRows.values} || ${JSON.stringify(setKeys)}::jsonb`;
  for (const k of delKeys) expr = sql`${expr} - ${k}`;

  const [row] = await db
    .update(dbRows)
    .set({
      values: expr,
      updatedAt: new Date(),
      updatedBy: auth.user.id,
      // manual reorder (drag a row handle): fractional position between neighbors
      ...(typeof body?.position === "number" ? { position: body.position } : {}),
    })
    .where(and(eq(dbRows.id, rowId), eq(dbRows.databaseId, databaseId)))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ databaseId: string; rowId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId, rowId } = await params;

  // file-backed database: splice the CSV row (row ids shift — client refetches)
  if (isOkfId(databaseId)) {
    try {
      writeDbDeleteRow(decodeId(databaseId), rowId);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .delete(dbRows)
    .where(and(eq(dbRows.id, rowId), eq(dbRows.databaseId, databaseId)));
  return NextResponse.json({ ok: true });
}
