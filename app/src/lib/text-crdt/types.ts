/**
 * Character-level text CRDT (docs/text-crdt-design.md §1). One block's rich
 * text is a TextInstance: an ordered list of items. Every character ever
 * typed has an id `[clientId, seq]`; deletion leaves a tombstone; ordering
 * follows RGA so any two replicas that saw the same operations show the same
 * text — the property Notion showed when two tabs typed into one block.
 *
 * Formatting is the exact stack of open tags around a character, as the
 * sanitizer emits them (`<b>`, `<a href="…" class="mention" …>`), so the
 * rendered html is byte-for-byte what `sanitizeInline` produced and what the
 * rest of the app already stores as `content.html`.
 */

/** `[clientId, seq]` — seq is a Lamport clock: a client stamps a new item with
 * 1 + the highest seq it has seen in the instance (any client), so a fresh
 * insert always outranks the older siblings at its origin and lands right after
 * it; only truly concurrent inserts fall back to the tie-break below. The pair
 * is globally unique because a client never reuses a seq. */
export type ItemId = [string, number];

export interface TextItem {
  /** id of the FIRST character; a run of n characters covers seq .. seq+n-1 */
  id: ItemId;
  /** the character immediately left of the first one when it was inserted */
  origin: ItemId | "start";
  /** one or more characters (a run of consecutive seqs by one client), or "\n" for a line break */
  text: string;
  /** open tags around this text, outermost first, exactly as sanitized */
  tags: string[];
  /** the raw void tag when this item is a line break (`<br>` or `<br />`), kept verbatim */
  br?: string;
  deleted?: true;
}

export interface TextInstance {
  /** changes when the text is replaced wholesale (a server-side write); operations
   * carry the instance they were made against and are refused on a mismatch */
  instance: string;
  items: TextItem[];
}

export const sameId = (a: ItemId | "start", b: ItemId | "start") =>
  a === b || (a !== "start" && b !== "start" && a[0] === b[0] && a[1] === b[1]);

/** RGA tie-break for siblings with the same origin: higher seq first, then
 * the lexically greater client. Deterministic on every replica. */
export function precedes(a: ItemId, b: ItemId): boolean {
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[0] > b[0];
}
