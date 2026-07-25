import "server-only";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

// Notion's workspace roles, ordered by privilege. A higher level implies every
// capability of the levels below it.
export type WorkspaceRole = "guest" | "member" | "admin" | "owner";
export const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  guest: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/** Roles a role of `actor` is allowed to assign to others (never above self,
 *  never `owner`). */
export function assignableRoles(actor: WorkspaceRole): WorkspaceRole[] {
  return (["guest", "member", "admin"] as WorkspaceRole[]).filter(
    (r) => ROLE_LEVEL[r] <= ROLE_LEVEL[actor]
  );
}

export async function getWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole | null> {
  const [m] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  if (!m) return null;
  // unknown/legacy role strings fall back to the least-privileged real role
  return (ROLE_LEVEL[m.role as WorkspaceRole] !== undefined
    ? (m.role as WorkspaceRole)
    : "guest") as WorkspaceRole;
}

export function hasRole(actual: WorkspaceRole | null, min: WorkspaceRole): boolean {
  return actual !== null && ROLE_LEVEL[actual] >= ROLE_LEVEL[min];
}

/** Guard for privileged workspace writes. Returns true (allowed) or a 403. */
export async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  min: WorkspaceRole
): Promise<true | NextResponse> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (!role)
    return NextResponse.json({ error: "Not a workspace member" }, { status: 403 });
  if (!hasRole(role, min))
    return NextResponse.json(
      { error: `Requires at least '${min}' role`, role },
      { status: 403 }
    );
  return true;
}
