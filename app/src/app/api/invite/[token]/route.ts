import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { inviteTokens, workspaceMembers, workspaces } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function validInvite(token: string) {
  const [row] = await db
    .select({
      workspaceId: inviteTokens.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(inviteTokens)
    .innerJoin(workspaces, eq(inviteTokens.workspaceId, workspaces.id))
    .where(and(eq(inviteTokens.token, token), gt(inviteTokens.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** GET → { workspaceName } if the invite is valid+unexpired, else 404. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const invite = await validInvite(token);
  if (!invite) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ workspaceName: invite.workspaceName });
}

/** POST → join the workspace for this invite (idempotent). Requires auth. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { token } = await params;

  const invite = await validInvite(token);
  if (!invite) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .insert(workspaceMembers)
    .values({ workspaceId: invite.workspaceId, userId: auth.user.id, role: "member" })
    .onConflictDoNothing();

 // switch to that workspace on accept — avoids joining yet staying in your own workspace
  const session = await getSession();
  session.activeWorkspaceId = invite.workspaceId;
  await session.save();

  return NextResponse.json({ ok: true, workspaceId: invite.workspaceId });
}
