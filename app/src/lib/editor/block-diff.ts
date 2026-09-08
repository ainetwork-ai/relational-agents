/**
 * Turn "the block list before and after one edit" into the operations that
 * describe the edit (docs/save-protocol-target.md §2). Pure, so it can be
 * checked without a browser.
 *
 * Positions are fractional midpoints (see positionAfter in the editor), so an
 * insert touches one block, not its neighbours — a typical edit is 1–3 ops.
 */
import type { BlockRecord, Operation } from "@/lib/transactions/types";

export interface DiffableBlock extends BlockRecord {
  version?: number;
}

type UpdateArgs = Extract<Operation, { command: "update" }>["args"];

const sameContent = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffBlocks(prev: DiffableBlock[], next: DiffableBlock[]): Operation[] {
  const ops: Operation[] = [];
  const prevById = new Map(prev.map((b) => [b.id, b]));
  const nextIds = new Set<string>();
  for (const b of next) {
    nextIds.add(b.id);
    const old = prevById.get(b.id);
    if (!old) {
      ops.push({
        command: "set",
        pointer: { table: "block", id: b.id },
        path: [],
        args: { id: b.id, type: b.type, content: b.content, parentBlockId: b.parentBlockId ?? null, position: b.position },
      });
      continue;
    }
    const args: UpdateArgs = {};
    if (old.type !== b.type) args.type = b.type;
    if (!sameContent(old.content, b.content)) args.content = b.content;
    if ((old.parentBlockId ?? null) !== (b.parentBlockId ?? null)) args.parentBlockId = b.parentBlockId ?? null;
    if (old.position !== b.position) args.position = b.position;
    if (Object.keys(args).length) ops.push({ command: "update", pointer: { table: "block", id: b.id }, path: [], args });
  }
  for (const b of prev) {
    if (!nextIds.has(b.id)) ops.push({ command: "update", pointer: { table: "block", id: b.id }, path: [], args: { alive: false } });
  }
  return ops;
}
