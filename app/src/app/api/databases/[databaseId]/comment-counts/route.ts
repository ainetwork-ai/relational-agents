import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { comments, dbRows } from "@/lib/db/schema";
import { count, eq, inArray } from "drizzle-orm";
import { loadDatabaseForUser } from "@/lib/db-access";
import { isOkfId } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/**
 * GET → { counts: { [pageId]: n } } for every row of this database that has
 * comments. Feeds the table's title-cell badge, which the original shows on a
 * commented row (e2e/fixtures/notion-row-comments.json).
 *
 * One query for the whole table: the badge is per row, but 20 round-trips to
 * paint one column is not worth it, and the count is cheap to group.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { databaseId } = await params;

 // file-backed databases have no SQL rows, so no page ids to count against
  if (isOkfId(databaseId)) return NextResponse.json({ counts: {} });
  if (!(await loadDatabaseForUser(databaseId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({ values: dbRows.values })
    .from(dbRows)
    .where(eq(dbRows.databaseId, databaseId));

 // a row's page lives in the reserved __page value (see row-peek)
  const pageIds = [
    ...new Set(
      rows
        .map((r) => r.values?.["__page"])
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    ),
  ];
  if (!pageIds.length) return NextResponse.json({ counts: {} });

  const grouped = await db
    .select({ pageId: comments.pageId, n: count() })
    .from(comments)
    .where(inArray(comments.pageId, pageIds))
    .groupBy(comments.pageId);

  const counts: Record<string, number> = {};
  for (const g of grouped) if (g.n > 0) counts[g.pageId] = Number(g.n);
  return NextResponse.json({ counts });
}
