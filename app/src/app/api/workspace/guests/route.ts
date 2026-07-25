import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import {
  pageInvites,
  pageMembers,
  pages,
  users,
  workspaceMembers,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { toPublicUser } from "@/lib/auth/public-user";

export const dynamic = "force-dynamic";

/** GET → every page-level access grant in my workspace (Notion Settings →
 *  People → Guests): members with per-page access + pending email invites. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, auth.user.id))
    .limit(1);
  if (!membership) return NextResponse.json({ grants: [], invites: [] });
  const wsId = membership.workspaceId;

  const grants = (
    await db
      .select({
        pageId: pageMembers.pageId,
        permission: pageMembers.permission,
        title: pages.title,
        user: users,
      })
      .from(pageMembers)
      .innerJoin(pages, eq(pageMembers.pageId, pages.id))
      .innerJoin(users, eq(pageMembers.userId, users.id))
      .where(eq(pages.workspaceId, wsId))
  ).map((g) => ({
    pageId: g.pageId,
    permission: g.permission,
    title: g.title,
    user: toPublicUser(g.user),
  }));

  const invites = await db
    .select({
      pageId: pageInvites.pageId,
      permission: pageInvites.permission,
      email: pageInvites.email,
      title: pages.title,
    })
    .from(pageInvites)
    .innerJoin(pages, eq(pageInvites.pageId, pages.id))
    .where(eq(pages.workspaceId, wsId));

  return NextResponse.json({ grants, invites });
}
