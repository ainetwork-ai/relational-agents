import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { users, workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { toPublicUser } from "@/lib/auth/public-user";
import {
  requireWorkspaceRole,
  getWorkspaceRole,
  ROLE_LEVEL,
  type WorkspaceRole,
} from "@/lib/auth/workspace-role";

export const dynamic = "force-dynamic";

const ASSIGNABLE: WorkspaceRole[] = ["guest", "member", "admin"];

/** GET → members of the caller's workspace with their roles. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ members: [] });

  const rows = await db
    .select({ user: users, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  return NextResponse.json({
    members: rows.map((r) => ({ ...toPublicUser(r.user), role: r.role })),
  });
}

/** PATCH { userId, role } → change a member's role (admin+). The owner's role
 *  is immutable and nobody may be promoted to owner via this endpoint; an admin
 *  cannot assign a role above their own. */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const actorRole = await getWorkspaceRole(workspaceId, auth.user.id);
  const gate = await requireWorkspaceRole(workspaceId, auth.user.id, "admin");
  if (gate !== true) return gate;

  const body = await req.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId : null;
  const role = body?.role as WorkspaceRole;
  if (!userId || !ASSIGNABLE.includes(role))
    return NextResponse.json(
      { error: "userId and role (guest|member|admin) required" },
      { status: 400 }
    );
  // an admin cannot grant a role above their own level
  if (actorRole && ROLE_LEVEL[role] > ROLE_LEVEL[actorRole])
    return NextResponse.json({ error: "Cannot assign a role above your own" }, { status: 403 });

  const target = await getWorkspaceRole(workspaceId, userId);
  if (!target) return NextResponse.json({ error: "Not a member" }, { status: 404 });
  if (target === "owner")
    return NextResponse.json({ error: "The owner's role cannot be changed" }, { status: 403 });

  await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    );
  return NextResponse.json({ member: { userId, role } });
}

/** DELETE ?userId= → remove a member from the workspace (admin+). The owner
 *  cannot be removed. */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const gate = await requireWorkspaceRole(workspaceId, auth.user.id, "admin");
  if (gate !== true) return gate;

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const target = await getWorkspaceRole(workspaceId, userId);
  if (target === "owner")
    return NextResponse.json({ error: "The owner cannot be removed" }, { status: 403 });

  await db
    .delete(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    );
  return NextResponse.json({ ok: true });
}
