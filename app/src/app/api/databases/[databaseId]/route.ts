import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { databases, dbProperties, dbRows, dbViews } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import { isOkfId, decodeId, okfDatabaseSnapshot, readDbMeta, writeDbMeta } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** GET → full { database, properties, rows, views } snapshot. The SAME contract
 * the single database view consumes; a .csv-file-backed (OKF) database is
 * served here too — files are the backend, one view renders both.
 *
 * `?meta=1` answers with { database } alone: the page header needs the title
 * and description, and dragging every row along for that would make opening a
 * database page pay for its content twice. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;
  const metaOnly = new URL(_req.url).searchParams.get("meta") === "1";

  if (isOkfId(databaseId)) {
    const snap = await okfDatabaseSnapshot(databaseId, decodeId(databaseId));
    if (!snap) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(metaOnly ? { database: snap.database } : snap);
  }

  const database = await loadDatabaseForUser(databaseId, auth.user.id);
  if (!database) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (metaOnly) return NextResponse.json({ database });

  const [properties, rows, views] = await Promise.all([
    db.select().from(dbProperties).where(eq(dbProperties.databaseId, databaseId)).orderBy(dbProperties.position),
    db.select().from(dbRows).where(eq(dbRows.databaseId, databaseId)).orderBy(dbRows.position),
    db.select().from(dbViews).where(eq(dbViews.databaseId, databaseId)).orderBy(dbViews.position),
  ]);

  return NextResponse.json({ database, properties, rows, views });
}

/** PATCH { title?, description?, descriptionVisible? } → database metadata. */
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
      const wantsDesc = typeof body?.description === "string";
      const wantsVisible = typeof body?.descriptionVisible === "boolean";
      if (wantsDesc || wantsVisible) {
        const rel = decodeId(databaseId);
        const meta = await readDbMeta(rel);
        if (wantsDesc) meta.description = body.description;
        if (wantsVisible) meta.descriptionVisible = body.descriptionVisible;
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
  if (typeof body?.descriptionVisible === "boolean")
    update.descriptionVisible = body.descriptionVisible;
  if (Object.keys(update).length === 0) return NextResponse.json({ database });
  update.updatedAt = new Date();
  const [row] = await db
    .update(databases)
    .set(update)
    .where(eq(databases.id, databaseId))
    .returning();
  return NextResponse.json({ database: row });
}
