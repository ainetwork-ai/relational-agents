import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages, dbViews } from "@/lib/db/schema";
import { eq, max } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";

export const dynamic = "force-dynamic";

/** POST → embed THIS database in a new page as a LINKED view. Creates a fresh
 * embedded view (its own filters/sorts/hidden, flagged so it never shows in the
 * source database's own tab bar) plus a page holding a linked database block.
 * The source database's existing views are never mutated. Returns
 * { pageId, viewId }. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;

  const database = await loadDatabaseForUser(databaseId, auth.user.id);
  if (!database) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ maxPos }] = await db
    .select({ maxPos: max(dbViews.position) })
    .from(dbViews)
    .where(eq(dbViews.databaseId, databaseId));

  const [view] = await db
    .insert(dbViews)
    .values({
      databaseId,
      name: "Linked view",
      type: "table",
      config: { embedded: true },
      position: (maxPos ?? 0) + 1,
    })
    .returning();

  const [page] = await db
    .insert(pages)
    .values({
      workspaceId: database.workspaceId,
      title: `${database.title} (linked)`,
      parentPageId: null,
      position: Date.now(),
      createdBy: auth.user.id,
    })
    .returning();

  await db.insert(blocks).values({
    pageId: page.id,
    type: "database",
    content: { databaseId, linkedViewId: view.id },
    position: 1,
  });

  return NextResponse.json({ pageId: page.id, viewId: view.id }, { status: 201 });
}
