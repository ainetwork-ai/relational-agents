import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages, pageShares, workspaceMembers } from "@/lib/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** POST → copy the shared page into the visitor's own workspace ("Duplicate
 *  as template"). Requires login; gated by the link's allowDuplicate. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { token } = await params;

  const [share] = await db
    .select()
    .from(pageShares)
    .where(eq(pageShares.token, token))
    .limit(1);
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (share.expiresAt && share.expiresAt.getTime() < Date.now())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!share.allowDuplicate)
    return NextResponse.json({ error: "Duplicating is disabled" }, { status: 403 });

  const [src] = await db.select().from(pages).where(eq(pages.id, share.pageId)).limit(1);
  if (!src || src.isArchived) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // land the copy in the visitor's first workspace
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, auth.user.id))
    .limit(1);
  if (!membership)
    return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`coalesce(max(${pages.position}), 0)` })
    .from(pages)
    .where(and(eq(pages.workspaceId, membership.workspaceId), isNull(pages.parentPageId)));

  const [copy] = await db
    .insert(pages)
    .values({
      workspaceId: membership.workspaceId,
      parentPageId: null,
      position: Number(maxPos) + 1,
      title: src.title,
      icon: src.icon,
      coverUrl: src.coverUrl,
      createdBy: auth.user.id,
    })
    .returning();

  const srcBlocks = await db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, src.id))
    .orderBy(blocks.position);
  // remap ids so parentBlockId chains stay intact in the copy
  const idMap = new Map<string, string>();
  for (const b of srcBlocks) idMap.set(b.id, randomUUID());
  for (const b of srcBlocks) {
    await db.insert(blocks).values({
      id: idMap.get(b.id)!,
      pageId: copy.id,
      type: b.type,
      content: b.content,
      position: b.position,
      parentBlockId: b.parentBlockId ? (idMap.get(b.parentBlockId) ?? null) : null,
    });
  }

  return NextResponse.json({ pageId: copy.id }, { status: 201 });
}
