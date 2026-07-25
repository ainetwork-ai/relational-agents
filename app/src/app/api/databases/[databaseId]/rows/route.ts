import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { dbRows } from "@/lib/db/schema";
import { eq, max } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import {
  isOkfId,
  decodeId,
  writeDbAddRow,
  writeDbCell,
  okfDatabaseSnapshot,
  okfSerializeCell,
} from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** POST → append an empty row { values? } → { row }. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;

  const body = await req.json().catch(() => ({}));

  // file-backed database: append a row to the .csv (+ any seed values, e.g. a
  // board column's group value)
  if (isOkfId(databaseId)) {
    try {
      const rel = decodeId(databaseId);
      const rid = writeDbAddRow(rel);
      const values = (body?.values ?? {}) as Record<string, unknown>;
      if (Object.keys(values).length) {
        const snap = await okfDatabaseSnapshot(databaseId, rel);
        for (const [propId, value] of Object.entries(values)) {
          if (!/^col\d+$/.test(propId)) continue;
          const prop = snap?.properties.find((p) => p.id === propId);
          if (!prop) continue;
          writeDbCell(rel, rid, propId, okfSerializeCell(prop, value));
        }
      }
      const now = new Date();
      return NextResponse.json(
        { row: { id: rid, databaseId, values, position: 0, createdAt: now, updatedAt: now } },
        { status: 201 }
      );
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [{ maxPos }] = await db
    .select({ maxPos: max(dbRows.position) })
    .from(dbRows)
    .where(eq(dbRows.databaseId, databaseId));

  const [row] = await db
    .insert(dbRows)
    .values({
      databaseId,
      values: body?.values ?? {},
      position: (maxPos ?? 0) + 1,
      parentRowId: typeof body?.parentRowId === "string" ? body.parentRowId : null,
      createdBy: auth.user.id,
      updatedBy: auth.user.id,
    })
    .returning();

  return NextResponse.json({ row }, { status: 201 });
}
