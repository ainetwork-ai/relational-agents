import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { teamspaceDrives, users } from "@/lib/db/schema";
import { aindriveConfigured } from "@/lib/aindrive";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";
import { ShareError, shareFolder } from "@/lib/aindrive-share";

export const dynamic = "force-dynamic";

/**
 * The aindrive folders linked into a teamspace — each member may link their own.
 * GET  → { drives: [{ id, name, driveId, root, backup, linkedBy, lastBackupAt, lastBackupError }] }
 * POST { name?, driveId, root? } → link one of the caller's own folders. The
 *      teamspace's first link also receives its OKF backup, which starts now.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ teamspaceId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { teamspaceId } = await ctx.params;
  if (!(await visibleTeamspace(auth.user.id, teamspaceId)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const drives = await db
    .select({
      id: teamspaceDrives.id,
      name: teamspaceDrives.name,
      driveId: teamspaceDrives.driveId,
      root: teamspaceDrives.root,
      lastBackupAt: teamspaceDrives.lastBackupAt,
      lastBackupError: teamspaceDrives.lastBackupError,
      backup: teamspaceDrives.backup,
      linkedBy: users.displayName,
    })
    .from(teamspaceDrives)
    .leftJoin(users, eq(users.id, teamspaceDrives.createdBy))
    .where(eq(teamspaceDrives.teamspaceId, teamspaceId))
    .orderBy(asc(teamspaceDrives.createdAt));
  return NextResponse.json({ drives });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ teamspaceId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { teamspaceId } = await ctx.params;
  if (!aindriveConfigured())
    return NextResponse.json({ error: "aindrive is not configured on this server" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const drive = await shareFolder(auth.user.id, teamspaceId, body);
    return NextResponse.json({ drive }, { status: 201 });
  } catch (e) {
    if (e instanceof ShareError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
