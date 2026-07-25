import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { pageInvites, pageMembers, pages } from "@/lib/db/schema";
import { and, eq, exists, or, sql } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** GET → pages that are SHARED (have page members or pending invites) in the
 *  user's workspace — the sidebar "Shared" section. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ pages: [] });

  const rows = await db
    .select({ id: pages.id, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        eq(pages.isArchived, false),
        or(
          exists(
            db.select({ one: sql`1` }).from(pageMembers).where(eq(pageMembers.pageId, pages.id))
          ),
          exists(
            db.select({ one: sql`1` }).from(pageInvites).where(eq(pageInvites.pageId, pages.id))
          )
        )
      )
    )
    .orderBy(sql`${pages.updatedAt} desc`)
    .limit(20);

  return NextResponse.json({ pages: rows });
}
