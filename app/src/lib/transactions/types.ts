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
import type { ItemId, TextItem } from "@/lib/text-crdt/types";
import type { WireJson } from "@/lib/willow/entry";

/** Where a text instance lives inside a block's content: the main text, or one
 * table cell (docs/text-crdt-design.md §2). */
export type TextPath = ["content", "items"] | ["content", "table", "cellItems", number, number];

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
    }
  /**
   * Character-level text operations (docs/text-crdt-design.md §2, §5). Each
   * names the instance it was made against: a wholesale write starts a new
   * instance, and an operation against an old one is refused so the client
   * rebuilds it from the current text (what Notion does after an API replace).
   * A block that has no instance yet adopts the id the first operation brings —
   * both sides build the same items from the same html.
   */
  /** merge items into the instance; refused when an origin is unknown */
  | { command: "insertText"; pointer: { table: "block"; id: string }; path: TextPath; args: { instance: string; items: TextItem[] } }
  /** tombstone `count` characters from each id; unknown ids are skipped */
  | { command: "deleteText"; pointer: { table: "block"; id: string }; path: TextPath; args: { instance: string; ranges: [ItemId, number][] } }
  /**
   * Add a formatting mark over each range (Notion's addAnnotation; `off:true`
   * is removeAnnotation). `key` is the format (`b`,`i`,`u`,`s`,`code`, or an
   * attribute-bearing tag identity), `value` the tag it carries (a link, a
   * colour). Marks are boundary-anchored, so a concurrent insert inside the
   * range inherits the format, and `ts`/`by` resolve overlapping marks by
   * last-writer-wins — the two properties per-character tags could not give.
   */
  | {
      command: "annotate";
      pointer: { table: "block"; id: string };
      path: TextPath;
      args: { instance: string; ranges: [ItemId, number][]; key: string; value?: string; off?: true; ts: number; by: string };
    }
  /** move the items from `from` to the end of this instance into another
   * instance on the same page, ids kept, the first one re-hung on `toOrigin`;
   * refused when `toOrigin` is unknown or the target is on another page */
  | {
      command: "moveTextSlice";
      pointer: { table: "block"; id: string };
      path: TextPath;
      args: { instance: string; from: ItemId; toBlock: string; toPath: TextPath; toInstance: string; toOrigin: ItemId | "start" };
    };

export type TextOperation = Extract<Operation, { command: "insertText" | "deleteText" | "annotate" | "moveTextSlice" }>;
export const isTextOperation = (op: Operation): op is TextOperation =>
  op.command === "insertText" || op.command === "deleteText" || op.command === "annotate" || op.command === "moveTextSlice";

export interface Transaction {
  id: string;
  pageId: string;
  /** client wall clock when the edit was made (ms) */
  timestamp: number;
  debug: { userAction: string; clientCommitTimeMs: number };
  operations: Operation[];
  /** In a teamspace linked to an aindrive drive: the transaction signed by the
   * editing browser's device key as a Willow entry of that drive
   * (docs/willow-ainmem-plan.md Task 6). The entry's payload is what was signed,
   * so the server applies the payload, not the fields around it. */
  signed?: SignedEnvelope;
}

export interface SignedEnvelope {
  /** the aindrive drive whose namespace the entry is in */
  drive: string;
  /** ["ainmem", teamspaceId, pageId, id], payload = the transaction's JSON */
  entry: WireJson;
  /** the device's `_id/cert` entry in the same drive (aindrive's certificate) */
  cert: WireJson;
  /** ainmem's binding of the device key to the signed-in user */
  binding: string;
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
