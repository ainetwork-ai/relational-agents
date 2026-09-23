import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages, workspaceMembers } from "@/lib/db/schema";
import type { BlockType } from "@/lib/db/schema";
import { and, eq, max } from "drizzle-orm";
import { isOkfId, decodeId, readNode, parsedToBlocks } from "@/lib/okf-store";
import { validateShareToken, getPagePermission, requirePagePermission } from "@/lib/auth/share-token";
import { okfGateFor } from "@/lib/okf-acl";
import { resolveEditAccess } from "@/lib/pages/edit-access";
import { applyBlocksWrite, liveBlocks } from "@/lib/transactions/apply";

export const dynamic = "force-dynamic";

/**
 * The block list API kept for scripts, MCP and older clients. Reads return the
 * page's live blocks; writes are turned into ONE save transaction server-side
 * (docs/save-protocol-target.md §4.7) so they are recorded, idempotent and
 * fanned out exactly like the editor's own saves. The editor itself no longer
 * writes here — it speaks transactions to /api/saveTransactions.
 */

async function readableByUser(pageId: string, userId: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return null;
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, page.workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!membership) return null;
  if (page.restricted && !(await getPagePermission(pageId, userId))) return null;
  return page;
}

async function listBlocks(pageId: string) {
  if (isOkfId(pageId)) {
    const node = readNode(decodeId(pageId));
    if (!node) return null;
    const parsed = node.kind === "page" || node.kind === "row" ? node.blocks : [];
    return parsedToBlocks(parsed, pageId);
  }
  return liveBlocks(pageId);
}

/** GET → { blocks: Block[] } ordered by position (live blocks only) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const auth = await requireAuth();
  if (!("error" in auth)) {
    if (isOkfId(pageId)) {
      const gate = await okfGateFor(auth.user.id);
      if (!gate.canReadId(pageId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const rows = await listBlocks(pageId);
      return rows ? NextResponse.json({ blocks: rows }) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (await readableByUser(pageId, auth.user.id)) {
      const check = await requirePagePermission(pageId, auth.user.id, "view");
      if (check !== true) return check;
      return NextResponse.json({ blocks: await liveBlocks(pageId) });
    }
  }
  // share-token access: any permission level can read
  const share = await validateShareToken(req, pageId);
  if (share) {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page || page.isArchived) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ blocks: await liveBlocks(pageId) });
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** POST → create a single block { type, content, position?, parentBlockId? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const access = await resolveEditAccess(req, pageId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (isOkfId(pageId)) return NextResponse.json({ error: "Use PUT for file pages" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const type: BlockType = body?.type ?? "paragraph";
  const parentBlockId: string | null = body?.parentBlockId ?? null;
  // omitted position = append at the end (agents/API callers rarely track positions)
  let position: number | undefined = body?.position;
  if (position === undefined || position === null) {
    const [{ maxPos }] = await db
      .select({ maxPos: max(blocks.position) })
      .from(blocks)
      .where(and(eq(blocks.pageId, pageId), eq(blocks.alive, true)));
    position = (maxPos ?? 0) + 1;
  }
  const id = crypto.randomUUID();
  const { rejected } = await applyBlocksWrite({
    pageId,
    userId: access.userId,
    workspaceId: access.workspaceId,
    clientId: req.headers.get("x-client-id"),
    userAction: "api.createBlock",
    blocks: [{ id, type, content: body?.content ?? {}, position, parentBlockId }],
    deletedIds: [],
    newIds: [id],
  });
  if (rejected.length) return NextResponse.json({ error: rejected[0].reason }, { status: 500 });
  const [block] = await db.select().from(blocks).where(eq(blocks.id, id)).limit(1);
  return NextResponse.json({ block }, { status: 201 });
}

interface UpsertBlock {
  id?: string;
  type: BlockType;
  content: unknown;
  position: number;
  parentBlockId?: string | null;
}

/**
 * PUT → batch upsert. body: { blocks: UpsertBlock[], deletedIds?: string[], newIds?: string[] }
 * Returns the full ordered live block list after applying, plus `droppedIds`
 * for stale ids the caller held that were deleted elsewhere (see
 * applyBlocksWrite — callers that omit `newIds` keep the legacy insert-fallback).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const access = await resolveEditAccess(req, pageId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => ({}));
  const upserts: UpsertBlock[] = Array.isArray(body?.blocks) ? body.blocks : [];
  const deletedIds: string[] = Array.isArray(body?.deletedIds) ? body.deletedIds : [];
  const newIds: string[] | null = Array.isArray(body?.newIds) ? body.newIds : null;

  const { droppedIds, rejected } = await applyBlocksWrite({
    pageId,
    userId: access.userId,
    workspaceId: access.workspaceId,
    clientId: req.headers.get("x-client-id"),
    userAction: "api.putBlocks",
    blocks: upserts.map((b) => ({ id: b.id, type: b.type ?? "paragraph", content: b.content, position: b.position, parentBlockId: b.parentBlockId ?? null })),
    deletedIds,
    newIds,
  });
  if (rejected.length) return NextResponse.json({ error: rejected[0].reason }, { status: rejected[0].reason === "page not found" ? 404 : 500 });
  const rows = await listBlocks(pageId);
  if (!rows) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ blocks: rows, ...(droppedIds.length ? { droppedIds } : {}) });
}
