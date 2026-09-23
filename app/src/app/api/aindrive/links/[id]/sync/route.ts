import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { teamspaceDrive } from "@/lib/aindrive-teamspace";
import { backupFolder, teamspaceOkf } from "@/lib/aindrive-backup";

export const dynamic = "force-dynamic";

export type SyncStatus = "synced" | "pending" | "failed" | "excluded";

/**
 * GET → where each of the teamspace's pages stands against its aindrive backup:
 * { folder, pages: [{ id, title, icon, parentId, path, status }] }
 *   synced   — the backup holds its latest edit
 *   pending  — edited after the last backup (the next run picks it up)
 *   failed   — the last backup failed before this page was safely written
 *   excluded — never backed up (participant-only page); path is null
 * `path` is relative to the linked folder, so it opens in the same browser.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const found = await teamspaceDrive(auth.user.id, (await ctx.params).id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { drive } = found;
  const folder = backupFolder({ id: drive.teamspaceId, name: found.teamspaceName });
  const okf = await teamspaceOkf(drive.teamspaceId);
  const last = drive.lastBackupAt ? new Date(drive.lastBackupAt).getTime() : null;

  const pages = okf.pages.map((p) => {
    const edited = okf.lastEdited.get(p.id)?.getTime() ?? 0;
    const fresh = last !== null && edited <= last;
    const status: SyncStatus = fresh ? "synced" : drive.lastBackupError ? "failed" : "pending";
    const file = okf.pageFiles.get(p.id);
    return {
      id: p.id,
      title: p.title,
      icon: p.icon,
      parentId: p.parentPageId,
      path: file ? `${folder}/${file}` : null,
      status,
    };
  });
  const excluded = okf.excluded.map(({ page }) => ({
    id: page.id,
    title: page.title,
    icon: page.icon,
    parentId: null,
    path: null,
    status: "excluded" as SyncStatus,
  }));
  return NextResponse.json({ folder, pages: [...pages, ...excluded] });
}
