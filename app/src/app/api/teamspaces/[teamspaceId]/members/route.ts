import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { teamspaces, teamspaceMembers, users, workspaceMembers } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** The teamspace, but only if the caller's active workspace owns it. */
async function reachable(teamspaceId: string, userId: string) {
  const workspaceId = await getDefaultWorkspaceId(userId);
  if (!workspaceId) return null;
  const [row] = await db
    .select()
    .from(teamspaces)
    .where(and(eq(teamspaces.id, teamspaceId), eq(teamspaces.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** GET → members of this teamspace. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ teamspaceId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { teamspaceId } = await params;
  if (!(await reachable(teamspaceId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      userId: teamspaceMembers.userId,
      role: teamspaceMembers.role,
      displayName: users.displayName,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(teamspaceMembers)
    .innerJoin(users, eq(users.id, teamspaceMembers.userId))
    .where(eq(teamspaceMembers.teamspaceId, teamspaceId))
    .orderBy(teamspaceMembers.joinedAt);

  return NextResponse.json({ members: rows });
}

/**
 * POST { userIds: string[], role? } → invite workspace members into the
 * teamspace. This is what step 2 of the create flow submits.
 *
 * Only people already in the workspace can be added: a teamspace is a grouping
 * inside a workspace, so inviting an outsider here would create a member who
 * cannot see the workspace the pages live in. Inviting someone from outside is
 * the workspace invite's job (/api/workspace/invite).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamspaceId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { teamspaceId } = await params;
  const teamspace = await reachable(teamspaceId, auth.user.id);
  if (!teamspace) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const userIds: string[] = Array.isArray(body.userIds)
    ? body.userIds.filter((v: unknown): v is string => typeof v === "string").slice(0, 100)
    : [];
  if (!userIds.length) return NextResponse.json({ error: "userIds required" }, { status: 400 });
  const role = body.role === "owner" ? "owner" : "member";

  const inWorkspace = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, teamspace.workspaceId),
        inArray(workspaceMembers.userId, userIds)
      )
    );
  const allowed = inWorkspace.map((r) => r.userId);
  if (!allowed.length)
    return NextResponse.json({ error: "No invitee is in this workspace" }, { status: 400 });

  await db
    .insert(teamspaceMembers)
    .values(allowed.map((userId) => ({ teamspaceId, userId, role })))
    .onConflictDoNothing();

  // Report what was skipped rather than pretending everything landed.
  const skipped = userIds.filter((id) => !allowed.includes(id));
  return NextResponse.json({ added: allowed.length, skipped }, { status: 201 });
}
