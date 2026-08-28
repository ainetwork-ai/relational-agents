import { db } from "@/lib/db";
import { teamspaces, workspaceMembers } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";

/** The teamspace every new workspace starts with. */
const GENERAL = "General";

/**
 * Give a fresh workspace its General teamspace.
 *
 * Without one the sidebar's Teamspaces section opens empty, which reads as a
 * broken section rather than an invitation — the first thing a new workspace
 * shows should be a place to put a page, not a blank list.
 *
 * Idempotent by name so it can be called from every workspace-creating path
 * (first sign-in, and the switcher's "create workspace") without a second one
 * appearing. Both callers own the workspace they just made, so there is no
 * permission check here.
 */
export async function ensureGeneralTeamspace(workspaceId: string, createdBy: string) {
  const [existing] = await db
    .select({ id: teamspaces.id })
    .from(teamspaces)
    .where(and(eq(teamspaces.workspaceId, workspaceId), eq(teamspaces.name, GENERAL)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(teamspaces)
    .values({ workspaceId, name: GENERAL, createdBy })
    .returning({ id: teamspaces.id });
  return created.id;
}

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
