import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { blocks, pages, transactions as txTable } from "@/lib/db/schema";
import type { Block, BlockContent, BlockType } from "@/lib/db/schema";
import { maybeSnapshot, toSnapshotBlocks } from "@/lib/page-history";
import { scheduleMirror } from "@/lib/md-mirror";
import { notifyMentions } from "@/lib/notifications";
import { publish } from "@/lib/realtime";
import { isOkfId, decodeId, readNode, writePage, parsedToBlocks, blocksToParsed } from "@/lib/okf-store";
import type { Operation, SaveResponse, Transaction } from "./types";

/**
 * Apply save transactions to one page (docs/save-protocol-target.md §4.2).
 *
 * Each transaction is one database transaction: its operations land together
 * or not at all, and its id is recorded in the same commit, so a retry — 5s
 * later, or from the next session after the tab died — finds the id and is
 * answered without a second application. That idempotency is what lets the
 * client resend blindly, which is what lets it never lose an edit.
 */
export async function applyTransactions(opts: {
  pageId: string;
  userId: string | null;
  workspaceId: string | null;
  clientId: string | null;
  transactions: Transaction[];
}): Promise<SaveResponse> {
  const { pageId } = opts;
  const rejected: { id: string; reason: string }[] = [];
  const dropped = new Set<string>();
  const applied: Transaction[] = [];

  if (isOkfId(pageId)) {
    await applyToOkfPage(opts, rejected, applied);
  } else {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page) return { rejected: opts.transactions.map((t) => ({ id: t.id, reason: "page not found" })) };

    // history: the pre-write state, at most every 5 minutes (same as PUT)
    await maybeSnapshot(pageId, opts.userId, async () => {
      const cur = await db.select().from(blocks).where(eq(blocks.pageId, pageId)).orderBy(blocks.position);
      return { title: page.title, blocks: toSnapshotBlocks(cur) };
    });

    for (const t of opts.transactions) {
      if (!Array.isArray(t.operations) || typeof t.id !== "string") {
        rejected.push({ id: String(t?.id), reason: "malformed" });
        continue;
      }
      try {
        const outcome = await db.transaction(async (tx) => {
          const [seen] = await tx.select({ id: txTable.id }).from(txTable).where(eq(txTable.id, t.id)).limit(1);
          if (seen) return "duplicate" as const;
          for (const op of t.operations) {
            if (op.pointer?.table !== "block") throw new Error(`unsupported pointer ${String(op.pointer?.table)}`);
            if (op.command === "set") {
              const a = op.args;
              await tx
                .insert(blocks)
                .values({
                  id: op.pointer.id,
                  pageId,
                  type: a.type,
                  content: normalizeContent(a.type, a.content),
                  parentBlockId: a.parentBlockId ?? null,
                  position: a.position,
                })
                .onConflictDoUpdate({
                  target: blocks.id,
                  set: {
                    type: a.type,
                    content: normalizeContent(a.type, a.content),
                    parentBlockId: a.parentBlockId ?? null,
                    position: a.position,
                    updatedAt: new Date(),
                  },
                  // a block id belongs to one page for life — never let a set
                  // hijack another page's row
                  setWhere: eq(blocks.pageId, pageId),
                });
            } else if (op.command === "update") {
              const a = op.args;
              if (a.alive === false) {
                await tx.delete(blocks).where(and(eq(blocks.id, op.pointer.id), eq(blocks.pageId, pageId)));
                continue;
              }
              const set: Partial<typeof blocks.$inferInsert> = { updatedAt: new Date() };
              if (a.type !== undefined) set.type = a.type;
              if (a.content !== undefined) set.content = normalizeContent(a.type ?? "paragraph", a.content);
              if (a.parentBlockId !== undefined) set.parentBlockId = a.parentBlockId;
              if (a.position !== undefined) set.position = a.position;
              const rows = await tx
                .update(blocks)
                .set(set)
                .where(and(eq(blocks.id, op.pointer.id), eq(blocks.pageId, pageId)))
                .returning({ id: blocks.id });
              // deleted elsewhere while this client still had it: a no-op, and
              // the client is told so it drops the block instead of keeping a
              // ghost that would come back as "new" (the duplicate-page bug)
              if (rows.length === 0) dropped.add(op.pointer.id);
            } else {
              throw new Error(`unknown command ${String((op as { command: string }).command)}`);
            }
          }
          await tx.insert(txTable).values({
            id: t.id,
            pageId,
            userId: opts.userId,
            operations: t.operations,
            userAction: t.debug?.userAction ?? null,
            clientTimestamp: Number.isFinite(t.timestamp) ? new Date(t.timestamp) : null,
          });
          return "applied" as const;
        });
        if (outcome === "applied") applied.push(t);
      } catch (err) {
        rejected.push({ id: t.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    if (applied.length) {
      await db.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, pageId));
      if (opts.userId) {
        for (const t of applied) {
          for (const op of t.operations) {
            const html = op.command === "set" ? op.args.content?.html : op.args.content?.html;
            if (html) await notifyMentions({ html, actorId: opts.userId, pageId, dedupeUnread: true });
          }
        }
      }
      if (opts.workspaceId) scheduleMirror(opts.workspaceId);
    }
  }

  if (applied.length) publish({ type: "blocks", pageId, clientId: opts.clientId, at: Date.now() });
  const out: SaveResponse = {};
  if (rejected.length) out.rejected = rejected;
  if (dropped.size) out.dropped = [...dropped];
  return out;
}

/** File-backed pages: apply the operations to the node's block list in memory
 * and write the page back, recording ids in `transactions` for idempotency. */
async function applyToOkfPage(
  opts: { pageId: string; userId: string | null; transactions: Transaction[] },
  rejected: { id: string; reason: string }[],
  applied: Transaction[]
) {
  const { pageId } = opts;
  const node = readNode(decodeId(pageId));
  if (!node || (node.kind !== "page" && node.kind !== "row")) {
    rejected.push(...opts.transactions.map((t) => ({ id: t.id, reason: "page not found" })));
    return;
  }
  await maybeSnapshot(pageId, opts.userId, async () => ({
    title: node.title,
    blocks: toSnapshotBlocks(parsedToBlocks(node.blocks, pageId)),
  }));
  let list: Block[] = parsedToBlocks(node.blocks, pageId);
  for (const t of opts.transactions) {
    try {
      const [seen] = await db.select({ id: txTable.id }).from(txTable).where(eq(txTable.id, t.id)).limit(1);
      if (seen) continue;
      list = applyToList(list, t.operations, pageId);
      await db.insert(txTable).values({
        id: t.id,
        pageId,
        userId: opts.userId,
        operations: t.operations,
        userAction: t.debug?.userAction ?? null,
        clientTimestamp: Number.isFinite(t.timestamp) ? new Date(t.timestamp) : null,
      });
      applied.push(t);
    } catch (err) {
      rejected.push({ id: t.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  if (applied.length) {
    const ordered = [...list].sort((a, b) => a.position - b.position);
    writePage(
      decodeId(pageId),
      node.title,
      node.meta,
      blocksToParsed(ordered.map((b) => ({ id: b.id, type: b.type, content: b.content as Record<string, unknown>, position: b.position })))
    );
  }
}

function applyToList(list: Block[], ops: Operation[], pageId: string): Block[] {
  let out = list;
  for (const op of ops) {
    if (op.command === "set") {
      const a = op.args;
      const row: Block = {
        id: op.pointer.id,
        pageId,
        type: a.type,
        content: normalizeContent(a.type, a.content),
        parentBlockId: a.parentBlockId ?? null,
        position: a.position,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      out = out.some((b) => b.id === row.id) ? out.map((b) => (b.id === row.id ? row : b)) : [...out, row];
    } else if (op.command === "update") {
      const a = op.args;
      if (a.alive === false) {
        out = out.filter((b) => b.id !== op.pointer.id);
        continue;
      }
      out = out.map((b) =>
        b.id === op.pointer.id
          ? {
              ...b,
              type: a.type ?? b.type,
              content: a.content !== undefined ? normalizeContent(a.type ?? b.type, a.content) : b.content,
              parentBlockId: a.parentBlockId !== undefined ? a.parentBlockId : b.parentBlockId,
              position: a.position ?? b.position,
              updatedAt: new Date(),
            }
          : b
      );
    }
  }
  return out;
}

/** Same coercion the blocks route applies to API callers (bare strings, table
 * cells without the wrapper) so a set/update can never store an odd shape. */
function normalizeContent(type: BlockType, content: unknown): BlockContent {
  if (typeof content === "string") return { text: content };
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (type === "table" && !c.table && Array.isArray(c.cells)) {
      return { table: { cells: c.cells as string[][], headerRow: c.headerRow !== false } };
    }
    return c as BlockContent;
  }
  return {};
}
