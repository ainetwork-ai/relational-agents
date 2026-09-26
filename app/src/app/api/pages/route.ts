import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, dbRows, pageMembers, pages, agentRoomStates, chatRooms, okfAcl, teamspaceMembers, teamspaces, users, workspaceMembers } from "@/lib/db/schema";
import { loadDatabaseForUser } from "@/lib/db-access";
import { getPagePermission, hasPermission } from "@/lib/auth/share-token";
import { and, eq, inArray, max, isNotNull, sql } from "drizzle-orm";
import { getDefaultWorkspaceId, workspaceForRequest } from "@/lib/workspace";
import { getWorkspaceRole } from "@/lib/auth/workspace-role";
import { scheduleMirror } from "@/lib/md-mirror";
import { encodeId, listPages, okfSyntheticPage } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";
import { RELATIONSHIP_DOC_PREFIXES } from "@/i18n/content/components";

/** "<relationship/family doc prefix> — <sides>[-<room6>]", Korean or English prefix. */
const RELATIONSHIP_DOC_TITLE = new RegExp(`^(?:${RELATIONSHIP_DOC_PREFIXES.join("|")})\\s*—\\s*(.+?)(?:-[0-9a-f]{6})?$`, "iu");

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/pages?archived=1 → { pages: Page[] } (flat list; tree is client-side).
 * OKF file-backed pages (the folder tree = the content backend) are merged in
 * so the ONE sidebar lists them alongside any Postgres pages. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

 // ?workspaceId= (membership-checked) lets the sidebar ask for the workspace
 // of the page being viewed before the session has followed it (QA-3)
  const workspaceId = await workspaceForRequest(req, auth.user.id);
  if (!workspaceId) return NextResponse.json({ pages: [] });

  const archived = new URL(req.url).searchParams.get("archived") === "1";
  const plain = await db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), eq(pages.isArchived, archived)))
    .orderBy(pages.position);

 // isDatabase: this page's body IS a database (a fullPage database block), not a
 // page that happens to contain one. The sidebar needs it to name and icon the
 // row the way Notion does — "New database" with a table glyph, not "Untitled"
 // with a page glyph — and only the block knows.
 //
 // Two queries rather than a correlated subquery: `${pages.id}` inside a raw sql
 // template renders as bare "id", which the subquery resolves against BLOCKS —
 // so `b.page_id = "id"` compared blocks.page_id to blocks.id and was false for
 // every row, silently.
  const dbPageIds = new Set(
    (
      await db
        .select({ pageId: blocks.pageId })
        .from(blocks)
        .where(and(eq(blocks.type, "database"), sql`${blocks.content}->>'fullPage' = 'true'`))
    ).map((r) => r.pageId)
  );
 // isRow: this page is a database ENTRY's body (db_rows.values.__page points at
 // it). Notion keeps entries inside their database, never in the sidebar — and
 // the sidebar filled up with "Untitled" the moment rows started getting their
 // page up front. The flag rather than an exclusion here: the store still needs
 // the record for breadcrumbs, favourites and @-mentions.
  const rowPageIds = new Set(
    (
      await db
        .select({ pageId: sql<string>`${dbRows.values}->>'__page'` })
        .from(dbRows)
        .where(sql`${dbRows.values} ? '__page'`)
    ).map((r) => r.pageId)
  );
  const rows = plain.map((p) => ({
    ...p,
    isDatabase: dbPageIds.has(p.id),
    isRow: rowPageIds.has(p.id),
  }));

 // Restricted pages (DM relationship docs etc.) show only to explicitly
 // granted members; owner/admin read everything for administration (same as
 // getPagePermission). Ordinary pages are unchanged. Guests get the 
 // inverse default: nothing but explicitly shared pages — being someone's DM
 // partner must not let you browse their workspace.
  let visible = rows;
  const role = await getWorkspaceRole(workspaceId, auth.user.id);
  if (role === "guest") {
    const ids = rows.map((r) => r.id);
    const grants = ids.length
      ? await db
          .select({ pageId: pageMembers.pageId })
          .from(pageMembers)
          .where(and(eq(pageMembers.userId, auth.user.id), inArray(pageMembers.pageId, ids)))
      : [];
    const granted = new Set(grants.map((g) => g.pageId));
    visible = rows.filter((r) => granted.has(r.id));
  } else {
    const restrictedIds = rows.filter((r) => r.restricted).map((r) => r.id);
    if (restrictedIds.length && role !== "owner" && role !== "admin") {
      const grants = await db
        .select({ pageId: pageMembers.pageId })
        .from(pageMembers)
        .where(
          and(eq(pageMembers.userId, auth.user.id), inArray(pageMembers.pageId, restrictedIds))
        );
      const granted = new Set(grants.map((g) => g.pageId));
      visible = rows.filter((r) => !r.restricted || granted.has(r.id));
    }
    // a private teamspace's pages only to its members (owner/admin excepted, as
    // getPagePermission does)
    if (role !== "owner" && role !== "admin") {
      const privateTs = await db
        .select({ id: teamspaces.id })
        .from(teamspaces)
        .where(and(eq(teamspaces.workspaceId, workspaceId), eq(teamspaces.visibility, "private")));
      if (privateTs.length) {
        const mine = new Set(
          (
            await db
              .select({ id: teamspaceMembers.teamspaceId })
              .from(teamspaceMembers)
              .where(and(eq(teamspaceMembers.userId, auth.user.id), inArray(teamspaceMembers.teamspaceId, privateTs.map((t) => t.id))))
          ).map((m) => m.id)
        );
        const hidden = new Set(privateTs.map((t) => t.id).filter((id) => !mine.has(id)));
        visible = visible.filter((r) => !r.teamspaceId || !hidden.has(r.teamspaceId));
      }
    }
  }

  if (archived) return NextResponse.json({ pages: visible });

 // merge in the file-backed OKF pages (folder tree = the content backend).
 // participant-only OKF paths (relationship docs) are excluded for
 // non-members — the file tree has no permissions of its own, so the
 // okf_acl gate plays that role.
 // OKF pages are files, never a database block — the flag is false for them.
  let okf: (typeof rows)[number][] = [];
  try {
    const gate = await okfGateFor(auth.user.id);
    // Relationship docs live as files (workspace-agnostic), but each doc's
    // ROOM has a home workspace — surface a doc only in that workspace, so
    // e.g. grandma's space doesn't list every other member's doc. Docs whose
    // room we can't place keep the old everywhere-behavior.
    const docHomes = await db
      .select({ path: agentRoomStates.rootOkfPath, wsId: chatRooms.workspaceId })
      .from(agentRoomStates)
      .innerJoin(chatRooms, eq(chatRooms.id, agentRoomStates.roomId))
      .where(isNotNull(agentRoomStates.rootOkfPath));
    const homeByPrefix = docHomes.filter((d) => d.path) as { path: string; wsId: string }[];
    const memberRows = await db
      .select({ name: users.displayName })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    const memberNamesLower = new Set(
      memberRows.map((r) => (r.name ?? "").replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase())
    );
    const inThisWorkspace = (okfId: string) => {
      let rel: string;
      try {
        rel = Buffer.from(okfId, "base64url").toString("utf8");
      } catch {
        return true;
      }
      for (const d of homeByPrefix) {
        if (rel === d.path || rel.startsWith(d.path + "/")) return d.wsId === workspaceId;
      }
      // room mapping missing (resets can drop rooms): fall back to the
      // membership rule — a relationship doc belongs where its partner is a
      // member. Docs that don't parse as "… — <partner>" stay visible.
      const base = rel.split("/")[0];
      const m = base.match(RELATIONSHIP_DOC_TITLE);
      if (!m) return true;
      const sides = m[1].split(/(?:❤️|❤|♥|💛|🧡|🩷|💘|💝|\s·\s)+/u).map((x) => x.trim()).filter(Boolean);
      const partner = sides[sides.length - 1];
      if (!partner) return true;
      const norm = (t: string) => t.replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase();
      return memberNamesLower.has(norm(partner));
    };
    // a failure here only costs the Shared grouping (the docs fall back to Private), not the tree
    const sharedById = await relationDocsSharedWith(auth.user.id).catch((e: unknown) => {
      console.error("[pages] relation doc sharing lookup failed:", e);
      return new Map<string, RelationShare>();
    });
    okf = listPages()
      .filter((p) => gate.canReadId(p.id) && inThisWorkspace(p.id))
      .map((p) => ({
        isDatabase: false,
 // a file-backed entry already sits under its database in the folder tree,
 // so it is nested rather than a root the sidebar would list twice
        isRow: false,
        ...okfSyntheticPage({
        id: p.id,
        workspaceId,
        title: p.title,
        icon: p.icon,
        parentPageId: p.parentPageId,
        position: p.position,
        kind: p.kind,
        }),
        ...(sharedById.has(p.id) ? { sharedWith: sharedById.get(p.id) } : {}),
      }));
  } catch {
 // OKF root missing/malformed → just the Postgres pages
  }
  return NextResponse.json({ pages: [...visible, ...okf] });
}

