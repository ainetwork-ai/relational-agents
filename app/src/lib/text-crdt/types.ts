/**
 * Character-level text CRDT (docs/text-crdt-design.md §1, §12). One block's
 * rich text is a TextInstance: an ordered list of text-only items plus a set
 * of formatting MARKS.
 *
 * Every character ever typed has an id `[clientId, seq]`; deletion leaves a
 * tombstone; ordering follows RGA. Formatting is NOT stored on the character —
 * it is a separate layer of boundary-anchored marks (Notion's model, measured
 * 2026-09-09: `addAnnotation`/`removeAnnotation` with `start`/`end` = an anchor
 * before/after a character, keyed by format). A mark anchored to the character
 * that FOLLOWS a bold word makes text typed at the word's end inherit the bold,
 * and — because two replicas resolve the same marks the same way (last writer
 * wins per character per key) — two tabs that format and type the same span
 * converge. This is what per-character tags could not do.
 */

/** `[clientId, seq]` — seq is a Lamport clock: 1 + the highest seq the client
 * has seen in the instance. Counts UTF-16 code units, like Notion (measured:
 * `😀` advances seq by 2, `漢` by 1) — so `text.length` is the unit throughout. */
export type ItemId = [string, number];

export interface TextItem {
  /** id of the FIRST character; a run of n characters covers seq .. seq+n-1 */
  id: ItemId;
  /** the character immediately left of the first one when it was inserted */
  origin: ItemId | "start";
  /** one or more characters (a run of consecutive seqs by one client), or "\n" for a line break */
  text: string;
  /** the raw void tag when this item is a line break (`<br>` or `<br />`), kept verbatim */
  br?: string;
  deleted?: true;
}

/** A boundary that sits just to one side of a character. Because tombstones are
 * kept, an anchor to a deleted character still resolves — this is why a bold
 * range survives the deletion of the character it was anchored to. */
export type Anchor = { id: ItemId; side: "before" | "after" } | "start" | "end";

/**
 * A formatting mark over a range (Peritext-style). `key` is the format
 * (`b`,`i`,`u`,`s`,`code`,`a`,`color`,`bg`,`mention`,`eq`,…); `value` carries
 * the rest of the tag for the ones that need it (a link's full open tag, a
 * colour name, a mention's span). `start` excludes text inserted to its left,
 * `end` (anchored before the following character) includes text appended at
 * the range's right edge — the measured Notion behaviour.
 */
export interface Mark {
  key: string;
  value?: string;
  start: Anchor;
  end: Anchor;
  /** Lamport timestamp for last-writer-wins between overlapping marks of the
   * same key on the same character. Migration marks use 0 so any edit wins. */
  ts: number;
  /** clientId, the tie-break when two marks share a ts */
  by: string;
  /** an un-format (Notion's removeAnnotation): it competes by ts like any mark,
   * and when it wins the character simply has no format for that key */
  off?: true;
}

export interface TextInstance {
  /** changes when the text is replaced wholesale (a server-side write); operations
   * carry the instance they were made against and are refused on a mismatch */
  instance: string;
  items: TextItem[];
  /** formatting layer; absent/[] means unformatted */
  marks?: Mark[];
}

export const sameId = (a: ItemId | "start", b: ItemId | "start") =>
  a === b || (a !== "start" && b !== "start" && a[0] === b[0] && a[1] === b[1]);

/** RGA tie-break for siblings with the same origin: higher seq first, then
 * the lexically greater client. Deterministic on every replica. */
export function precedes(a: ItemId, b: ItemId): boolean {
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[0] > b[0];
}

/** Fixed nesting order so rendered html is canonical (outermost first). A mark
 * whose key is not listed sorts after the listed ones, then by key string. */
const KEY_ORDER = ["color", "bg", "b", "i", "u", "s", "code", "a", "mention", "eq"];
export function markOrder(key: string): number {
  const i = KEY_ORDER.indexOf(key);
  return i < 0 ? KEY_ORDER.length : i;
}
