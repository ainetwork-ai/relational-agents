import { db } from "@/lib/db";
import { pageSnapshots, pages, workspaceMembers, type SnapshotBlock } from "@/lib/db/schema";
import { desc, eq, lt, and } from "drizzle-orm";
import { isOkfId } from "@/lib/okf-store";

/** New auto-snapshots are taken at most this often per page. */
const SNAPSHOT_MIN_AGE_MS = 5 * 60 * 1000;
/** History depth per page — oldest beyond this are pruned. */
const MAX_SNAPSHOTS = 50;

/**
 * Capture a page version. Auto mode (force=false) only snapshots when the
 * newest snapshot is older than SNAPSHOT_MIN_AGE_MS (or none exists), so the
 * save path stays cheap; `getState` is only invoked when a snapshot will be
 * written. Restore uses force=true so the pre-restore state is always kept.
 */
export async function maybeSnapshot(
  pageId: string,
  userId: string | null,
  getState: () => Promise<{ title: string; blocks: SnapshotBlock[] }>,
  force = false
): Promise<void> {
  try {
    if (!force) {
      const [latest] = await db
        .select({ createdAt: pageSnapshots.createdAt })
        .from(pageSnapshots)
        .where(eq(pageSnapshots.pageId, pageId))
        .orderBy(desc(pageSnapshots.createdAt))
        .limit(1);
      if (latest && Date.now() - latest.createdAt.getTime() < SNAPSHOT_MIN_AGE_MS) return;
    }
    const { title, blocks } = await getState();
    await db.insert(pageSnapshots).values({ pageId, title, blocks, createdBy: userId });

 // prune history depth
    const [nth] = await db
      .select({ createdAt: pageSnapshots.createdAt })
      .from(pageSnapshots)
      .where(eq(pageSnapshots.pageId, pageId))
      .orderBy(desc(pageSnapshots.createdAt))
      .offset(MAX_SNAPSHOTS - 1)
      .limit(1);
    if (nth) {
      await db
        .delete(pageSnapshots)
        .where(and(eq(pageSnapshots.pageId, pageId), lt(pageSnapshots.createdAt, nth.createdAt)));
    }
  } catch (err) {
 // history must never break saving
    console.error("snapshot failed", err instanceof Error ? err.message : err);
  }
}

/** Strip a live block row down to the persisted snapshot shape. */
export function toSnapshotBlocks(
  rows: Array<{ id: string; type: string; content: unknown; position: number; parentBlockId?: string | null }>
): SnapshotBlock[] {
  return rows.map((b) => ({
    id: b.id,
    type: b.type as SnapshotBlock["type"],
    content: (b.content ?? {}) as SnapshotBlock["content"],
    position: b.position,
    parentBlockId: b.parentBlockId ?? null,
  }));
}

/** Page history is member-only (no share-token access, ). */
export async function pageHistoryAccess(pageId: string, userId: string) {
  if (isOkfId(pageId)) return true; // file-backed: any authenticated member
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return false;
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, page.workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return !!membership;
}
