import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomMembers, teamspaceDrives, teamspaces, users } from "@/lib/db/schema";
import { parseLink, type AindriveLink } from "@/lib/aindrive";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";
import { isAssistantRoom } from "./assistant-room";

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

/** Not the teamspace's own OKF backup, not aindrive's bookkeeping. */
export function notBookkeeping(path: string): boolean {
  return !/(^|\/)ainmem-/.test(path) && !/(^|\/)\.aindrive\//.test(path) && !/(^|\/)CREDITS[^/]*\.md$/i.test(path);
}

/** Files worth offering the model: readable text, not bookkeeping. */
export function readableFile(path: string): boolean {
  return /\.(md|markdown|txt|csv|json)$/i.test(path) && notBookkeeping(path);
}

/** The person's own aindrive drives (their connected account), read as them —
 *  for their own assistant, beside whatever the family shared. Drives already
 *  shared whole into a teamspace are left to that share. Empty when no account
 *  is connected. */
export async function ownDriveSources(userId: string, already: DriveSource[] = []): Promise<DriveSource[]> {
  const { getAccount, runAs } = await import("@/lib/aindrive-account");
  const { listDrives } = await import("@/lib/aindrive");
  if (!(await getAccount(userId).catch(() => null))) return [];
  const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
  const drives = await runAs(userId, () => listDrives()).catch(() => []);
  const labels = new Set(already.map((s) => s.label));
  return drives
    .filter((d) => !already.some((s) => s.link.driveId === d.id && !s.link.root))
    .map((d) => {
      let label = d.name.replace(/\//g, "∕").trim() || "aindrive";
      while (labels.has(label)) label += "'";
      labels.add(label);
      return { label, link: { driveId: d.id, root: "" }, linkedBy: userId, ownerName: me?.name ?? undefined };
    });
}

/** The aindrive folders a room's agent may read: what was shared into the
 *  teamspaces everyone reading the answer can see — and, in a person's own
 *  assistant room, their own drives too. Also what "@<folder>" offers there. */
export async function roomSources(
  room: { kind: string; name: string; workspaceId: string | null },
  roomId: string,
  authorId: string,
  privateToUserId: string | null
): Promise<DriveSource[]> {
  if (!room.workspaceId) return [];
  const shared = await sharedDriveSources(room.workspaceId, await answerViewers(roomId, authorId, privateToUserId));
  if (!isAssistantRoom(room)) return shared;
  return [...shared, ...(await ownDriveSources(authorId, shared).catch(() => []))];
}
