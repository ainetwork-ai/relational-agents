import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createInvite } from "@/lib/family-folders";
import { ShareError } from "@/lib/aindrive-share";

export const dynamic = "force-dynamic";

/** POST { name } → { invite, url } — a link to send a family member: they
 *  approve once with aindrive and pick what their phone shares here. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ teamspaceId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  try {
    const invite = await createInvite(auth.user.id, (await ctx.params).teamspaceId, typeof body.name === "string" ? body.name : "");
    return NextResponse.json({ invite: { id: invite.id, name: invite.name, token: invite.token }, url: `${req.nextUrl.origin}/family/${invite.token}` }, { status: 201 });
  } catch (e) {
    if (e instanceof ShareError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
