import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";
import { runAsOrService } from "@/lib/aindrive-account";
import { treeResponse } from "@/lib/aindrive-http";

export const dynamic = "force-dynamic";

/** GET → { link, entries } — every file and folder in a teamspace drive. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const found = await teamspaceDrive(auth.user.id, (await ctx.params).id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!found.link) return NextResponse.json({ error: "This folder is no longer offered on this server" }, { status: 409 });
  const link = found.link;
  return runAsOrService(found.drive.createdBy, () => treeResponse(link)).catch(
    (e: Error) => NextResponse.json({ error: e.message }, { status: 401 })
  );
}
