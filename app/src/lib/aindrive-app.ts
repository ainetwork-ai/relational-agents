import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamspaceDrives, users } from "@/lib/db/schema";
import { aindriveHttp, listDrives, listFiles } from "@/lib/aindrive";
import { runAs } from "@/lib/aindrive-account";
import { ShareError, shareFolder, shareableTeamspaces } from "@/lib/aindrive-share";
import { stamp, stampOk } from "@/lib/secret-box";

/**
 * This app as seen from aindrive: a "connected app" whose spaces (teamspaces)
 * a person's folders can be shared into, turned on and off per folder from
 * aindrive's own share sheet (web and phone).
 *
 * When a person connects aindrive here, this server registers itself on their
 * aindrive account (POST /api/apps) with a spaces URL and a key that names
 * them. aindrive's server then calls, with `Authorization: Bearer <key>`:
 *
 *   GET  /api/aindrive-app/spaces?driveId&path      → the person's spaces, each
 *        with whether this folder is shared there and which of the drive's
 *        folders are
 *   PUT  /api/aindrive-app/spaces/:teamspaceId      { driveId, path, shared }
 *
 * The key is "<userId>.<HMAC>" — nothing stored here, revoked by rotating
 * SESSION_SECRET. Whether the drive is the person's is still asked of aindrive
 * itself when a folder is shared (lib/aindrive-share).
 */

const KEY = "aindrive-app";

export function appKeyFor(userId: string): string {
  return `${userId}.${stamp(KEY, userId)}`;
}

/** The person a bearer key names, or null. */
export function userOfAppKey(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+([0-9a-f-]{36})\.(\S+)$/i);
  return m && stampOk(KEY, m[1], m[2]) ? m[1] : null;
}

export interface AppSpace {
  id: string;
  name: string;
  /** the workspace it is in */
  group: string;
  icon: string | null;
  members: number;
  /** this folder is shared into the space */
  shared: boolean;
  /** every folder of this drive the person shares there ("" = the whole drive) */
  sharedPaths: string[];
}

const clean = (p: string) => p.replace(/^\/+|\/+$/g, "");

export async function spacesFor(userId: string, driveId: string, path: string): Promise<AppSpace[]> {
  const spaces = await shareableTeamspaces(userId);
  const mine = await db
    .select({ teamspaceId: teamspaceDrives.teamspaceId, root: teamspaceDrives.root })
    .from(teamspaceDrives)
    .where(and(eq(teamspaceDrives.createdBy, userId), eq(teamspaceDrives.driveId, driveId)));
  const here = clean(path);
  return spaces.map((s) => {
    const sharedPaths = mine.filter((m) => m.teamspaceId === s.id).map((m) => m.root);
    return { id: s.id, name: s.name, group: s.workspaceName, icon: s.icon, members: s.members, shared: sharedPaths.includes(here), sharedPaths };
  });
}

/** Shares or stops sharing one of the person's folders in a space. Idempotent. */
export async function setShared(userId: string, teamspaceId: string, driveId: string, path: string, shared: boolean): Promise<void> {
  const root = clean(path);
  if (!shared) {
    await db
      .delete(teamspaceDrives)
      .where(
        and(
          eq(teamspaceDrives.teamspaceId, teamspaceId),
          eq(teamspaceDrives.createdBy, userId),
          eq(teamspaceDrives.driveId, driveId),
          eq(teamspaceDrives.root, root)
        )
      );
    return;
  }
  const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
  const folder = root.split("/").pop() || "";
  let label = folder;
  if (!root) {
    // the whole drive — on a phone, the folder picked for it — goes by the drive's name
    const drives = await runAs(userId, () => listDrives()).catch(() => []);
    label = drives.find((d) => d.id === driveId)?.name ?? "";
  } else {
    // a teamspace shows a folder; a file has nothing to open as one
    const parent = root.includes("/") ? root.slice(0, root.lastIndexOf("/")) : "";
    const entries = await runAs(userId, () => listFiles({ driveId, root: "" }, parent)).catch(() => null);
    if (entries?.some((e) => e.name === folder && !e.isDir))
      throw new ShareError("Only folders can be shared into a workspace — share the folder this file is in", 400);
  }
  try {
    // same naming as the family share page: "<name> · <folder>"
    await shareFolder(userId, teamspaceId, { driveId, root, name: label ? `${me?.name ?? ""} · ${label}`.trim() : undefined });
  } catch (e) {
    if (!(e instanceof ShareError && e.status === 409)) throw e;
  }
}

/** Registers this app on the person's aindrive account (idempotent there). */
export async function registerWithAindrive(userId: string): Promise<void> {
  const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  if (!origin) return; // no public origin → aindrive could not call back
  const r = await runAs(userId, () =>
    aindriveHttp("/api/apps", {
      method: "POST",
      body: JSON.stringify({ name: process.env.AINDRIVE_APP_NAME?.trim() || "ainmem", url: `${origin}/api/aindrive-app/spaces`, key: appKeyFor(userId) }),
    })
  );
  if (!r.ok && r.status !== 404) throw new Error(`aindrive /api/apps: ${r.status} ${await r.text().catch(() => "")}`);
}
