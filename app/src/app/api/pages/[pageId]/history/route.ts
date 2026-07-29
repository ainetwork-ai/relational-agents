import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { pageSnapshots } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { pageHistoryAccess } from "@/lib/page-history";

export const dynamic = "force-dynamic";

/** GET → { snapshots: [{id,title,blockCount,createdAt}] } newest first. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  if (!(await pageHistoryAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      id: pageSnapshots.id,
      title: pageSnapshots.title,
      createdAt: pageSnapshots.createdAt,
      blockCount: sql<number>`jsonb_array_length(${pageSnapshots.blocks})`,
    })
    .from(pageSnapshots)
    .where(eq(pageSnapshots.pageId, pageId))
    .orderBy(desc(pageSnapshots.createdAt));
  return NextResponse.json({ snapshots: rows });
}
