import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { blocks, pages, transactions as txTable } from "@/lib/db/schema";
import type { Block, BlockContent, BlockType } from "@/lib/db/schema";
import { maybeSnapshot, toSnapshotBlocks } from "@/lib/page-history";
import { scheduleMirror } from "@/lib/md-mirror";
import { notifyMentions } from "@/lib/notifications";
import { publish } from "@/lib/realtime";
import { isOkfId, decodeId, readNode, writePage, parsedToBlocks, blocksToParsed } from "@/lib/okf-store";
import { isTextOperation, type Operation, type Transaction } from "./types";
import { withTextInstance } from "@/lib/text-crdt/content";
import { applyMoveTextSlice, applyTextOp } from "@/lib/text-crdt/ops";
import { renderHtml } from "@/lib/text-crdt/html";

/**
 * Apply save transactions to one page (docs/save-protocol-target.md §4.2).
 *
 * Each transaction is one database transaction: its operations land together
 * or not at all, and its id is recorded in the same commit, so a retry — 5s
 * later, or from the next session after the tab died — finds the id and is
 * answered without a second application. Deletion is `alive=false`, so a
 * late `update` to a block someone else removed lands on a row (and stays
 * invisible) instead of vanishing, and undo can bring the block back by id.
 *
 * Afterwards the applied transactions themselves go out over SSE; the other
 * clients apply the same operations instead of refetching the page.
 */
export interface ApplyResult {
  applied: Transaction[];
  rejected: { id: string; reason: string }[];
}

export async function applyTransactions(opts: {
  pageId: string;
  userId: string | null;
  workspaceId: string | null;
  clientId: string | null;
  transactions: Transaction[];
}): Promise<ApplyResult> {
  const { pageId } = opts;
  const rejected: ApplyResult["rejected"] = [];
  const applied: Transaction[] = [];

  if (isOkfId(pageId)) {
    await applyToOkfPage(opts, rejected, applied);
  } else {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page) return { applied, rejected: opts.transactions.map((t) => ({ id: t.id, reason: "page not found" })) };

    // history: the pre-write state, at most every 5 minutes
    await maybeSnapshot(pageId, opts.userId, async () => {
      const cur = await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.pageId, pageId), eq(blocks.alive, true)))
        .orderBy(blocks.position);
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
              const content = normalizeContent(a.type, a.content);
              await tx
                .insert(blocks)
                .values({
                  id: op.pointer.id,
                  pageId,
                  type: a.type,
                  content,
                  parentBlockId: a.parentBlockId ?? null,
                  position: a.position,
                  alive: true,
                })
                .onConflictDoUpdate({
                  target: blocks.id,
                  set: { type: a.type, content, parentBlockId: a.parentBlockId ?? null, position: a.position, alive: true, updatedAt: new Date() },
                  // a block id belongs to one page for life — never let a set
                  // hijack another page's row
                  setWhere: eq(blocks.pageId, pageId),
                });
            } else if (op.command === "update") {
              const a = op.args;
              const set: Partial<typeof blocks.$inferInsert> = { updatedAt: new Date() };
              if (a.type !== undefined) set.type = a.type;
              if (a.content !== undefined) set.content = normalizeContent(a.type ?? "paragraph", a.content);
              if (a.parentBlockId !== undefined) set.parentBlockId = a.parentBlockId;
              if (a.position !== undefined) set.position = a.position;
              if (a.alive !== undefined) set.alive = a.alive;
              // applies to dead rows too: a revive is `alive:true`, and a late
              // edit to a block deleted elsewhere is simply invisible
              await tx.update(blocks).set(set).where(and(eq(blocks.id, op.pointer.id), eq(blocks.pageId, pageId)));
            } else if (isTextOperation(op)) {
              // stage 3 step ②: character-level operations on one block's text
              // (or two blocks for a slice move), validated against the
              // instance they name; the html/text cache is regenerated
              const [row] = await tx
                .select({ id: blocks.id, content: blocks.content })
                .from(blocks)
                .where(and(eq(blocks.id, op.pointer.id), eq(blocks.pageId, pageId)))
                .limit(1);
              if (!row) throw new Error(`block not found ${op.pointer.id}`);
              if (op.command === "moveTextSlice") {
                const sameBlock = op.args.toBlock === op.pointer.id;
                let target: { id: string; content: BlockContent } | null = null;
                if (!sameBlock) {
                  const [t] = await tx
                    .select({ id: blocks.id, content: blocks.content })
                    .from(blocks)
                    .where(and(eq(blocks.id, op.args.toBlock), eq(blocks.pageId, pageId)))
                    .limit(1);
                  if (!t) throw new Error(`moveTextSlice: target ${op.args.toBlock} is not on this page`);
                  target = t;
                }
                const out = applyMoveTextSlice(row.content, target?.content ?? null, op);
                await tx.update(blocks).set({ content: out.source, updatedAt: new Date() }).where(eq(blocks.id, row.id));
                if (target) await tx.update(blocks).set({ content: out.target, updatedAt: new Date() }).where(eq(blocks.id, target.id));
              } else {
                const content = applyTextOp(row.content, op);
                await tx.update(blocks).set({ content, updatedAt: new Date() }).where(eq(blocks.id, row.id));
              }
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
            // a mention arrives either in a wholesale content write or inside
            // the tags of inserted items (`<a class="mention" …>`)
            const html = isTextOperation(op)
              ? op.command === "insertText"
                ? renderHtml(op.args.items)
                : undefined
              : op.args.content?.html;
            if (html) await notifyMentions({ html, actorId: opts.userId, pageId, dedupeUnread: true });
          }
        }
      }
      if (opts.workspaceId) scheduleMirror(opts.workspaceId);
    }
  }

  if (applied.length) {
    publish({ type: "transactions", pageId, clientId: opts.clientId, at: Date.now(), transactions: applied });
  }
  return { applied, rejected };
}

