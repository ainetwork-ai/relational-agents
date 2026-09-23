import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamspaceDrives, teamspaceMembers, teamspaces, workspaceMembers, type TeamspaceDrive } from "@/lib/db/schema";
import { linkFromConfig, type AindriveLink } from "@/lib/aindrive";

/** The teamspace, if this person can see it: a member of its workspace, and for
 *  a private teamspace a member of the teamspace too — the same people the
 *  sidebar shows it to. */
export async function visibleTeamspace(userId: string, teamspaceId: string) {
  const [ts] = await db.select().from(teamspaces).where(eq(teamspaces.id, teamspaceId));
  if (!ts) return null;
  const [inWs] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, ts.workspaceId), eq(workspaceMembers.userId, userId)));
  if (!inWs) return null;
  if (ts.visibility === "private") {
    const [inTs] = await db
      .select({ userId: teamspaceMembers.userId })
      .from(teamspaceMembers)
      .where(and(eq(teamspaceMembers.teamspaceId, ts.id), eq(teamspaceMembers.userId, userId)));
    if (!inTs) return null;
  }
  return ts;
}

/** A teamspace drive this person can open, with its usable link. `link` is
 *  null when the deployment no longer offers that folder. */
export async function teamspaceDrive(
  userId: string,
  id: string
): Promise<{ drive: TeamspaceDrive; teamspaceName: string; link: AindriveLink | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [drive] = await db.select().from(teamspaceDrives).where(eq(teamspaceDrives.id, id));
  if (!drive) return null;
  const ts = await visibleTeamspace(userId, drive.teamspaceId);
  if (!ts) return null;
  let link: AindriveLink | null = null;
  try {
    link = linkFromConfig({ driveId: drive.driveId, root: drive.root });
  } catch {
    link = null;
  }
  return { drive, teamspaceName: ts.name, link };
}
