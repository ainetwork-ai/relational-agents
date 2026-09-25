import "server-only";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamspaceDrives, teamspaceMembers, teamspaces, users, workspaceMembers, workspaces, type TeamspaceDrive } from "@/lib/db/schema";
import { hasDrive, parseLink, type AindriveLink } from "@/lib/aindrive";
import { runAs } from "@/lib/aindrive-account";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";
import { runBackup } from "@/lib/aindrive-backup";

/**
 * Sharing aindrive folders inside a teamspace.
 *
 * A person shares one of their own drives by linking it into a teamspace:
 * everyone who can see the teamspace can then open it, read as the person who
 * linked it (runAsOrService with the link's createdBy). Whether the drive is
 * really theirs is asked of aindrive itself, over MCP, as them — a drive id
 * typed in by hand cannot share someone else's folder.
 */

export interface ShareTeamspace {
  id: string;
  name: string;
  icon: string | null;
  workspaceId: string;
  workspaceName: string;
  /** people in it — the ones a shared folder reaches */
  members: number;
}

/** The teamspaces this person could share a folder into — the ones they are a
 *  member of — the ones shared with the most people first, since sharing is
 *  for others. */
export async function shareableTeamspaces(userId: string): Promise<ShareTeamspace[]> {
  const mine = await db
    .select({
      id: teamspaces.id,
      name: teamspaces.name,
      icon: teamspaces.icon,
      workspaceId: teamspaces.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(teamspaceMembers)
    .innerJoin(teamspaces, eq(teamspaces.id, teamspaceMembers.teamspaceId))
    .innerJoin(workspaces, eq(workspaces.id, teamspaces.workspaceId))
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, teamspaces.workspaceId), eq(workspaceMembers.userId, userId)))
    .where(eq(teamspaceMembers.userId, userId));
  if (!mine.length) return [];
  const counts = await db
    .select({ id: teamspaceMembers.teamspaceId, n: sql<number>`count(*)::int` })
    .from(teamspaceMembers)
    .where(inArray(teamspaceMembers.teamspaceId, mine.map((t) => t.id)))
    .groupBy(teamspaceMembers.teamspaceId);
  const n = new Map(counts.map((c) => [c.id, c.n]));
  return mine
    .map((t) => ({ ...t, members: n.get(t.id) ?? 1 }))
    .sort((a, b) => b.members - a.members || a.workspaceName.localeCompare(b.workspaceName) || a.name.localeCompare(b.name));
}

/** Where each of this person's drives is already shared: driveId → teamspaces. */
export async function sharedBy(userId: string): Promise<Map<string, { teamspaceId: string; teamspaceName: string }[]>> {
  const rows = await db
    .select({ driveId: teamspaceDrives.driveId, teamspaceId: teamspaces.id, teamspaceName: teamspaces.name })
    .from(teamspaceDrives)
    .innerJoin(teamspaces, eq(teamspaces.id, teamspaceDrives.teamspaceId))
    .where(eq(teamspaceDrives.createdBy, userId));
  const out = new Map<string, { teamspaceId: string; teamspaceName: string }[]>();
  for (const r of rows) out.set(r.driveId, [...(out.get(r.driveId) ?? []), { teamspaceId: r.teamspaceId, teamspaceName: r.teamspaceName }]);
  return out;
}

export class ShareError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Links one of `userId`'s own folders into a teamspace they can see. The
 *  teamspace's first link also receives its OKF backup, which starts now. */
export async function shareFolder(
  userId: string,
  teamspaceId: string,
  input: { driveId?: unknown; root?: unknown; name?: unknown }
): Promise<TeamspaceDrive> {
  if (!(await visibleTeamspace(userId, teamspaceId))) throw new ShareError("Not found", 404);
  let link: AindriveLink | null;
  try {
    link = parseLink({ driveId: input.driveId, root: input.root });
  } catch (e) {
    throw new ShareError((e as Error).message, 400);
  }
  if (!link) throw new ShareError("driveId required", 400);
  const target = link;
  // sharing goes through the sharer's own aindrive account — asked over MCP
  const mine = await runAs(userId, () => hasDrive(target.driveId)).catch((e: Error) => e);
  if (mine instanceof Error) throw new ShareError(mine.message, 401);
  if (!mine) throw new ShareError("That drive is not in your aindrive account", 403);
  const existing = await db
    .select({ driveId: teamspaceDrives.driveId, root: teamspaceDrives.root, backup: teamspaceDrives.backup })
    .from(teamspaceDrives)
    .where(eq(teamspaceDrives.teamspaceId, teamspaceId));
  if (existing.some((e) => e.driveId === target.driveId && e.root === target.root))
    throw new ShareError("This folder is already linked to the teamspace", 409);
  // the first folder linked into a teamspace is where its OKF backup goes
  const backup = !existing.some((e) => e.backup);
  const given = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  // unnamed → the folder's own name, which is what the sidebar would show anyway
  const name = given || target.root.split("/").pop() || "aindrive";
  const [drive] = await db
    .insert(teamspaceDrives)
    .values({ teamspaceId, name, driveId: target.driveId, root: target.root, createdBy: userId, backup })
    .returning();
  // the first backup can take a while on a big teamspace — the page shows its
  // progress through the drive's backup status rather than holding this open
  if (backup) void runBackup(teamspaceId).catch((err) => console.error("[aindrive-backup] first run:", err));
  return drive;
}

export interface SharedFolder {
  /** the teamspace link's id — what the picker browses by */
  id: string;
  name: string;
  driveId: string;
  root: string;
  teamspaceId: string;
  teamspaceName: string;
  sharedBy: string | null;
}

/** Folders other people shared into the teamspaces this person can see. */
export async function foldersSharedWith(userId: string, workspaceId?: string | null): Promise<SharedFolder[]> {
  const rows = await db
    .select({
      id: teamspaceDrives.id,
      name: teamspaceDrives.name,
      driveId: teamspaceDrives.driveId,
      root: teamspaceDrives.root,
      teamspaceId: teamspaces.id,
      teamspaceName: teamspaces.name,
      workspaceId: teamspaces.workspaceId,
      sharedBy: users.displayName,
    })
    .from(teamspaceDrives)
    .innerJoin(teamspaces, eq(teamspaces.id, teamspaceDrives.teamspaceId))
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, teamspaces.workspaceId), eq(workspaceMembers.userId, userId)))
    .leftJoin(users, eq(users.id, teamspaceDrives.createdBy))
    .where(or(isNull(teamspaceDrives.createdBy), ne(teamspaceDrives.createdBy, userId)));
  const out: SharedFolder[] = [];
  for (const r of rows) {
    if (workspaceId && r.workspaceId !== workspaceId) continue;
    if (!(await visibleTeamspace(userId, r.teamspaceId))) continue;
    out.push({ id: r.id, name: r.name, driveId: r.driveId, root: r.root, teamspaceId: r.teamspaceId, teamspaceName: r.teamspaceName, sharedBy: r.sharedBy });
  }
  return out;
}
