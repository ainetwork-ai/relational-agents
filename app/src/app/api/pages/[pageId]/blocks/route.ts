import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages, workspaceMembers } from "@/lib/db/schema";
import type { BlockContent, BlockType } from "@/lib/db/schema";
import { and, eq, inArray, max } from "drizzle-orm";
import { publish } from "@/lib/realtime";
import { maybeSnapshot, toSnapshotBlocks } from "@/lib/page-history";
import { scheduleMirror } from "@/lib/md-mirror";
import { notifyMentions } from "@/lib/notifications";
import {
  isOkfId,
  decodeId,
  readNode,
  writePage,
  parsedToBlocks,
  blocksToParsed,
  type IncomingBlock,
} from "@/lib/okf-store";
import {
  validateShareToken,
  hasPermission,
  forbiddenResponse,
  getPagePermission,
  requirePagePermission,
} from "@/lib/auth/share-token";

export const dynamic = "force-dynamic";

/** API callers (agents) often send content as a bare string, or table data
 *  without the `table` wrapper. Coerce into the shapes the editor renders. */
function normalizeContent(type: BlockType, content: unknown): BlockContent {
  if (typeof content === "string") return { text: content };
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (type === "table" && !c.table && Array.isArray(c.cells)) {
      return {
        table: { cells: c.cells as string[][], headerRow: c.headerRow !== false },
      };
    }
    return c as BlockContent;
  }
  return {};
}

async function loadAccessiblePage(pageId: string, userId: string) {
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
  // 접근 제한 페이지는 명시 권한(pageMembers) 또는 owner/admin만 — DM 관계 문서
  // 본문(메시지 내용)을 비참여 워크스페이스 멤버로부터 보호한다.
  if (page.restricted && !(await getPagePermission(pageId, userId))) return null;
  return page;
}

/**
 * Resolve access: try session auth first, then share-token fallback.
 */
async function resolveAccess(req: NextRequest, pageId: string) {
  // 1. Session auth (normal logged-in user)
  const auth = await requireAuth();
  if (!("error" in auth)) {
    if (isOkfId(pageId)) {
      return { authed: true as const, userId: auth.user.id, share: null };
    }
    const page = await loadAccessiblePage(pageId, auth.user.id);
    if (page) return { authed: true as const, userId: auth.user.id, page, share: null };
  }

  // 2. Share-token fallback (public link)
  const share = await validateShareToken(req, pageId);
  if (share) return { authed: true as const, userId: null, page: null, share };

  return { authed: false as const };
}

/** GET → { blocks: Block[] } ordered by position */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;
  const access = await resolveAccess(req, pageId);

  if (!access.authed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Share-token access: any permission level can read blocks
  if (access.share) {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page || page.isArchived) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const rows = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, pageId))
      .orderBy(blocks.position);
    return NextResponse.json({ blocks: rows });
  }

  // Session auth: check page-level permission (view is sufficient for GET)
  if (access.userId && !isOkfId(pageId)) {
    const check = await requirePagePermission(pageId, access.userId, "view");
    if (check !== true) return check;
  }

  // Normal session auth path
  if (isOkfId(pageId)) {
    try {
      const node = readNode(decodeId(pageId));
      if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const parsed = node.kind === "page" || node.kind === "row" ? node.blocks : [];
      return NextResponse.json({ blocks: parsedToBlocks(parsed, pageId) });
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const rows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, pageId))
    .orderBy(blocks.position);
  return NextResponse.json({ blocks: rows });
}

