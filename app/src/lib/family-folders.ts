import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  familyInvites,
  teamspaceDrives,
  teamspaceMembers,
  teamspaces,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import { driveOnline, listDrives, listFiles } from "@/lib/aindrive";
import { getAccount, runAs, runAsOrService } from "@/lib/aindrive-account";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";
import { ShareError, shareFolder } from "@/lib/aindrive-share";

/**
 * A family's folders in one teamspace: who is in it, which of their phone's
 * folders they share, whether each phone is on, who has been invited and not
 * joined yet — and the invite that brings someone in with one approval.
 */

export interface FamilyMember {
  userId: string;
  name: string;
  me: boolean;
  /** has an aindrive account connected here */
  connected: boolean;
  folders: { id: string; name: string; root: string; online: boolean; backup: boolean }[];
}

export interface FamilySummary {
  teamspace: { id: string; name: string; icon: string | null };
  members: FamilyMember[];
  invites: { id: string; name: string; token: string; createdAt: string }[];
  backup: { id: string; name: string; lastBackupAt: string | null; error: string | null } | null;
}

export async function familySummary(userId: string, teamspaceId: string): Promise<FamilySummary | null> {
  const ts = await visibleTeamspace(userId, teamspaceId);
  if (!ts) return null;
  const people = await db
    .select({ id: users.id, name: users.displayName, isAgent: users.isAgent })
    .from(teamspaceMembers)
    .innerJoin(users, eq(users.id, teamspaceMembers.userId))
    .where(eq(teamspaceMembers.teamspaceId, teamspaceId));
  const links = await db
    .select()
    .from(teamspaceDrives)
    .where(eq(teamspaceDrives.teamspaceId, teamspaceId))
    .orderBy(asc(teamspaceDrives.createdAt));
  // a phone is on when its drive answers — asked once per drive, as whoever linked it
  const online = new Map<string, boolean>();
  await Promise.all(
    [...new Map(links.map((l) => [l.driveId, l])).values()].map(async (l) =>
      online.set(l.driveId, await runAsOrService(l.createdBy, () => driveOnline(l.driveId)).catch(() => false))
    )
  );
  const members: FamilyMember[] = [];
  for (const p of people.filter((x) => !x.isAgent)) {
    members.push({
      userId: p.id,
      name: p.name,
      me: p.id === userId,
      connected: !!(await getAccount(p.id).catch(() => null)),
      folders: links
        .filter((l) => l.createdBy === p.id)
        .map((l) => ({ id: l.id, name: l.name, root: l.root, online: online.get(l.driveId) ?? false, backup: l.backup })),
    });
  }
  // sharers first, the person looking at it first among equals
  members.sort((a, b) => Number(b.folders.length > 0) - Number(a.folders.length > 0) || Number(b.me) - Number(a.me));
  const invites = await db
    .select({ id: familyInvites.id, name: familyInvites.name, token: familyInvites.token, createdAt: familyInvites.createdAt })
    .from(familyInvites)
    .where(and(eq(familyInvites.teamspaceId, teamspaceId), isNull(familyInvites.acceptedBy)))
    .orderBy(asc(familyInvites.createdAt));
  const b = links.find((l) => l.backup);
  return {
    teamspace: { id: ts.id, name: ts.name, icon: ts.icon },
    members,
    invites: invites.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    backup: b ? { id: b.id, name: b.name, lastBackupAt: b.lastBackupAt?.toISOString() ?? null, error: b.lastBackupError ?? null } : null,
  };
}

// ── invites ────────────────────────────────────────────────────────────────

const INVITE_DAYS = 14;

export async function createInvite(userId: string, teamspaceId: string, name: string) {
  const ts = await visibleTeamspace(userId, teamspaceId);
  if (!ts) throw new ShareError("Not found", 404);
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new ShareError("name required", 400);
  const [row] = await db
    .insert(familyInvites)
    .values({
      token: randomBytes(12).toString("base64url"),
      workspaceId: ts.workspaceId,
      teamspaceId,
      name: clean,
      createdBy: userId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    })
    .returning();
  return row;
}

export async function inviteByToken(token: string) {
  const [row] = await db
    .select({
      invite: familyInvites,
      teamspaceName: teamspaces.name,
      teamspaceIcon: teamspaces.icon,
      workspaceName: workspaces.name,
      inviterName: users.displayName,
    })
    .from(familyInvites)
    .innerJoin(teamspaces, eq(teamspaces.id, familyInvites.teamspaceId))
    .innerJoin(workspaces, eq(workspaces.id, familyInvites.workspaceId))
    .leftJoin(users, eq(users.id, familyInvites.createdBy))
    .where(eq(familyInvites.token, token))
    .limit(1);
  if (!row || row.invite.expiresAt < new Date()) return null;
  return row;
}

