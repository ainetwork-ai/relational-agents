import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { dbRows } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { isOkfId, decodeId, okfRowRefForPage } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** GET → { ref: { databaseId, rowId } | null } — is this page a database
 * row's page? The full-page view uses it to render editable row properties
 * above the body. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;

  if (isOkfId(pageId)) {
    try {
      const ref = await okfRowRefForPage(decodeId(pageId));
      return NextResponse.json({ ref });
    } catch {
      return NextResponse.json({ ref: null });
    }
  }

  const [row] = await db
    .select({ id: dbRows.id, databaseId: dbRows.databaseId })
    .from(dbRows)
    .where(sql`${dbRows.values}->>'__page' = ${pageId}`)
    .limit(1);
  return NextResponse.json({ ref: row ? { databaseId: row.databaseId, rowId: row.id } : null });
}