/** Who a relation's memory doc is shared with, as the sidebar's Shared section
 * shows it ("Tokyo Trip · 6 people"). */
interface RelationShare {
  roomId: string;
  /** the relation's room name; null when the room row is gone (resets drop rooms) */
  roomName: string | null;
  /** the humans who can read the doc (okf_acl members, the room's agent excluded) */
  people: number;
}

/** A relation's memory doc is readable only by the relation's members — the
 * okf_acl rows that carry a roomId. Keyed by the doc ROOT's page id, only for
 * docs this user is a member of: everything here comes from okf_acl, never
 * from the client, so no one can move a page into Shared by asking. */
async function relationDocsSharedWith(userId: string): Promise<Map<string, RelationShare>> {
  const rows = (
    await db
      .select({ path: okfAcl.path, roomId: okfAcl.roomId, memberIds: okfAcl.memberIds })
      .from(okfAcl)
      .where(isNotNull(okfAcl.roomId))
  ).filter((r) => (r.memberIds ?? []).includes(userId));
  const out = new Map<string, RelationShare>();
  if (!rows.length) return out;
  const roomIds = [...new Set(rows.map((r) => r.roomId!))];
  const memberIds = [...new Set(rows.flatMap((r) => r.memberIds ?? []))];
  const [rooms, humans] = await Promise.all([
    db.select({ id: chatRooms.id, name: chatRooms.name }).from(chatRooms).where(inArray(chatRooms.id, roomIds)),
    db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, memberIds), eq(users.isAgent, false))),
  ]);
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const human = new Set(humans.map((h) => h.id));
  for (const r of rows) {
    out.set(encodeId(r.path), {
      roomId: r.roomId!,
      roomName: roomName.get(r.roomId!) ?? null,
      people: (r.memberIds ?? []).filter((id) => human.has(id)).length,
    });
  }
  return out;
}

