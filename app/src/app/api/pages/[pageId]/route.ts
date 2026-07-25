import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { pages, workspaceMembers } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
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
import {
  validateShareToken,
  hasPermission,
  forbiddenResponse,
  getPagePermission,
  requirePagePermission,
} from "@/lib/auth/share-token";

export const dynamic = "force-dynamic";

/** Build the synthetic Page for an OKF node (mirrors GET /api/pages). */
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
  // 접근 제한 페이지는 워크스페이스 멤버십만으론 부족 — 명시 권한(pageMembers)
  // 또는 owner/admin이어야 열람. DM 관계 문서를 비참여 멤버로부터 보호한다.
  if (page.restricted && !(await getPagePermission(pageId, userId))) return null;
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;

  if (isOkfId(pageId)) {
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

  // Archiving / restoring cascades to the whole subtree (S019).
  if ("isArchived" in update) {
    const ids = await collectSubtreeIds(pageId);
    await db
      .update(pages)
      .set({ isArchived: update.isArchived as boolean, updatedAt: new Date() })
      .where(inArray(pages.id, ids));
  }

  const [updated] = await db
    .update(pages)
    .set(update)
    .where(eq(pages.id, pageId))
    .returning();

  publish({
    type: "page",
    pageId,
    clientId: req.headers.get("x-client-id"),
    at: Date.now(),
  });
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

  const permanent = new URL(req.url).searchParams.get("permanent") === "1";
  const ids = await collectSubtreeIds(pageId);

  if (permanent) {
    await db.delete(pages).where(inArray(pages.id, ids));
    scheduleMirror(page.workspaceId);
    return NextResponse.json({ ok: true, deleted: ids.length });
  }

  await db
    .update(pages)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(inArray(pages.id, ids));
  scheduleMirror(page.workspaceId);
  return NextResponse.json({ ok: true, archived: ids.length });
}
