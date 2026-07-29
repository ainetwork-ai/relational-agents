import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pageSnapshots, pages } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { publish } from "@/lib/realtime";
import { scheduleMirror } from "@/lib/md-mirror";
import { maybeSnapshot, toSnapshotBlocks, pageHistoryAccess } from "@/lib/page-history";
import {
  isOkfId,
  decodeId,
  readNode,
  writePage,
  parsedToBlocks,
  blocksToParsed,
  type IncomingBlock,
} from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** POST → restore this snapshot. The current state is snapshotted first so a
 * restore is always undoable from the history list. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string; snapshotId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId, snapshotId } = await params;
  if (!(await pageHistoryAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [snap] = await db
    .select()
    .from(pageSnapshots)
    .where(and(eq(pageSnapshots.id, snapshotId), eq(pageSnapshots.pageId, pageId)))
    .limit(1);
  if (!snap) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (isOkfId(pageId)) {
    const node = readNode(decodeId(pageId));
    if (!node || (node.kind !== "page" && node.kind !== "row"))
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    await maybeSnapshot(
      pageId,
      auth.user.id,
      async () => ({
        title: node.title,
        blocks: toSnapshotBlocks(parsedToBlocks(node.blocks, pageId)),
      }),
      true
    );
    const parsed = blocksToParsed(snap.blocks as IncomingBlock[]);
    writePage(decodeId(pageId), snap.title || node.title, node.meta, parsed);
  } else {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await maybeSnapshot(
      pageId,
      auth.user.id,
      async () => {
        const cur = await db
          .select()
          .from(blocks)
          .where(eq(blocks.pageId, pageId))
          .orderBy(blocks.position);
        return { title: page.title, blocks: toSnapshotBlocks(cur) };
      },
      true
    );
 // replace blocks wholesale, keeping snapshot block ids so block comments
 // and anchors keep resolving
    await db.delete(blocks).where(eq(blocks.pageId, pageId));
    for (const b of snap.blocks) {
      await db.insert(blocks).values({
        id: b.id,
        pageId,
        type: b.type,
        content: b.content,
        position: b.position,
        parentBlockId: b.parentBlockId ?? null,
      });
    }
    await db
      .update(pages)
      .set({ title: snap.title || page.title, updatedAt: new Date() })
      .where(eq(pages.id, pageId));
    scheduleMirror(page.workspaceId);
  }

  publish({
    type: "blocks",
    pageId,
    clientId: req.headers.get("x-client-id"),
    at: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
