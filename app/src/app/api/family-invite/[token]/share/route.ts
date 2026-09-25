import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { inviteByToken, shareFolders } from "@/lib/family-folders";

export const dynamic = "force-dynamic";

/** POST { folders: [{ driveId, root }] } → shares them into the invite's
 *  teamspace (ownership is checked with aindrive, as the person). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const found = await inviteByToken((await ctx.params).token);
  if (!found || found.invite.acceptedBy !== auth.user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { folders?: unknown };
  const folders = Array.isArray(body.folders)
    ? body.folders.filter(
        (f): f is { driveId: string; root: string } => !!f && typeof f === "object" && typeof (f as { driveId?: unknown }).driveId === "string" && typeof (f as { root?: unknown }).root === "string"
      )
    : [];
  if (!folders.length) return NextResponse.json({ error: "folders required" }, { status: 400 });
  return NextResponse.json(await shareFolders(auth.user.id, found.invite.teamspaceId, folders));
}
