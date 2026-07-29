import { db } from "@/lib/db";
import { workspaceMembers } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";

/** The caller's ACTIVE workspace: the session's active workspace when the user
 * is still a member of it, otherwise their first membership. This makes every
 * workspace-scoped route (pages, members, invite, …) follow the switcher. */
export async function getDefaultWorkspaceId(userId: string): Promise<string | null> {
  const session = await getSession();
  const active = session.activeWorkspaceId;
  if (active) {
    const [m] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, active)))
      .limit(1);
    if (m) return active;
  }
 // No pinned workspace → land on the one you own, not one you're guesting
 // in. Guest memberships (DM-partner invites) must never become the default.
  const [membership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(
      sql`case ${workspaceMembers.role} when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end`,
      workspaceMembers.joinedAt
    )
    .limit(1);
  return membership?.workspaceId ?? null;
}
