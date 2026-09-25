import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { pages, workspaceMembers, dbRows, databases, dbProperties } from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { publish } from "@/lib/realtime";
import { scheduleMirror } from "@/lib/md-mirror";
import {
  isOkfId,
  decodeId,
  readNode,
  writePage,
  deleteNode,
  okfSyntheticPage,
  okfIcon,
} from "@/lib/okf-store";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { okfGateFor } from "@/lib/okf-acl";
import {
  validateShareToken,
  hasPermission,
  forbiddenResponse,
  getPagePermission,
  requirePagePermission,
} from "@/lib/auth/share-token";

export const dynamic = "force-dynamic";

/** Build the synthetic Page for an OKF node (mirrors GET /api/pages). */
/** okf_acl is the only thing making a relationship doc participant-only — the
 * page id is just base64url of the path, so every OKF branch below (read,
 * rename, delete) has to ask before it touches the file. Denied reads 404 so
 * the id cannot be used to probe for a doc's existence. */
async function okfDenied(pageId: string, userId: string): Promise<boolean> {
  const gate = await okfGateFor(userId);
  return !gate.canReadId(pageId);
}

async function okfPageFor(pageId: string, userId: string, icon?: string | null) {
  const node = readNode(decodeId(pageId));
  if (!node) return null;
  const workspaceId = (await getDefaultWorkspaceId(userId)) ?? "";
  return okfSyntheticPage({
    id: pageId,
    workspaceId,
    title: node.title,
    icon: icon ?? okfIcon(node.kind),
    parentPageId: null,
    position: 0,
  });
}

async function loadOwnedPage(pageId: string, userId: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return null;
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, page.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  if (!membership) return null;
 // workspace membership alone isn't enough for restricted pages — reading
 // takes an explicit grant (pageMembers) or owner/admin. Shields DM
 // relationship docs from non-participant members.
  if (page.restricted && !(await getPagePermission(pageId, userId))) return null;
  // nor for a private teamspace's pages: its members (and owner/admin) only
  if (page.teamspaceId && !(await getPagePermission(pageId, userId))) return null;
  return page;
}