/** POST /api/pages { title?, parentPageId?, icon?, teamspaceId? } → { page }
 *  teamspaceId is optional: a page with a parent inherits the parent's. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  let { parentPageId = null } = body ?? {};
  const { title = "", icon = null, teamspaceId = null } = body ?? {};

  // A page belongs to the workspace of whatever it hangs off — NOT to the
  // session's active workspace. Taking the active one put a row made in
  // ComCom > Projects into the creator's personal workspace whenever that was
  // the one selected, so after Move to Trash the page sat in the other
  // workspace's trash and could not be restored from where it was deleted.
  // The active workspace is only the answer for a page with no parent.
  let workspaceId = await getDefaultWorkspaceId(auth.user.id);

  if (typeof body?.rowForDatabaseId === "string") {
   // A database row's body page belongs UNDER the page hosting the database —
   // that's what the breadcrumb walks. The client minting it (ensureRowPage)
   // only knows the database id, and a linked view can host the same database
   // on several pages, so resolve here: prefer the full-page host.
    const database = UUID_RE.test(body.rowForDatabaseId)
      ? await loadDatabaseForUser(body.rowForDatabaseId, auth.user.id)
      : null;
    if (!database) return NextResponse.json({ error: "Not found" }, { status: 404 });
    workspaceId = database.workspaceId;
    const hosts = await db
      .select({
        pageId: blocks.pageId,
        fullPage: sql<string | null>`${blocks.content}->>'fullPage'`,
      })
      .from(blocks)
      .innerJoin(pages, eq(pages.id, blocks.pageId))
      .where(
        and(
          eq(blocks.type, "database"),
          eq(blocks.alive, true),
          sql`${blocks.content}->>'databaseId' = ${body.rowForDatabaseId}`,
         // a host in another workspace would drag the row page across again
          eq(pages.workspaceId, database.workspaceId)
        )
      );
    const host = hosts.find((h) => h.fullPage === "true") ?? hosts[0];
    if (host) parentPageId = host.pageId;
  } else if (typeof parentPageId === "string" && UUID_RE.test(parentPageId)) {
   // A sub-page: its parent decides the workspace, and adding under a page is
   // an edit of that page. Unchecked, any signed-in user could hang a child
   // off any page id at all, including one in a workspace they are not in.
    const [parent] = await db
      .select({ workspaceId: pages.workspaceId })
      .from(pages)
      .where(eq(pages.id, parentPageId))
      .limit(1);
    const perm = parent ? await getPagePermission(parentPageId, auth.user.id) : null;
    if (!parent || !perm || !hasPermission(perm, "edit"))
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    workspaceId = parent.workspaceId;
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }

  const [{ maxPos }] = await db
    .select({ maxPos: max(pages.position) })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        parentPageId ? eq(pages.parentPageId, parentPageId) : eq(pages.isArchived, false)
      )
    );

 // A sub-page belongs where its parent belongs. The + on a teamspace row
 // ("Add to: 🏠 Teamspace Home") adds to that teamspace; without this the child
 // came out with teamspace_id NULL — a Private page that merely happened to sit
 // under a team page. Only the topmost ancestor is sure to carry the id on
 // rows created before this, so walk up until one does.
  let inheritedTeamspaceId = typeof teamspaceId === "string" ? teamspaceId : null;
  if (!inheritedTeamspaceId && parentPageId) {
    let cursor: string | null = parentPageId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const [ancestor] = await db
        .select({ teamspaceId: pages.teamspaceId, parentPageId: pages.parentPageId })
        .from(pages)
        .where(and(eq(pages.id, cursor), eq(pages.workspaceId, workspaceId)))
        .limit(1);
      if (!ancestor) break;
      if (ancestor.teamspaceId) {
        inheritedTeamspaceId = ancestor.teamspaceId;
        break;
      }
      cursor = ancestor.parentPageId;
    }
  }

  const [page] = await db
    .insert(pages)
    .values({
      workspaceId,
      parentPageId,
      teamspaceId: inheritedTeamspaceId,
      title,
      icon,
      position: (maxPos ?? 0) + 1,
      createdBy: auth.user.id,
    })
    .returning();

 // Seed one empty paragraph server-side. If clients fabricated the first
 // block locally, two editors opening an empty page would each create their
 // own — duplicate blocks under concurrent editing.
  await db.insert(blocks).values({
    pageId: page.id,
    type: "paragraph",
    content: { text: "" },
    position: 1,
  });

  scheduleMirror(workspaceId);
  return NextResponse.json({ page }, { status: 201 });
}
