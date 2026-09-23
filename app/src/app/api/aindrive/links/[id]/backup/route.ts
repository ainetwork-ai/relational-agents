import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";
import { runBackup } from "@/lib/aindrive-backup";

export const dynamic = "force-dynamic";

/** POST → back the teamspace up to its aindrive folder now; { files, written, error? } */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const found = await teamspaceDrive(auth.user.id, (await ctx.params).id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await runBackup(found.drive.teamspaceId);
  return NextResponse.json(r, { status: r.error ? 502 : 200 });
}
