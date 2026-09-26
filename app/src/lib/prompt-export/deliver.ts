import "server-only";
import { and, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentAccessTokens,
  blocks,
  chatRoomBots,
  chatRoomMembers,
  okfAcl,
  pageMembers,
  pages,
  teamspaceDrives,
  teamspaceMembers,
  teamspaces,
  users,
  workspaceMembers,
  type BlockContent,
} from "@/lib/db/schema";
import { getWorkspaceRole } from "@/lib/auth/workspace-role";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";
import { aindriveConfigured, aindrivePublicBase, drivePath, parseLink, writeFile } from "@/lib/aindrive";
import { aindriveFileUrl } from "@/lib/aindrive-url";
import { runAs } from "@/lib/aindrive-account";
import { userLink } from "@/lib/aindrive-user";
import { decodeId, isOkfId } from "@/lib/okf-store";
import { visibleRefs } from "./collect";
import { isUuid } from "./input";
import type { PromptContent, TemplateName } from "./model";
import { sanitizeFilename } from "./render";
import { createDbSource, TEAMSPACE_PREFIX } from "./source-db";

/**
 * Where a prompt goes besides the reply: an ainmem page holding it in a code block
 * (the "file" inside the app) and a .md in the asker's own aindrive.
 *
 * The page must reach exactly the people the prompt was built for and nobody the
 * sources would not reach. It goes into the root's teamspace as an ordinary page when
 * that loses nothing — every source there, in an open teamspace or in none, none of
 * them restricted or behind okf_acl, and every reader able to see that teamspace.
 * Otherwise it is a RESTRICTED page granted to the readers alone. "Source" is everything
 * the prompt names, not only what it read: a sub-page or database it only printed the
 * title of, a page mentioned inline, and the root's ancestors (the project path).
 */

export interface Placement {
  workspaceId: string;
  teamspaceId: string | null;
  restricted: boolean;
}

