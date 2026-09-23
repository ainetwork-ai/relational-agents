import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aindriveLinks } from "@/lib/db/schema";
import { aindriveConfigured, linkFromConfig, offeredDrives } from "@/lib/aindrive";
import { userLink } from "@/lib/aindrive-user";

export const dynamic = "force-dynamic";

/**
 * The caller's Home aindrive link.
 *
 * GET    → { configured, link, drives }  drives = what may be linked here
 * PUT    { driveId, root? }              link (or re-link) a folder
 * DELETE                                 unlink
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  if (!aindriveConfigured()) return NextResponse.json({ configured: false, link: null, drives: [] });
  const link = await userLink(auth.user.id);
 // the picker is only needed before linking; an offline server must not
 // hide a folder that is already linked
  const drives = await offeredDrives().catch(() => []);
  return NextResponse.json({ configured: true, link, drives });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
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
  await db
    .insert(aindriveLinks)
    .values({ userId: auth.user.id, driveId: link.driveId, root: link.root })
    .onConflictDoUpdate({
      target: aindriveLinks.userId,
      set: { driveId: link.driveId, root: link.root, updatedAt: new Date() },
    });
  return NextResponse.json({ link });
}

export async function DELETE() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  await db.delete(aindriveLinks).where(eq(aindriveLinks.userId, auth.user.id));
  return NextResponse.json({ ok: true });
}
