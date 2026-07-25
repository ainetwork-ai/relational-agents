import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { databases, dbProperties, dbRows, dbViews } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import { isOkfId, decodeId, okfDatabaseSnapshot, readDbMeta, writeDbMeta } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** GET → full { database, properties, rows, views } snapshot. The SAME contract
 *  the single database view consumes; a .csv-file-backed (OKF) database is
 *  served here too — files are the backend, one view renders both. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;

  if (isOkfId(databaseId)) {
    const snap = await okfDatabaseSnapshot(databaseId, decodeId(databaseId));
    if (!snap) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(snap);
  }

  const database = await loadDatabaseForUser(databaseId, auth.user.id);
  if (!database) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [properties, rows, views] = await Promise.all([
    db.select().from(dbProperties).where(eq(dbProperties.databaseId, databaseId)).orderBy(dbProperties.position),
    db.select().from(dbRows).where(eq(dbRows.databaseId, databaseId)).orderBy(dbRows.position),
    db.select().from(dbViews).where(eq(dbViews.databaseId, databaseId)).orderBy(dbViews.position),
  ]);

  return NextResponse.json({ database, properties, rows, views });
}

/** PATCH { title?, description? } → updates database metadata. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;
  const body = await req.json().catch(() => ({}));

  // file-backed database: description lives in the schema overlay (the title
  // is the file name — renaming files is a separate op)
  if (isOkfId(databaseId)) {
    try {
      if (typeof body?.description === "string") {
        const rel = decodeId(databaseId);
        const meta = await readDbMeta(rel);
        meta.description = body.description;
        await writeDbMeta(rel, meta);
      }
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  const database = await loadDatabaseForUser(databaseId, auth.user.id);
  if (!database) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (typeof body?.title === "string") update.title = body.title;
  if (typeof body?.description === "string") update.description = body.description;
  if (Object.keys(update).length === 0) return NextResponse.json({ database });
  update.updatedAt = new Date();
  const [row] = await db
    .update(databases)
    .set(update)
    .where(eq(databases.id, databaseId))
    .returning();
  return NextResponse.json({ database: row });
}
