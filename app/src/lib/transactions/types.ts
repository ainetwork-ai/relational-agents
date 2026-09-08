/**
 * Save protocol, stage 1 (docs/save-protocol-target.md §2–3, §9).
 *
 * An edit is a TRANSACTION of OPERATIONS on single block records — never the
 * whole page. The client stores a transaction in IndexedDB before sending it
 * and deletes it when the server acknowledges; the server applies each
 * transaction atomically and exactly once (by id). Shared by the editor, the
 * queue and the route, so the wire shape lives here and nowhere else.
 */
import type { BlockContent, BlockType } from "@/lib/db/schema";

/** Fields a block record carries on the wire. `alive:false` is deletion. */
export interface BlockRecord {
  id: string;
  type: BlockType;
  content: BlockContent;
  parentBlockId: string | null;
  position: number;
}

export type Operation =
  /** create, or replace the whole record when it already exists */
  | { command: "set"; pointer: { table: "block"; id: string }; path: []; args: BlockRecord }
  /** last-writer-wins on the given fields; `alive:false` deletes */
  | {
      command: "update";
      pointer: { table: "block"; id: string };
      path: [];
      args: Partial<Omit<BlockRecord, "id">> & { alive?: boolean };
    };

export interface Transaction {
  id: string;
  pageId: string;
  /** client wall clock when the edit was made (ms) */
  timestamp: number;
  debug: { userAction: string; clientCommitTimeMs: number };
  operations: Operation[];
}

export interface SaveRequest {
  requestId: string;
  transactions: Transaction[];
}

export interface SaveResponse {
  /** transactions the server refused — the client drops them and tells the user */
  rejected?: { id: string; reason: string }[];
  /** `update`s on blocks that no longer exist (deleted elsewhere) — the client
   * should resync that page so the block disappears locally too */
  dropped?: string[];
}
