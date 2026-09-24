import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { runAs } from "@/lib/aindrive-account";
import { treeResponse } from "@/lib/aindrive-http";

export const dynamic = "force-dynamic";

/** GET → { link, entries } — a whole drive of the caller's own aindrive
 *  account (the sidebar's aindrive section), read as them. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ driveId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { driveId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(driveId)) return NextResponse.json({ error: "bad drive id" }, { status: 400 });
  return runAs(auth.user.id, () => treeResponse({ driveId, root: "" })).catch(
    (e: Error) => NextResponse.json({ error: e.message }, { status: 401 })
  );
}