/** Collect the page and all its descendants (for archive/restore cascades). */
async function collectSubtreeIds(rootId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await db
      .select({ id: pages.id })
      .from(pages)
      .where(inArray(pages.parentPageId, frontier));
    frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

/** A database ENTRY is a page: the row's reserved `__page` value points at its
 * body. Trashing the page therefore has to speak for the row too, or the table
 * keeps a row whose page is in the trash (docs/notion-page-delete.md §5). */
const ROW_ARCHIVED = "__archived";

/** The rows whose body page is one of `pageIds` (usually 0 or 1 of them). */
async function rowsForPages(pageIds: string[], workspaceId: string) {
  if (!pageIds.length) return [] as { id: string; databaseId: string }[];
  // only rows of databases in THIS page's workspace: `__page` is plain row data,
  // so a row anywhere could name this page id, and trashing my page must not
  // mark (or, on ?permanent=1, delete) a row in a database I cannot reach
  return db
    .select({ id: dbRows.id, databaseId: dbRows.databaseId })
    .from(dbRows)
    .innerJoin(databases, eq(databases.id, dbRows.databaseId))
    .where(
      and(
        inArray(sql`${dbRows.values}->>'__page'`, pageIds),
        eq(databases.workspaceId, workspaceId)
      )
    );
}

/**
 * Archive/restore the ROW side of a row page.
 *
 * The archive is SOFT, so the row record is kept and only marked
 * (`values.__archived`) — dropping it would be a one-way door: nothing in the
 * trash could rebuild a row's property values, and a restore would hand back a
 * page whose row is gone. Marking keeps the whole record, so restore is just
 * `values - '__archived'` (below) and the entry comes back with its values,
 * position and id intact.
 *
 * `__archived` follows the reserved-key convention this table already uses
 * (`__page`, `__template`, `__icon`): `applyView()` in lib/db-values.ts is the
 * single gate every view (table/board/gallery/timeline/list/chart/calendar)
 * and every calc goes through, and it already hides `__template` rows there.
 * Hiding a trashed entry is the same one-line filter next to that one
 * (`!r.values.__archived`) — that file is the other half of this fix and is
 * still open: until it lands the entry stays visible in the table, marked.
 *
 * A PERMANENT delete has no way back by definition, so there the row record
 * goes with the page (see DELETE) — leaving it would point the table at a page
 * id that no longer exists.
 */
async function setRowsArchived(rowIds: string[], archived: boolean) {
  if (!rowIds.length) return;
  await db
    .update(dbRows)
    .set({
 // the record really did change, so `updatedAt` moves with it; `updatedBy`
 // is left alone — "last edited by" belongs to whoever edited the content.
      values: archived
        ? sql`${dbRows.values} || ${JSON.stringify({ [ROW_ARCHIVED]: new Date().toISOString() })}::jsonb`
        : sql`${dbRows.values} - ${ROW_ARCHIVED}`,
      updatedAt: new Date(),
    })
    .where(inArray(dbRows.id, rowIds));
}

/** Tell every open table/board/peek of the affected databases to refetch. The
 * row route publishes the same event for its own writes — a page trashed from
 * the ⋯ menu has to wake the same listeners (`usePageSync(databaseId)` →
 * refreshSnapshot), or other tabs keep showing the entry. */
function publishRowTables(
  rows: { databaseId: string }[],
  clientId: string | null,
  at: number
) {
  for (const databaseId of new Set(rows.map((r) => r.databaseId))) {
    publish({ type: "blocks", pageId: databaseId, clientId, at });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;

  if (isOkfId(pageId)) {
    if (await okfDenied(pageId, auth.user.id))
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
      const page = await okfPageFor(pageId, auth.user.id);
      if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ page });
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const page = await loadOwnedPage(pageId, auth.user.id);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ page });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;

 // Try session auth first
  let userId: string | null = null;
  const auth = await requireAuth();
  if (!("error" in auth)) {
    userId = auth.user.id;
  }

 // OKF pages require session auth (no share-token path for file-backed pages)
  if (isOkfId(pageId)) {
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (await okfDenied(pageId, userId))
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
      const body = await req.json().catch(() => ({}));
      const node = readNode(decodeId(pageId));
      if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const icon = "icon" in body ? (body.icon as string | null) : okfIcon(node.kind);
      if (node.kind === "page") {
        const title = typeof body.title === "string" ? body.title : node.title;
        const meta = { ...node.meta };
        if (typeof icon === "string") meta.icon = icon;
        writePage(decodeId(pageId), title, meta, node.blocks);
      }
      const page = await okfPageFor(pageId, userId, icon);
      return NextResponse.json({ page });
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

 // Session-authed page access
  let page = userId ? await loadOwnedPage(pageId, userId) : null;

 // Session auth: check page-level edit permission
  if (page && userId) {
    const check = await requirePagePermission(pageId, userId, "edit");
    if (check !== true) return check;
  }

 // Share-token fallback: must have edit or full
  if (!page) {
    const share = await validateShareToken(req, pageId);
    if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!hasPermission(share.permission, "edit")) return forbiddenResponse("edit");
    const [p] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!p || p.isArchived) return NextResponse.json({ error: "Not found" }, { status: 404 });
    page = p;
  }

  const body = await req.json().catch(() => ({}));
 // Share-token users can only update title and icon (not reparent, archive, etc.)
  const allowed = userId
    ? ([
        "title",
        "icon",
        "coverUrl",
        "parentPageId",
        "position",
        "isFavorite",
        "isArchived",
        "fullWidth",
        "isLocked",
      ] as const)
    : (["title", "icon"] as const);
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) update[k] = body[k];

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ page });
  }
  update.updatedAt = new Date();

 // Archiving / restoring cascades to the whole subtree.
  const archivedRows: { id: string; databaseId: string }[] = [];
  // a non-boolean is cast by Postgres for the page but not for the row mark,
  // which would split the page and its entry apart — refuse it
  if ("isArchived" in update && typeof update.isArchived !== "boolean")
    return NextResponse.json({ error: "isArchived must be a boolean" }, { status: 400 });
  if ("isArchived" in update) {
 // Trashing and restoring are delete-grade, not edit-grade: this is the same
 // door DELETE opens (the trash modal restores through here), so it takes the
 // same "full" level. A guest shared into one page at "edit" must not be able
 // to fold the whole subtree away through PATCH either.
    if (userId) {
      const full = await requirePagePermission(pageId, userId, "full");
      if (full !== true) return full;
    }
    const ids = await collectSubtreeIds(pageId);
    await db
      .update(pages)
      .set({ isArchived: update.isArchived as boolean, updatedAt: new Date() })
      .where(inArray(pages.id, ids));
 // the row side of every entry page in that subtree moves with it
    archivedRows.push(...(await rowsForPages(ids, page.workspaceId)));
    await setRowsArchived(
      archivedRows.map((r) => r.id),
      update.isArchived === true
    );
  }

  const [updated] = await db
    .update(pages)
    .set(update)
    .where(eq(pages.id, pageId))
    .returning();

 // Reverse mirror: this page may be a database row's body (values.__page
 // points here). The table cell reads the row's title property, so a title
 // edited on the full page must flow back or the two drift apart.
  if (typeof update.title === "string") {
    const [row] = await db
      .select({ id: dbRows.id, databaseId: dbRows.databaseId })
      .from(dbRows)
      .where(sql`${dbRows.values}->>'__page' = ${pageId}`)
      .limit(1);
    if (row) {
      const [titleProp] = await db
        .select({ id: dbProperties.id })
        .from(dbProperties)
        .where(and(eq(dbProperties.databaseId, row.databaseId), eq(dbProperties.type, "title")))
        .limit(1);
      if (titleProp) {
        await db
          .update(dbRows)
          .set({
            values: sql`${dbRows.values} || ${JSON.stringify({ [titleProp.id]: update.title })}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(dbRows.id, row.id));
      }
    }
  }

  const clientId = req.headers.get("x-client-id");
  const at = Date.now();
  publish({ type: "page", pageId, clientId, at });
  publishRowTables(archivedRows, clientId, at);
  scheduleMirror(page.workspaceId);
  return NextResponse.json({ page: updated });
}

/** DELETE → archive; DELETE ?permanent=1 → hard delete (trash "delete forever"). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;

  if (isOkfId(pageId)) {
    if (await okfDenied(pageId, auth.user.id))
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const permanent = new URL(req.url).searchParams.get("permanent") === "1";
    try {
      const node = readNode(decodeId(pageId));
      if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (permanent) {
        deleteNode(decodeId(pageId));
        return NextResponse.json({ ok: true, deleted: 1 });
      }
      return NextResponse.json({ ok: true, archived: 1 });
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const page = await loadOwnedPage(pageId, auth.user.id);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

 // Deleting is at least as consequential as editing, and it takes the whole
 // SUBTREE with it — so it asks for "full", not the "edit" PATCH asks for.
 // Plain workspace members are unaffected (getPagePermission gives them "full"
 // implicitly); what this stops is the case a page grant creates: someone
 // shared into one page at "view"/"comment"/"edit" — a guest above all, whose
 // whole world is the pages shared with them — trashing that page and every
 // descendant of it.
  const allowed = await requirePagePermission(pageId, auth.user.id, "full");
  if (allowed !== true) return allowed;

  const permanent = new URL(req.url).searchParams.get("permanent") === "1";
  const ids = await collectSubtreeIds(pageId);
 // entry pages in the doomed subtree: their rows have to move with them
  const rows = await rowsForPages(ids, page.workspaceId);
  const clientId = req.headers.get("x-client-id");
  const at = Date.now();

  if (permanent) {
    await db.delete(pages).where(inArray(pages.id, ids));
 // "영구 삭제" has no restore to protect, and a row left behind would point
 // its `__page` at an id that no longer exists — take the record too.
    if (rows.length)
      await db.delete(dbRows).where(
        inArray(
          dbRows.id,
          rows.map((r) => r.id)
        )
      );
    publish({ type: "page", pageId, clientId, at });
    publishRowTables(rows, clientId, at);
    scheduleMirror(page.workspaceId);
    return NextResponse.json({ ok: true, deleted: ids.length, rowsDeleted: rows.length });
  }

  await db
    .update(pages)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(inArray(pages.id, ids));
 // soft: the row record is kept and marked, so restoring the page from the
 // trash brings the entry back whole (see setRowsArchived)
  await setRowsArchived(
    rows.map((r) => r.id),
    true
  );
  publish({ type: "page", pageId, clientId, at });
  publishRowTables(rows, clientId, at);
  scheduleMirror(page.workspaceId);
  return NextResponse.json({ ok: true, archived: ids.length, rowsArchived: rows.length });
}
