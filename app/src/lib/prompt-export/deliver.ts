import "server-only";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { blocks, okfAcl, pageMembers, pages, teamspaceDrives, teamspaces, type BlockContent } from "@/lib/db/schema";
import { getWorkspaceRole } from "@/lib/auth/workspace-role";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";
import { aindriveConfigured, aindrivePublicBase, drivePath, writeFile } from "@/lib/aindrive";
import { aindriveFileUrl } from "@/lib/aindrive-url";
import { runAs } from "@/lib/aindrive-account";
import { userLink } from "@/lib/aindrive-user";
import { decodeId, isOkfId } from "@/lib/okf-store";
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
 * Otherwise it is a RESTRICTED page granted to the readers alone.
 */

export interface Placement {
  workspaceId: string;
  teamspaceId: string | null;
  restricted: boolean;
}

/** Where the prompt page may go for these readers. */
export async function placementFor(content: PromptContent, viewerIds: string[], fallbackWorkspaceId: string): Promise<Placement> {
  const src = createDbSource({ viewerIds, baseUrl: "" });
  const pageIds = new Set(Object.keys(content.pages));
  const dbIds = Object.keys(content.databases);
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

  let restricted = false;
  const uuids = [...pageIds].filter(isUuid);
  if (uuids.length) {
    const rows = await db.select({ ts: pages.teamspaceId, restricted: pages.restricted }).from(pages).where(inArray(pages.id, uuids));
    const tsIds = [...new Set(rows.map((r) => r.ts).filter((x): x is string => !!x))];
    const vis = tsIds.length
      ? new Map((await db.select({ id: teamspaces.id, v: teamspaces.visibility }).from(teamspaces).where(inArray(teamspaces.id, tsIds))).map((t) => [t.id, t.v]))
      : new Map<string, string>();
    for (const r of rows) {
      if (r.restricted) restricted = true;
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

/** The prompt as `prompts/<title>.md` in the folder the asker linked from Home, written
 *  as the asker. Skipped when the prompt is for a narrower audience than that folder
 *  (it is also shared into a teamspace). */
export async function savePromptToDrive(askerId: string, title: string, prompt: string, restricted: boolean): Promise<DriveSave> {
  if (!aindriveConfigured()) return { saved: false, reason: "not-configured" };
  const link = await userLink(askerId).catch(() => null);
  if (!link) return { saved: false, reason: "no-drive" };
  if (restricted) {
    const shares = await db.select({ root: teamspaceDrives.root }).from(teamspaceDrives).where(eq(teamspaceDrives.driveId, link.driveId));
    const a = link.root.replace(/^\/+|\/+$/g, "");
    const overlaps = shares.some((s) => {
      const b = s.root.replace(/^\/+|\/+$/g, "");
      return !a || !b || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    });
    if (overlaps) return { saved: false, reason: "shared-folder" };
  }
  const rel = `prompts/${sanitizeFilename(title)}.md`;
  try {
    await runAs(askerId, () => writeFile(link, rel, prompt));
  } catch (e) {
    return { saved: false, reason: "failed", error: (e as Error).message };
  }
  const base = aindrivePublicBase();
  return { saved: true, path: rel, url: base ? aindriveFileUrl(base, { driveId: link.driveId, path: drivePath(link, rel) }) : null };
}
