import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { familySummary } from "@/lib/family-folders";

export const dynamic = "force-dynamic";

/** GET → the family folders sheet: members and the folders each shares (with
 *  whether their phone is on), waiting invites, and where the backup goes. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ teamspaceId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const summary = await familySummary(auth.user.id, (await ctx.params).teamspaceId);
  if (!summary) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(summary);
}
