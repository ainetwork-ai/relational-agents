/**
 * Mention (@) people search — exactly the rules measured on the original.
 * Measurements: docs/notion-comment-mention.md §1·§2 (2026-09-10, 23 queries in Notion's comment input).
 *
 * Summary:
 *  · Matches display name and **email** together, as a substring, case-insensitively.
 *  · Hangul also matches by **initial consonants** (choseong: a lone initial jamo finds every name starting with it).
 *  · Order: start of name > start of a word > middle. Within a tier, me first, guests last.
 *  · Up to 5 are shown; the rest fold into one `Show N more results` line.
 *
 * Pure functions only — the server (checking who gets notified) and the client (the menu) must give the same answer.
 */

import { HANGUL_LEAD_JAMO } from "@/i18n/content/editor";

export interface MentionPerson {
  id: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
  isAgent?: boolean;
  /** Workspace role. "guest" is pushed back within a tier (the original also badges them `Guest` and puts them below). */
  role?: string | null;
}

/** How many people the original shows in one section. Overflow becomes `Show N more results`. */
export const PEOPLE_SHOWN = 5;

const LEAD = HANGUL_LEAD_JAMO;

/** Hangul syllables to their initial consonant, everything else unchanged
 *  (a three-syllable name becomes its three initial jamo). */
export function leadJamo(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      out += LEAD[Math.floor((code - 0xac00) / 588)];
    } else {
      out += ch;
    }
  }
  return out;
}

/** Is the query made only of initial consonants (one or more compatibility
 *  jamo U+3131–U+314E)? Only then is initial-jamo search turned on. */
export function isJamoQuery(q: string): boolean {
  return q.length > 0 && /^[\u3131-\u314e]+$/.test(q);
}

/** 0 = start of the string, 1 = start of a word, 2 = middle, -1 = no match. Lower sorts higher. */
export function matchRank(haystack: string, needle: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  const i = h.indexOf(n);
  if (i < 0) return -1;
  if (i === 0) return 0;
 // start of a word: after whitespace, and also after common separators (., _, -, @)
  return /[\s._\-@]/.test(h[i - 1]) ? 1 : 2;
}

/** Penalty when only the email matched. The measurements do not say whether name beats email,
 *  so the **visible side (the name)** goes first. 0.5 so it does not cost a whole tier. */
const EMAIL_PENALTY = 0.5;

/** Guest penalty. In the measurements (§2) a guest's prefix match ranked below a member's prefix
 *  match but above a member's middle match — a penalty of exactly one tier.
 *    `kim`  → KimSan(member·0) · Minhyun Kim(member·1) · Bansuk Kim(member·1) · KimGloria(guest·0+1) …
 *    `hy`   → …prefix members… · a guest matched by email (0+0.5+1) · Minhyun Kim(member·middle 2) */
const GUEST_PENALTY = 1;

/**
 * One person's score — **lower is higher**. -1 when there is no match.
 *
 * Looks at both name and email (§2); the name wins at the same position, and guests
 * drop one tier. For an initial-jamo query it also matches the name's initial jamo.
 */
export function personRank(p: MentionPerson, query: string): number {
  const q = query.trim();
  const guest = p.role === "guest" ? GUEST_PENALTY : 0;
  if (!q) return guest;

  let best = -1;
  const consider = (r: number, penalty: number) => {
    if (r < 0) return;
    const score = r + penalty;
    if (best < 0 || score < best) best = score;
  };
  consider(matchRank(p.displayName ?? "", q), 0);
  consider(matchRank(p.email ?? "", q), EMAIL_PENALTY);
  if (isJamoQuery(q)) consider(matchRank(leadJamo(p.displayName ?? ""), q), 0);

  return best < 0 ? -1 : best + guest;
}

export interface RankedPeople {
  /** The people drawn on screen (at most PEOPLE_SHOWN). */
  shown: MentionPerson[];
  /** The N of `Show N more results`. 0 means that line is absent. */
  more: number;
  /** Everyone before folding. Clicking `Show more` draws all of them. */
  all: MentionPerson[];
}

