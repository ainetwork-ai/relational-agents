import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, teamspaceDrives } from "@/lib/db/schema";

/**
 * The drive whose Willow store records a teamspace's signed edits
 * (docs/willow-ainmem-plan.md Task 6): the first drive linked to it. A
 * teamspace can link several folders; one record keeps a page's history in one
 * place. `createdBy` is the account that linked it — ainmem hands entries to
 * aindrive as that account, which vouches for the teamspace's members.
 */
export async function recordDriveOf(teamspaceId: string): Promise<{ driveId: string; createdBy: string | null } | null> {
  const [row] = await db
    .select({ driveId: teamspaceDrives.driveId, createdBy: teamspaceDrives.createdBy })
    .from(teamspaceDrives)
    .where(eq(teamspaceDrives.teamspaceId, teamspaceId))
    .orderBy(asc(teamspaceDrives.createdAt))
    .limit(1);
  return row ?? null;
}

/** The page's teamspace and its record drive, when the page's edits are signed. */
export async function signingOf(pageId: string): Promise<{ teamspaceId: string; driveId: string; createdBy: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) return null;
  const [page] = await db.select({ teamspaceId: pages.teamspaceId }).from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page?.teamspaceId) return null;
  const drive = await recordDriveOf(page.teamspaceId);
  return drive ? { teamspaceId: page.teamspaceId, ...drive } : null;
}