/**
 * The legacy whole-list write (`PUT /blocks` from scripts, MCP and older
 * clients): upsert what was sent, delete `deletedIds`. Expressed as ONE
 * transaction so it takes the same path, is recorded, and fans out the same
 * way. The v2 rule stays: an id that is not on the page (alive) and was not
 * declared new is a stale copy of something deleted elsewhere — it is dropped
 * rather than resurrected (the duplicate-page bug), and reported back.
 */
export async function applyBlocksWrite(opts: {
  pageId: string;
  userId: string | null;
  workspaceId: string | null;
  clientId: string | null;
  userAction: string;
  blocks: Array<{ id?: string; type: BlockType; content: unknown; position: number; parentBlockId?: string | null }>;
  deletedIds: string[];
  /** ids the caller created; `null` = legacy caller, insert anything unknown */
  newIds: string[] | null;
}): Promise<{ droppedIds: string[]; rejected: ApplyResult["rejected"] }> {
  const { pageId } = opts;
  const droppedIds: string[] = [];
  let aliveIds = new Set<string>();
  if (!isOkfId(pageId) && opts.newIds) {
    const ids = opts.blocks.map((b) => b.id).filter((x): x is string => typeof x === "string");
    if (ids.length) {
      const rows = await db
        .select({ id: blocks.id })
        .from(blocks)
        .where(and(eq(blocks.pageId, pageId), eq(blocks.alive, true), inArray(blocks.id, ids)));
      aliveIds = new Set(rows.map((r) => r.id));
    }
  }
  const newIdSet = opts.newIds ? new Set(opts.newIds) : null;
  const operations: Operation[] = [];
  for (const b of opts.blocks) {
    const id = b.id ?? crypto.randomUUID();
    if (b.id && newIdSet && !aliveIds.has(b.id) && !newIdSet.has(b.id)) {
      droppedIds.push(b.id);
      continue;
    }
    operations.push({
      command: "set",
      pointer: { table: "block", id },
      path: [],
      args: { id, type: b.type, content: normalizeContent(b.type, b.content), parentBlockId: b.parentBlockId ?? null, position: b.position },
    });
  }
  for (const id of opts.deletedIds) {
    operations.push({ command: "update", pointer: { table: "block", id }, path: [], args: { alive: false } });
  }
  if (operations.length === 0) return { droppedIds, rejected: [] };
  const { rejected } = await applyTransactions({
    pageId,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    clientId: opts.clientId,
    transactions: [
      {
        id: crypto.randomUUID(),
        pageId,
        timestamp: Date.now(),
        debug: { userAction: opts.userAction, clientCommitTimeMs: Date.now() },
        operations,
      },
    ],
  });
  return { droppedIds, rejected };
}

/** The page's live blocks in order — the one read every route should use. */
export async function liveBlocks(pageId: string): Promise<Block[]> {
  return db
    .select()
    .from(blocks)
    .where(and(eq(blocks.pageId, pageId), eq(blocks.alive, true)))
    .orderBy(blocks.position);
}

/** File-backed pages: apply the operations to the node's block list in memory
 * and write the page back, recording ids in `transactions` for idempotency.
 * The file has no tombstones — `alive:false` removes the block from the file. */
async function applyToOkfPage(
  opts: { pageId: string; userId: string | null; transactions: Transaction[] },
  rejected: ApplyResult["rejected"],
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
        alive: true,
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
    } else if (isTextOperation(op)) {
      const src = out.find((b) => b.id === op.pointer.id);
      if (!src) throw new Error(`block not found ${op.pointer.id}`);
      if (op.command === "moveTextSlice") {
        const sameBlock = op.args.toBlock === op.pointer.id;
        const dst = sameBlock ? null : out.find((b) => b.id === op.args.toBlock);
        if (!sameBlock && !dst) throw new Error(`moveTextSlice: target ${op.args.toBlock} is not on this page`);
        const r = applyMoveTextSlice(src.content, dst?.content ?? null, op);
        out = out.map((b) =>
          b.id === src.id ? { ...b, content: r.source, updatedAt: new Date() } : dst && b.id === dst.id ? { ...b, content: r.target, updatedAt: new Date() } : b
        );
      } else {
        const content = applyTextOp(src.content, op);
        out = out.map((b) => (b.id === src.id ? { ...b, content, updatedAt: new Date() } : b));
      }
    } else {
      throw new Error(`unknown command ${String((op as { command: string }).command)}`);
    }
  }
  return out;
}

/** Same coercion the blocks route applies to API callers (bare strings, table
 * cells without the wrapper) so a set/update can never store an odd shape —
 * and, since stage 3 step ①, the text CRDT instance the content describes:
 * a wholesale text write starts a new instance rebuilt from its html (what
 * Notion does on an API-style replace), a client that speaks items keeps them
 * and the html/text cache is regenerated from them. */
export function normalizeContent(type: BlockType, content: unknown): BlockContent {
  let c: BlockContent;
  if (typeof content === "string") c = { text: content };
  else if (content && typeof content === "object") {
    const o = content as Record<string, unknown>;
    c = type === "table" && !o.table && Array.isArray(o.cells)
      ? { table: { cells: o.cells as string[][], headerRow: o.headerRow !== false } }
      : (o as BlockContent);
  } else c = {};
  return withTextInstance(c);
}
