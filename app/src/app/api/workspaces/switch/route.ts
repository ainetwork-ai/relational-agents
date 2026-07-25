import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** POST { workspaceId } → set the session's active workspace (membership-gated). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const [membership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, auth.user.id)
      )
    )
    .limit(1);
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  const session = await getSession();
  session.activeWorkspaceId = workspaceId;
  await session.save();

  return NextResponse.json({ ok: true, activeId: workspaceId });
}
