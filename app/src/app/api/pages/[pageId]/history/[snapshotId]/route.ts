import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pageSnapshots, pages } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { publish } from "@/lib/realtime";
import { maybeSnapshot, toSnapshotBlocks, pageHistoryAccess } from "@/lib/page-history";
import { applyTransactions } from "@/lib/transactions/apply";
import type { Operation } from "@/lib/transactions/types";
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
          .where(and(eq(blocks.pageId, pageId), eq(blocks.alive, true)))
          .orderBy(blocks.position);
        return { title: page.title, blocks: toSnapshotBlocks(cur) };
      },
      true
    );
 // Restore = one transaction: set every snapshot block (same ids, so block
 // comments and anchors keep resolving; dead rows come back alive) and mark
 // what the snapshot does not have as not alive. Same path as any other save —
 // recorded, idempotent, fanned out as operations to the page's other tabs.
    const live = await db
      .select({ id: blocks.id })
      .from(blocks)
      .where(and(eq(blocks.pageId, pageId), eq(blocks.alive, true)));
    const keep = new Set(snap.blocks.map((b) => b.id));
    const operations: Operation[] = snap.blocks.map((b) => ({
      command: "set" as const,
      pointer: { table: "block" as const, id: b.id },
      path: [] as [],
      args: { id: b.id, type: b.type, content: b.content, parentBlockId: b.parentBlockId ?? null, position: b.position },
    }));
    for (const b of live) {
      if (!keep.has(b.id)) operations.push({ command: "update", pointer: { table: "block", id: b.id }, path: [], args: { alive: false } });
    }
    const { rejected } = await applyTransactions({
      pageId,
      userId: auth.user.id,
      workspaceId: page.workspaceId,
      clientId: req.headers.get("x-client-id"),
      transactions: [
        {
          id: crypto.randomUUID(),
          pageId,
          timestamp: Date.now(),
          debug: { userAction: "history.restore", clientCommitTimeMs: Date.now() },
          operations,
        },
      ],
    });
    if (rejected.length) return NextResponse.json({ error: rejected[0].reason }, { status: 500 });
    await db
      .update(pages)
      .set({ title: snap.title || page.title, updatedAt: new Date() })
      .where(eq(pages.id, pageId));
    publish({ type: "page", pageId, clientId: req.headers.get("x-client-id"), at: Date.now() });
    return NextResponse.json({ ok: true });
  }

  publish({
    type: "blocks",
    pageId,
    clientId: req.headers.get("x-client-id"),
    at: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