/** Joins the invited person to the workspace and teamspace, and — when they
 *  arrived with a placeholder name (a wallet address) — gives them the name
 *  the family knows them by. */
export async function acceptInvite(userId: string, token: string) {
  const found = await inviteByToken(token);
  if (!found) throw new ShareError("This invite has expired or does not exist", 404);
  const { invite } = found;
  if (invite.acceptedBy && invite.acceptedBy !== userId) throw new ShareError("This invite was already used", 409);
  await db.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId, role: "member" }).onConflictDoNothing();
  await db
    .insert(teamspaceMembers)
    .values({ teamspaceId: invite.teamspaceId, userId, role: "member" })
    .onConflictDoNothing();
  const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
  if (!me?.name || /^(wallet:|0x|aindrive user$)/i.test(me.name))
    await db.update(users).set({ displayName: invite.name }).where(eq(users.id, userId));
  await db.update(familyInvites).set({ acceptedBy: userId, acceptedAt: new Date() }).where(eq(familyInvites.id, invite.id));
  return invite;
}

// ── what to share: a phone's folders, as categories ────────────────────────

export interface Category {
  key: string;
  label: string;
  icon: string;
  /** on unless it is private by nature (health, money) */
  defaultOn: boolean;
  folders: { driveId: string; root: string }[];
}

const CATEGORIES: { key: string; label: string; icon: string; match: RegExp; defaultOn: boolean }[] = [
  { key: "photos", label: "사진·영상", icon: "📷", match: /(사진|앨범|영상|photo|camera|dcim|album|video)/i, defaultOn: true },
  { key: "notes", label: "레시피·메모", icon: "📝", match: /(레시피|메모|요리|편지|일기|recipe|note|memo)/i, defaultOn: true },
  { key: "voice", label: "녹음", icon: "🎙️", match: /(녹음|voice|record)/i, defaultOn: true },
  { key: "plans", label: "일정·계획", icon: "📅", match: /(일정|계획|여행|추석|귀성|달력|벌초|plan|trip)/i, defaultOn: true },
  { key: "health", label: "건강 기록", icon: "💊", match: /(건강|병원|약|health)/i, defaultOn: false },
  { key: "money", label: "지갑·가계부", icon: "👛", match: /(지갑|가계부|관리비|wallet|money)/i, defaultOn: false },
];

/** The person's own phone(s): top-level folders sorted into categories.
 *  Folders that fit none go to "그 밖의 폴더", off by default. */
export async function shareCategories(userId: string): Promise<{ drives: { id: string; name: string; online: boolean }[]; categories: Category[] }> {
  const drives = await runAs(userId, () => listDrives()).catch(() => []);
  const cats = new Map<string, Category>();
  const put = (key: string, label: string, icon: string, defaultOn: boolean, folder: { driveId: string; root: string }) => {
    const c = cats.get(key) ?? { key, label, icon, defaultOn, folders: [] };
    c.folders.push(folder);
    cats.set(key, c);
  };
  const out: { id: string; name: string; online: boolean }[] = [];
  for (const d of drives) {
    const top = await runAs(userId, () => listFiles({ driveId: d.id, root: "" }, "")).catch(() => null);
    out.push({ id: d.id, name: d.name, online: top !== null });
    for (const e of top ?? []) {
      if (!e.isDir || e.name.startsWith(".") || e.name.startsWith("ainmem-")) continue;
      const c = CATEGORIES.find((x) => x.match.test(e.name));
      if (c) put(c.key, c.label, c.icon, c.defaultOn, { driveId: d.id, root: e.name });
      else put("other", "그 밖의 폴더", "📁", false, { driveId: d.id, root: e.name });
    }
  }
  const order = [...CATEGORIES.map((c) => c.key), "other"];
  return { drives: out, categories: [...cats.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) };
}

/** Shares the chosen folders of the person's phone into the teamspace, each as
 *  "<name> · <folder>". Already shared is fine. */
export async function shareFolders(userId: string, teamspaceId: string, folders: { driveId: string; root: string }[]) {
  const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
  const shared: string[] = [];
  const failed: { root: string; error: string }[] = [];
  for (const f of folders.slice(0, 40)) {
    try {
      await shareFolder(userId, teamspaceId, { driveId: f.driveId, root: f.root, name: `${me?.name ?? ""} · ${f.root}`.trim() });
      shared.push(f.root);
    } catch (e) {
      if (!(e instanceof ShareError)) throw e;
      if (e.status === 409) shared.push(f.root);
      else failed.push({ root: f.root, error: e.message });
    }
  }
  return { shared, failed };
}
