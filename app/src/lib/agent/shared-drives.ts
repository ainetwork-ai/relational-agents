import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomMembers, teamspaceDrives, teamspaces, users } from "@/lib/db/schema";
import { parseLink, type AindriveLink } from "@/lib/aindrive";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";

/** One aindrive folder an agent may read, and whose account it is read as. */
export interface DriveSource {
  /** how the model sees the folder: its files are listed as "<label>/<path>";
   *  "" for an agent's own single linked folder (plain paths) */
  label: string;
  link: AindriveLink;
  linkedBy: string | null;
  /** the teamspace it is shared into (absent for an agent's own folder) */
  teamspaceId?: string;
  /** who shared it, by name */
  ownerName?: string;
}

/** Who reads the agent's answer: the asker alone for a quiet question, else
 *  every person (not agent) in the room. */
export async function answerViewers(roomId: string, authorId: string, privateToUserId: string | null): Promise<string[]> {
  if (privateToUserId) return [authorId];
  const rows = await db
    .select({ id: users.id })
    .from(chatRoomMembers)
    .innerJoin(users, eq(users.id, chatRoomMembers.userId))
    .where(and(eq(chatRoomMembers.roomId, roomId), eq(users.isAgent, false)));
  return [...new Set([authorId, ...rows.map((r) => r.id)])];
}

/**
 * The folders people shared into this workspace's teamspaces that everyone
 * reading the answer can see — what a room's agent may draw on. A private
 * teamspace's folders never reach a room where someone outside it would read
 * the reply. Each folder is read as the person who shared it.
 */
export async function sharedDriveSources(workspaceId: string, viewerIds: string[]): Promise<DriveSource[]> {
  const tss = await db.select({ id: teamspaces.id }).from(teamspaces).where(eq(teamspaces.workspaceId, workspaceId));
  const seen: string[] = [];
  for (const t of tss) {
    let all = true;
    for (const v of viewerIds) if (!(await visibleTeamspace(v, t.id))) all = false;
    if (all) seen.push(t.id);
  }
  if (!seen.length) return [];
  const rows = await db
    .select({
      name: teamspaceDrives.name,
      driveId: teamspaceDrives.driveId,
      root: teamspaceDrives.root,
      createdBy: teamspaceDrives.createdBy,
      teamspaceId: teamspaceDrives.teamspaceId,
      ownerName: users.displayName,
    })
    .from(teamspaceDrives)
    .leftJoin(users, eq(users.id, teamspaceDrives.createdBy))
    .where(inArray(teamspaceDrives.teamspaceId, seen))
    .orderBy(asc(teamspaceDrives.createdAt));
  const out: DriveSource[] = [];
  const labels = new Set<string>();
  for (const r of rows) {
    let link: AindriveLink | null = null;
    try {
      link = parseLink({ driveId: r.driveId, root: r.root });
    } catch {
      link = null;
    }
    if (!link) continue;
    // the same folder shared twice is one source; a label must be unique
    if (out.some((o) => o.link.driveId === link.driveId && o.link.root === link.root)) continue;
    let label = r.name.replace(/\//g, "∕").trim() || "aindrive";
    while (labels.has(label)) label += "'";
    labels.add(label);
    out.push({ label, link, linkedBy: r.createdBy, teamspaceId: r.teamspaceId, ownerName: r.ownerName ?? undefined });
  }
  return out;
}

/** Files worth offering the model: readable text, not the teamspace's own
 *  OKF backup, not aindrive's bookkeeping. */
export function readableFile(path: string): boolean {
  return (
    /\.(md|markdown|txt|csv|json)$/i.test(path) &&
    !/(^|\/)ainmem-/.test(path) &&
    !/(^|\/)\.aindrive\//.test(path) &&
    !/(^|\/)CREDITS[^/]*\.md$/i.test(path)
  );
}