/** Where the prompt page may go for these readers. */
export async function placementFor(content: PromptContent, viewerIds: string[], fallbackWorkspaceId: string): Promise<Placement> {
  const src = createDbSource({ viewerIds, baseUrl: "" });
  const refs = visibleRefs(content);
  const pageIds = new Set(refs.pages);
  const dbIds = refs.databases;
  for (const id of dbIds) if (isUuid(id)) for (const h of await src.homesOf(id)) pageIds.add(h);
  if (content.root.kind === "block") pageIds.add(content.root.pageId);
  // the page the prompt is "of": the root page, the database's home, the block's page
  let anchor: string | undefined =
    content.root.kind === "page" ? content.root.id : content.root.kind === "block" ? content.root.pageId : undefined;
  if (content.root.kind === "database" && isUuid(content.root.id)) anchor = (await src.homesOf(content.root.id))[0];

  let rootTs: string | null = null;
  let workspaceId = fallbackWorkspaceId;
  if (anchor?.startsWith(TEAMSPACE_PREFIX)) {
    rootTs = anchor.slice(TEAMSPACE_PREFIX.length);
    const [ts] = await db.select({ ws: teamspaces.workspaceId }).from(teamspaces).where(eq(teamspaces.id, rootTs));
    if (ts) workspaceId = ts.ws;
  } else if (anchor && isUuid(anchor)) {
    const [p] = await db.select({ ts: pages.teamspaceId, ws: pages.workspaceId }).from(pages).where(eq(pages.id, anchor));
    if (p) {
      rootTs = p.ts;
      workspaceId = p.ws;
    }
  }

  // the project path prints the root's ancestors
  if (anchor && isUuid(anchor)) {
    let cur: string | null = anchor;
    for (let i = 0; cur && i < 20; i++) {
      const [a]: { parent: string | null }[] = await db.select({ parent: pages.parentPageId }).from(pages).where(eq(pages.id, cur));
      cur = a?.parent ?? null;
      if (cur) pageIds.add(cur);
    }
  }

  let restricted = false;
  const uuids = [...pageIds].filter(isUuid);
  if (uuids.length) {
    const rows = await db.select({ ts: pages.teamspaceId, ws: pages.workspaceId, restricted: pages.restricted }).from(pages).where(inArray(pages.id, uuids));
    const tsIds = [...new Set(rows.map((r) => r.ts).filter((x): x is string => !!x))];
    const vis = tsIds.length
      ? new Map((await db.select({ id: teamspaces.id, v: teamspaces.visibility }).from(teamspaces).where(inArray(teamspaces.id, tsIds))).map((t) => [t.id, t.v]))
      : new Map<string, string>();
    for (const r of rows) {
      if (r.restricted) restricted = true;
      // a page of another workspace (a mention can point there) is not the teamspace's to show
      if (r.ws !== workspaceId) restricted = true;
      if (r.ts && r.ts !== rootTs && vis.get(r.ts) === "private") restricted = true;
    }
  }
  const okfIds = [...pageIds, ...dbIds].filter((id) => !isUuid(id) && !id.startsWith(TEAMSPACE_PREFIX) && isOkfId(id));
  if (okfIds.length) {
    const acl = await db.select({ path: okfAcl.path }).from(okfAcl);
    for (const id of okfIds) {
      const rel = decodeId(id).split("#")[0];
      if (acl.some((a) => rel === a.path || rel.startsWith(`${a.path}/`))) restricted = true;
    }
  }
  for (const v of viewerIds) {
    const role = await getWorkspaceRole(workspaceId, v);
    if (!role || role === "guest") restricted = true;
    if (rootTs && !(await visibleTeamspace(v, rootTs))) restricted = true;
  }
  return { workspaceId, teamspaceId: rootTs, restricted };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Write (or rewrite) the prompt page: a callout with the summary, then the prompt in a
 *  code block. Asking again for the same page and readers rewrites the same page. */
export async function savePromptPage(opts: {
  placement: Placement;
  askerId: string;
  viewerIds: string[];
  title: string;
  summary: string;
  prompt: string;
  template: TemplateName;
}): Promise<string> {
  const { placement: at, askerId } = opts;
  const readers = [...new Set([askerId, ...opts.viewerIds])];
  const same = await db
    .select({ id: pages.id })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, at.workspaceId),
        at.teamspaceId ? eq(pages.teamspaceId, at.teamspaceId) : isNull(pages.teamspaceId),
        eq(pages.title, opts.title),
        eq(pages.isArchived, false),
        eq(pages.createdBy, askerId),
        eq(pages.restricted, at.restricted)
      )
    );
  let pageId: string | null = null;
  for (const s of same) {
    if (!at.restricted) {
      pageId = s.id;
      break;
    }
    const members = (await db.select({ u: pageMembers.userId }).from(pageMembers).where(eq(pageMembers.pageId, s.id))).map((m) => m.u);
    if (sameSet(members, readers)) {
      pageId = s.id;
      break;
    }
  }
  if (pageId) {
    await db.delete(blocks).where(eq(blocks.pageId, pageId));
    await db.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, pageId));
  } else {
    const [{ top }] = await db
      .select({ top: max(pages.position) })
      .from(pages)
      .where(and(eq(pages.workspaceId, at.workspaceId), at.teamspaceId ? eq(pages.teamspaceId, at.teamspaceId) : isNull(pages.teamspaceId)));
    const [pg] = await db
      .insert(pages)
      .values({
        workspaceId: at.workspaceId,
        teamspaceId: at.teamspaceId,
        title: opts.title,
        icon: "🤖",
        restricted: at.restricted,
        position: (top ?? 0) + 1,
        createdBy: askerId,
      })
      .returning();
    pageId = pg.id;
    if (at.restricted)
      await db
        .insert(pageMembers)
        .values(readers.map((u) => ({ pageId: pg.id, userId: u, permission: u === askerId ? "full" : "view" })))
        .onConflictDoNothing();
  }
  const body: { type: "callout" | "code"; content: BlockContent }[] = [
    { type: "callout", content: { icon: "🤖", text: opts.summary } },
    { type: "code", content: { text: opts.prompt, language: opts.template === "markdown" ? "markdown" : "xml" } },
  ];
  await db.insert(blocks).values(body.map((b, i) => ({ pageId: pageId!, type: b.type, content: b.content, position: i + 1 })));
  return pageId;
}

export type DriveSave =
  | { saved: true; path: string; url: string | null }
  | { saved: false; reason: "not-configured" | "no-drive" | "shared-folder" | "failed"; error?: string };

/** A folder of a drive that other people reach — linked into a teamspace, or as a room
 *  agent's own folder — and everyone it reaches that way. */
export interface DriveShare {
  /** the linked folder ("" = the whole drive); null when the stored path does not parse */
  root: string | null;
  audience: string[];
}

/** Whether a folder linked into a teamspace shares this file — sharedLinkFor's rule: the
 *  whole drive, the file itself, or a folder around it. A link whose path could not be
 *  read counts as sharing everything. */
export function shareCovers(root: string | null, filePath: string): boolean {
  if (root === null) return true;
  const b = root.replace(/^\/+|\/+$/g, "");
  const p = filePath.replace(/^\/+|\/+$/g, "");
  return !b || p === b || p.startsWith(`${b}/`);
}

/** Pure: may the prompt be written at `filePath` — does no teamspace link covering it
 *  reach anyone outside the prompt's readers? */
export function driveSaveAllowed(filePath: string, shares: DriveShare[], readers: readonly string[]): boolean {
  const ok = new Set(readers);
  return shares.every((s) => !shareCovers(s.root, filePath) || s.audience.every((u) => ok.has(u)));
}

/** Everyone who can see a teamspace — visibleTeamspace's rule, listed: its workspace's
 *  members, and for a private teamspace only those who are members of it too. */
