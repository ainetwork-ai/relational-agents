import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aindriveLinks } from "@/lib/db/schema";
import { aindriveConfigured, aindrivePublicBase, aindriveServer, hasDrive, offeredDrives, parseLink } from "@/lib/aindrive";
import { getAccount, runAs } from "@/lib/aindrive-account";
import { userLink } from "@/lib/aindrive-user";

export const dynamic = "force-dynamic";

/**
 * The caller's aindrive: their connected account, their drives, and the folder
 * they linked from Home. Everything runs as the caller's own aindrive account
 * (lib/aindrive-account), so they only ever see and link their own drives.
 *
 * GET    → { configured, connected, account, base, link, drives }
 *          drives = the caller's own drives, each with whether it is online
 * PUT    { driveId, root? }   link (or re-link) a Home folder
 * DELETE                      unlink it
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  if (!aindriveConfigured())
    return NextResponse.json({ configured: false, connected: false, account: null, base: null, link: null, drives: [] });
  const account = await getAccount(auth.user.id);
  const base = aindrivePublicBase() ?? aindriveServer();
  if (!account)
    return NextResponse.json({ configured: true, connected: false, account: null, base, link: null, drives: [] });
  const link = await userLink(auth.user.id);
  // the picker is only needed before linking; an unreachable server must not
  // hide a folder that is already linked
  const drives = await runAs(auth.user.id, () => offeredDrives()).catch(() => []);
  return NextResponse.json({
    configured: true,
    connected: true,
    account: { email: account.email, name: account.name },
    base,
    link,
    drives,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  if (!aindriveConfigured())
    return NextResponse.json({ error: "aindrive is not configured on this server" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  let link;
  try {
    link = parseLink(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!link) return NextResponse.json({ error: "driveId required" }, { status: 400 });
  const mine = await runAs(auth.user.id, () => hasDrive(link.driveId)).catch((e: Error) => e);
  if (mine instanceof Error) return NextResponse.json({ error: mine.message }, { status: 401 });
  if (!mine) return NextResponse.json({ error: "That drive is not in your aindrive account" }, { status: 403 });
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
