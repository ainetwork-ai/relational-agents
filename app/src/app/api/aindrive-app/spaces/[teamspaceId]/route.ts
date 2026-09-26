import { NextRequest, NextResponse } from "next/server";
import { setShared, userOfAppKey } from "@/lib/aindrive-app";
import { ShareError } from "@/lib/aindrive-share";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";

export const dynamic = "force-dynamic";

/** PUT { driveId, path, shared } — aindrive's share sheet turning a folder on or off in a space. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ teamspaceId: string }> }) {
  const userId = userOfAppKey(req.headers.get("authorization"));
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { teamspaceId } = await ctx.params;
  if (!(await visibleTeamspace(userId, teamspaceId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { driveId?: unknown; path?: unknown; shared?: unknown };
  if (typeof body.driveId !== "string" || !body.driveId || typeof body.shared !== "boolean")
    return NextResponse.json({ error: "driveId and shared required" }, { status: 400 });
  try {
    await setShared(userId, teamspaceId, body.driveId, typeof body.path === "string" ? body.path : "", body.shared);
  } catch (e) {
    if (e instanceof ShareError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ ok: true, shared: body.shared });
}