/**
 * Sorts in the original's order and cuts at 5.
 *
 * `meId` is "me" — it rises within its tier (the original appends `(me)` to the name).
 * Not excluding yourself also matches the original: Notion shows you on the first row of the `@` list.
 */
export function rankPeople(
  people: MentionPerson[],
  query: string,
  meId?: string | null,
  limit: number = PEOPLE_SHOWN
): RankedPeople {
  const scored = people
    .map((p, i) => ({ p, i, rank: personRank(p, query) }))
    .filter((e) => e.rank >= 0);

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
   // Within the same score: me first, then members, then the original order.
   // (The guest penalty is already in the score — this comparison only breaks ties.)
    const aMe = meId != null && a.p.id === meId ? 0 : 1;
    const bMe = meId != null && b.p.id === meId ? 0 : 1;
    if (aMe !== bMe) return aMe - bMe;
    const aGuest = a.p.role === "guest" ? 1 : 0;
    const bGuest = b.p.role === "guest" ? 1 : 0;
    if (aGuest !== bGuest) return aGuest - bGuest;
    return a.i - b.i;
  });

  const all = scored.map((e) => e.p);
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit), all };
}

/* ────────────────────────────────────────────────────────────────────────── */

export interface MentionQuery {
  /** Index of the opening `@`. */
  at: number;
  /** From after the `@` up to the caret — **may contain spaces**. */
  query: string;
}

/**
 * The mention query that should be open at the caret, or null.
 *
 * Measured rules (§1):
 *  · Word boundaries do not matter — `x@` opens it too.
 *  · **Only a space right after `@`** cancels (`@ ` → closed).
 *  · Later spaces are part of the query — `@hyeon jeong` stays open and keeps searching.
 *    (Our block editor currently closes on any space; that is where it differs from the original.)
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
 // caret 0 must be null. `lastIndexOf("@", -1)` clamps a negative fromIndex to 0
 // and matches index 0, so with the caret **before** a leading `@` the menu opened
 // on an empty query and Enter inserted a mention into the middle of the draft.
  if (caret <= 0 || caret > text.length) return null;
  const at = text.lastIndexOf("@", caret - 1);
  if (at < 0) return null;
  const query = text.slice(at + 1, caret);
  if (/^[\s\u00a0]/.test(query)) return null; // `@ ` — a space right after cancels
  if (query.includes("\n")) return null;
 // An email address is not a mention. The original opens the menu even on `x@` (§1 T2), but
 // we also search emails (§2), so typing `ping hyeonjj@comcom.ai` matched every member of the
 // company and Enter replaced the address with a name — silently breaking the message.
 // Close **only when the character before is alphanumeric and the query has a dot**: that is the
 // shape of an email; any other `x@name` opens as in the original. This repo's chat mentions
 // make the same call for the same reason.
  const before = at > 0 ? text[at - 1] : "";
  if (/[A-Za-z0-9._+-]/.test(before) && query.includes(".")) return null;
  return { at, query };
}

/**
 * An inserted mention is **one unit** — the original's token is `contenteditable="false"`,
 * so a single Backspace removes the whole thing (§5). To mimic that in a plain-text input
 * we have to ask "is the text right before the caret an inserted `@name`?".
 *
 * Longest names first — if both `@Kim` and `@Kim San` exist, the longer one is right.
 */
export function mentionRunBefore(
  text: string,
  caret: number,
  labels: string[]
): { start: number; end: number; label: string } | null {
  const head = text.slice(0, caret);
  let best: { start: number; end: number; label: string } | null = null;
  for (const label of labels) {
    const token = `@${label}`;
    if (!head.endsWith(token)) continue;
    if (best && best.label.length >= label.length) continue;
    best = { start: caret - token.length, end: caret, label };
  }
  return best;
}
