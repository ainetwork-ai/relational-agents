import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages } from "@/lib/db/schema";
import { loadDatabaseForUser } from "@/lib/db-access";

export const dynamic = "force-dynamic";

/** POST → spawn a page whose entire body IS this database, rendered full-width
 *. The page holds a single database block flagged
 * fullPage. Returns { pageId }. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;

  const database = await loadDatabaseForUser(databaseId, auth.user.id);
  if (!database) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [page] = await db
    .insert(pages)
    .values({
      workspaceId: database.workspaceId,
      title: database.title,
      parentPageId: null,
      position: Date.now(),
      createdBy: auth.user.id,
    })
    .returning();

  await db.insert(blocks).values({
    pageId: page.id,
    type: "database",
    content: { databaseId, fullPage: true },
    position: 1,
  });

  return NextResponse.json({ pageId: page.id }, { status: 201 });
}