async function teamspaceAudience(teamspaceId: string): Promise<string[]> {
  const [ts] = await db.select({ ws: teamspaces.workspaceId, visibility: teamspaces.visibility }).from(teamspaces).where(eq(teamspaces.id, teamspaceId));
  if (!ts) return [];
  const inWs = (await db.select({ u: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, ts.ws))).map((r) => r.u);
  if (ts.visibility !== "private") return inWs;
  const inTs = new Set((await db.select({ u: teamspaceMembers.userId }).from(teamspaceMembers).where(eq(teamspaceMembers.teamspaceId, teamspaceId))).map((r) => r.u));
  return inWs.filter((u) => inTs.has(u));
}

/** Everyone a room agent answers or hands its folder to: the people (not agents) of
 *  every room it is in, and whoever holds one of its tokens (external platforms). */
async function agentAudience(agentUserId: string): Promise<string[]> {
  const rooms = new Set<string>();
  for (const r of await db.select({ id: chatRoomBots.roomId }).from(chatRoomBots).where(eq(chatRoomBots.agentUserId, agentUserId))) rooms.add(r.id);
  for (const r of await db.select({ id: chatRoomMembers.roomId }).from(chatRoomMembers).where(eq(chatRoomMembers.userId, agentUserId))) rooms.add(r.id);
  const out = new Set<string>();
  if (rooms.size)
    for (const m of await db
      .select({ id: users.id })
      .from(chatRoomMembers)
      .innerJoin(users, eq(users.id, chatRoomMembers.userId))
      .where(and(inArray(chatRoomMembers.roomId, [...rooms]), eq(users.isAgent, false))))
      out.add(m.id);
  for (const t of await db.select({ u: agentAccessTokens.userId }).from(agentAccessTokens).where(eq(agentAccessTokens.agentUserId, agentUserId))) out.add(t.u);
  return [...out];
}

const linkRoot = (driveId: string, root: unknown): string | null => {
  try {
    return parseLink({ driveId, root })?.root ?? null;
  } catch {
    return null;
  }
};

/** Every way this drive reaches other people, whoever set it up: its teamspace links
 *  (everyone who can see the teamspace) and room agents given a folder of it (everyone
 *  in their rooms). */
async function driveShares(driveId: string): Promise<DriveShare[]> {
  const out: DriveShare[] = [];
  const links = await db.select({ root: teamspaceDrives.root, teamspaceId: teamspaceDrives.teamspaceId }).from(teamspaceDrives).where(eq(teamspaceDrives.driveId, driveId));
  for (const l of links) out.push({ root: linkRoot(driveId, l.root), audience: await teamspaceAudience(l.teamspaceId) });
  const agents = await db
    .select({ id: users.id, config: users.agentConfig })
    .from(users)
    // the stored id is trimmed when read (parseLink / linkFromConfig), so compare it trimmed
    .where(and(eq(users.isAgent, true), sql`trim(${users.agentConfig}->'aindrive'->>'driveId') = ${driveId}`));
  for (const a of agents) {
    const raw = a.config?.aindrive as { root?: unknown } | undefined;
    out.push({ root: linkRoot(driveId, raw?.root ?? ""), audience: await agentAudience(a.id) });
  }
  return out;
}

/**
 * The prompt as `prompts/<title>.md` in the folder the asker linked from Home, written as
 * the asker — only where nobody outside the prompt's readers can open it.
 *
 * The folder is the asker's own; what widens it is a link covering the file. A teamspace
 * link (teamspace_drives) lets everyone who can see that teamspace open it (sharedLinkFor,
 * teamspaceDrive), and room agents list it to rooms they are in (sharedDriveSources); a
 * room agent given a folder of the drive (agentConfig.aindrive) reads it for everyone in
 * its rooms. So the file is written only when every such person is a reader, whatever
 * the prompt page's placement — an open placement in a private teamspace does not make a
 * folder linked into a wider teamspace safe. Otherwise nothing is written and the reason
 * is "shared-folder", for the reply to say so.
 *
 * `readers`: the people the prompt was built for (the asker is always one of them).
 */
export async function savePromptToDrive(askerId: string, title: string, prompt: string, readers: readonly string[]): Promise<DriveSave> {
  if (!aindriveConfigured()) return { saved: false, reason: "not-configured" };
  const link = await userLink(askerId).catch(() => null);
  if (!link) return { saved: false, reason: "no-drive" };
  const rel = `prompts/${sanitizeFilename(title)}.md`;
  const audience = [askerId, ...readers];
  let shares: DriveShare[];
  try {
    shares = await driveShares(link.driveId);
  } catch (e) {
    return { saved: false, reason: "failed", error: (e as Error).message };
  }
  if (!driveSaveAllowed(drivePath(link, rel), shares, audience)) return { saved: false, reason: "shared-folder" };
  try {
    await runAs(askerId, () => writeFile(link, rel, prompt));
  } catch (e) {
    return { saved: false, reason: "failed", error: (e as Error).message };
  }
  const base = aindrivePublicBase();
  return { saved: true, path: rel, url: base ? aindriveFileUrl(base, { driveId: link.driveId, path: drivePath(link, rel) }) : null };
}
