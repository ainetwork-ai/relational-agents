/**
 * Save protocol (docs/save-protocol-target.md §2–4).
 *
 * An edit is a TRANSACTION of OPERATIONS on single block records — never the
 * whole page. The client stores a transaction in IndexedDB before sending it
 * and deletes it when the server acknowledges; the server applies each
 * transaction atomically and exactly once (by id), then fans the applied
 * transactions out to the page's other clients over SSE. Shared by the
 * editor, the queue, the routes and the realtime layer, so the wire shape
 * lives here and nowhere else.
 */
import type { BlockContent, BlockType } from "@/lib/db/schema";

/** Fields a block record carries on the wire. Deletion is `alive:false`. */
export interface BlockRecord {
  id: string;
  type: BlockType;
  content: BlockContent;
  parentBlockId: string | null;
  position: number;
}

export type Operation =
  /** create, or replace the whole record when it already exists (and revive it) */
  | { command: "set"; pointer: { table: "block"; id: string }; path: []; args: BlockRecord }
  /** last-writer-wins on the given fields; `alive:false` deletes, `alive:true` revives */
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

/** POST /api/saveTransactions — one request carries transactions for any pages */
export interface SaveRequest {
  requestId: string;
  transactions: Transaction[];
}

/** 200: `{}` — like Notion, the body says nothing; the state the client sent
 * is the state, and everyone else hears about it over SSE. */
export type SaveResponse = Record<string, never>;

/** 4xx: the request could not be honoured in full. `rejectedIds` names the
 * transactions that will never apply (no edit right on their page, malformed);
 * the client drops those and tells the user. Transactions not named were
 * applied or are duplicates. (Not measured in Notion — only its `{}` was.) */
export interface SaveError {
  errorId: string;
  name: "UnauthorizedError" | "ValidationError";
  message: string;
  rejectedIds?: string[];
}
