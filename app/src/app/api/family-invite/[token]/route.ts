import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { requireAuth } from "@/lib/auth/middleware";
import { acceptInvite, inviteByToken } from "@/lib/family-folders";
import { ShareError } from "@/lib/aindrive-share";

export const dynamic = "force-dynamic";

/** GET → who invited whom, into what (public: the link is the invite). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const found = await inviteByToken((await ctx.params).token);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    name: found.invite.name,
    inviter: found.inviterName,
    teamspace: { name: found.teamspaceName, icon: found.teamspaceIcon },
    workspace: found.workspaceName,
    accepted: !!found.invite.acceptedBy,
  });
}

/** POST → the signed-in person joins (workspace + teamspace), lands there. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  try {
    const invite = await acceptInvite(auth.user.id, (await ctx.params).token);
    const session = await getSession();
    session.activeWorkspaceId = invite.workspaceId;
    await session.save();
    return NextResponse.json({ ok: true, workspaceId: invite.workspaceId, teamspaceId: invite.teamspaceId });
  } catch (e) {
    if (e instanceof ShareError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