/** POST → create a single block { type, content, position, parentBlockId? } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;
  const access = await resolveAccess(req, pageId);

  if (!access.authed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Share-token: must have edit or full
  if (access.share && !hasPermission(access.share.permission, "edit")) {
    return forbiddenResponse("edit");
  }

  // Session auth: check page-level edit permission
  if (access.userId && !isOkfId(pageId)) {
    const check = await requirePagePermission(pageId, access.userId, "edit");
    if (check !== true) return check;
  }

  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { type = "paragraph", parentBlockId = null } = body ?? {};
  const content = normalizeContent(type, body?.content ?? {});
  // omitted position = append at the end (agents/API callers rarely track positions)
  let position: number | undefined = body?.position;
  if (position === undefined || position === null) {
    const [{ maxPos }] = await db
      .select({ maxPos: max(blocks.position) })
      .from(blocks)
      .where(eq(blocks.pageId, pageId));
    position = (maxPos ?? 0) + 1;
  }

  const [block] = await db
    .insert(blocks)
    .values({ pageId, type, content, position, parentBlockId })
    .returning();

  publish({
    type: "blocks",
    pageId,
    clientId: req.headers.get("x-client-id"),
    at: Date.now(),
  });
  scheduleMirror(page.workspaceId);
  return NextResponse.json({ block }, { status: 201 });
}

interface UpsertBlock {
  id?: string;
  type: BlockType;
  content: BlockContent;
  position: number;
  parentBlockId?: string | null;
}

/**
 * PUT → batch upsert for editor autosave.
 *   body: { blocks: UpsertBlock[], deletedIds?: string[] }
 * Returns the full ordered block list after applying changes.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;
  const access = await resolveAccess(req, pageId);

  if (!access.authed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Share-token: must have edit or full
  if (access.share && !hasPermission(access.share.permission, "edit")) {
    return forbiddenResponse("edit");
  }

  // Session auth: check page-level edit permission
  if (access.userId && !isOkfId(pageId)) {
    const check = await requirePagePermission(pageId, access.userId, "edit");
    if (check !== true) return check;
  }

  if (isOkfId(pageId) && !access.share) {
    try {
      const node = readNode(decodeId(pageId));
      if (!node || (node.kind !== "page" && node.kind !== "row"))
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      const body = await req.json().catch(() => ({}));
      const incoming: IncomingBlock[] = Array.isArray(body?.blocks) ? body.blocks : [];
      await maybeSnapshot(pageId, access.userId, async () => ({
        title: node.title,
        blocks: toSnapshotBlocks(parsedToBlocks(node.blocks, pageId)),
      }));
      const parsed = blocksToParsed(incoming);
      writePage(decodeId(pageId), node.title, node.meta, parsed);
      return NextResponse.json({ blocks: parsedToBlocks(parsed, pageId) });
    } catch {
      return NextResponse.json({ error: "write failed" }, { status: 400 });
    }
  }

  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const upserts: UpsertBlock[] = Array.isArray(body?.blocks) ? body.blocks : [];
  const deletedIds: string[] = Array.isArray(body?.deletedIds) ? body.deletedIds : [];
  // v2 autosave protocol: the client declares which ids IT created. An id that
  // misses its UPDATE and is not declared new was deleted by someone else —
  // re-inserting it would resurrect stale content (the duplicate-page bug).
  // Callers that omit `newIds` (scripts, MCP) keep the legacy insert-fallback.
  const declaredNew: string[] | null = Array.isArray(body?.newIds) ? body.newIds : null;
  const newIdSet = declaredNew ? new Set<string>(declaredNew) : null;
  const droppedIds: string[] = [];

  await maybeSnapshot(pageId, access.userId, async () => {
    const cur = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, pageId))
      .orderBy(blocks.position);
    return { title: page.title, blocks: toSnapshotBlocks(cur) };
  });

  if (deletedIds.length) {
    await db
      .delete(blocks)
      .where(and(eq(blocks.pageId, pageId), inArray(blocks.id, deletedIds)));
  }

  for (const b of upserts) {
    b.content = normalizeContent(b.type, b.content);
    if (b.id) {
      const [updated] = await db
        .update(blocks)
        .set({
          type: b.type,
          content: b.content,
          position: b.position,
          parentBlockId: b.parentBlockId ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(blocks.id, b.id), eq(blocks.pageId, pageId)))
        .returning();
      if (!updated) {
        if (newIdSet && !newIdSet.has(b.id)) {
          droppedIds.push(b.id); // stale id — deleted elsewhere, do not resurrect
          continue;
        }
        await db.insert(blocks).values({
          id: b.id,
          pageId,
          type: b.type,
          content: b.content,
          position: b.position,
          parentBlockId: b.parentBlockId ?? null,
        });
      }
    } else {
      await db.insert(blocks).values({
        pageId,
        type: b.type,
        content: b.content,
        position: b.position,
        parentBlockId: b.parentBlockId ?? null,
      });
    }
  }

  await db
    .update(pages)
    .set({ updatedAt: new Date() })
    .where(eq(pages.id, pageId));

  const rows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, pageId))
    .orderBy(blocks.position);

  // @-mention notifications only for authenticated users (not anonymous share)
  if (access.userId) {
    for (const b of upserts) {
      await notifyMentions({
        html: b.content?.html,
        actorId: access.userId,
        pageId,
        dedupeUnread: true,
      });
    }
  }

  publish({
    type: "blocks",
    pageId,
    clientId: req.headers.get("x-client-id"),
    at: Date.now(),
  });
  scheduleMirror(page.workspaceId);
  return NextResponse.json({ blocks: rows, ...(droppedIds.length ? { droppedIds } : {}) });
}
