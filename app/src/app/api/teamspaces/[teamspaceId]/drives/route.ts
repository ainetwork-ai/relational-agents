import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { teamspaceDrives } from "@/lib/db/schema";
import { aindriveConfigured, linkFromConfig } from "@/lib/aindrive";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";
import { runBackup } from "@/lib/aindrive-backup";

export const dynamic = "force-dynamic";

/**
 * The aindrive folder a teamspace is linked to (at most one).
 * GET  → { drives: [{ id, name, driveId, root }] }
 * POST { name?, driveId, root? } → link one (anyone who can see the teamspace,
 *      as with adding a page there) and start the first OKF backup into it
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ teamspaceId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { teamspaceId } = await ctx.params;
  if (!(await visibleTeamspace(auth.user.id, teamspaceId)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const drives = await db
    .select({ id: teamspaceDrives.id, name: teamspaceDrives.name, driveId: teamspaceDrives.driveId, root: teamspaceDrives.root })
    .from(teamspaceDrives)
    .where(eq(teamspaceDrives.teamspaceId, teamspaceId))
    .orderBy(asc(teamspaceDrives.createdAt));
  return NextResponse.json({ drives });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ teamspaceId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { teamspaceId } = await ctx.params;
  if (!(await visibleTeamspace(auth.user.id, teamspaceId)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!aindriveConfigured())
    return NextResponse.json({ error: "aindrive is not configured on this server" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  let link;
  try {
    link = linkFromConfig(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!link) return NextResponse.json({ error: "driveId required" }, { status: 400 });
  const [already] = await db
    .select({ id: teamspaceDrives.id })
    .from(teamspaceDrives)
    .where(eq(teamspaceDrives.teamspaceId, teamspaceId));
  if (already)
    return NextResponse.json({ error: "This teamspace is already linked to an aindrive folder" }, { status: 409 });
  const given = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  // unnamed → the folder's own name, which is what the sidebar would show anyway
  const name = given || link.root.split("/").pop() || "aindrive";
  const [drive] = await db
    .insert(teamspaceDrives)
    .values({ teamspaceId, name, driveId: link.driveId, root: link.root, createdBy: auth.user.id })
    .returning();
  // the first backup can take a while on a big teamspace — the page shows its
  // progress through the drive's backup status rather than holding this open
  void runBackup(teamspaceId).catch((err) => console.error("[aindrive-backup] first run:", err));
  return NextResponse.json({ drive }, { status: 201 });
}
