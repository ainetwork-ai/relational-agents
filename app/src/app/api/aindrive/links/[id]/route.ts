import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { teamspaceDrives } from "@/lib/db/schema";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";
import { backupFolder } from "@/lib/aindrive-backup";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One teamspace aindrive folder.
 * GET → { drive, teamspaceName, backupFolder, available }  available=false when the server no longer offers it
 * PATCH { name } → rename
 * DELETE → unlink the teamspace (backups stop; the files on the drive are untouched)
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const found = await teamspaceDrive(auth.user.id, (await ctx.params).id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    drive: found.drive,
    teamspaceName: found.teamspaceName,
    backupFolder: backupFolder({ id: found.drive.teamspaceId, name: found.teamspaceName }),
    available: !!found.link,
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const found = await teamspaceDrive(auth.user.id, (await ctx.params).id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const [drive] = await db.update(teamspaceDrives).set({ name }).where(eq(teamspaceDrives.id, found.drive.id)).returning();
  return NextResponse.json({ drive });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const found = await teamspaceDrive(auth.user.id, (await ctx.params).id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(teamspaceDrives).where(eq(teamspaceDrives.id, found.drive.id));
  return NextResponse.json({ ok: true });
}
