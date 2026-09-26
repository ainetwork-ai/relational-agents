/** Pure layout logic for the room chat: which rows start a group, where the
 *  date and "New messages" dividers go, and the time/date labels. No React,
 *  no IO — everything here is decided from its arguments. */
import type { RoomChatMessage } from "./types";

/** Consecutive messages by one author within this window share one header. */
export const GROUP_WINDOW_MS = 5 * 60_000;

export type TimelineItem =
  | { kind: "date"; key: string; iso: string }
  | { kind: "unread"; key: string }
  | {
      kind: "message";
      key: string;
      message: RoomChatMessage;
      groupStart: boolean;
      /** the last message of a private run — where a narrow column explains the lock */
      privateStretchEnd: boolean;
    };

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** Messages (oldest first) → rows with their dividers. A group breaks on a new
 *  day, another author, a gap over GROUP_WINDOW_MS, the unread divider, or a
 *  switch between shared and private — a private stretch always opens with a
 *  header that says so. */
export function buildTimeline(
  messages: RoomChatMessage[],
  firstUnreadId: string | null
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let prev: RoomChatMessage | undefined;
  for (const m of messages) {
    const at = new Date(m.createdAt);
    const newDay = !prev || !sameDay(new Date(prev.createdAt), at);
    if (newDay) items.push({ kind: "date", key: `date-${m.id}`, iso: m.createdAt });
    const unreadHere = m.id === firstUnreadId;
    if (unreadHere) items.push({ kind: "unread", key: `unread-${m.id}` });
    const groupStart =
      newDay ||
      unreadHere ||
      !prev ||
      prev.authorId !== m.authorId ||
      Boolean(prev.privateToUserId) !== Boolean(m.privateToUserId) ||
      at.getTime() - new Date(prev.createdAt).getTime() > GROUP_WINDOW_MS;
    items.push({ kind: "message", key: m.id, message: m, groupStart, privateStretchEnd: false });
    prev = m;
  }
  // a private run ends where the next message is shared, or at the end
  let nextIsPrivate = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "message") continue;
    const isPrivate = Boolean(item.message.privateToUserId);
    item.privateStretchEnd = isPrivate && !nextIsPrivate;
    nextIsPrivate = isPrivate;
  }
  return items;
}

/** The first unread message, from the room's unread count (the sidebar's
 *  /api/dm/rooms figure: others' messages after my last read). Walks back from
 *  the newest until that many of others' messages are passed. Null when there
 *  is nothing unread. */
export function firstUnreadMessageId(
  messages: RoomChatMessage[],
  meId: string | null,
  unreadCount: number
): string | null {
  if (unreadCount <= 0 || !meId) return null;
  let seen = 0;
  let found: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.authorId === meId) continue;
    found = m.id;
    seen += 1;
    if (seen >= unreadCount) break;
  }
  return found;
}

/** The composer prefill for "Ask the agent" about one message: a markdown
 *  quote of it, then an empty line for the question. */
export const QUOTE_MAX_CHARS = 280;
export function quoteForAgent(text: string): string {
  const trimmed = text.trim();
  const clipped =
    trimmed.length > QUOTE_MAX_CHARS ? `${trimmed.slice(0, QUOTE_MAX_CHARS).trimEnd()}…` : trimmed;
  const quoted = clipped
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quoted}\n\n`;
}

/** "2:14 PM" — the group header. */
export function headerTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** "2:14" — the gutter on a continuation row, day period dropped to fit 32px. */
export function gutterTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" })
    .formatToParts(new Date(iso))
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
}

/** "Sat, Sep 26, 1:47 PM" — the date half of a time's tooltip; the year only
 *  when it is not this one. */
export function fullDateTime(iso: string, locale: string, now: Date = new Date()): string {
  const d = new Date(iso);
  return d.toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** "27 min ago" / "3 hours ago" / "yesterday" — the first half of a time's tooltip. */
export function relativeTime(iso: string, locale: string, now: Date = new Date()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  // a clock a little behind the server never says "in 1 minute"
  const seconds = Math.min(0, Math.round((new Date(iso).getTime() - now.getTime()) / 1000));
  const abs = Math.abs(seconds);
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86_400), "day");
}

/** "Saturday, September 26, 2026" — the date divider, always with the year. */
export function dividerDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { dateStyle: "full" });
}

/** The handle "@" inserts for a user — must match dm-view's pickMention. */
export function mentionHandle(user: { isAgent?: boolean; displayName: string }): string {
  return user.isAgent ? "agent" : user.displayName.split(/\s+/)[0];
}

export type TextChunk = { kind: "text"; value: string } | { kind: "mention"; value: string };

/** Splits message text into plain runs and "@handle" mentions of room members.
 *  A mention starts at the text start or after whitespace (so an email's "@"
 *  is not one), matches a known handle case-insensitively, and may be followed
 *  by a non-Latin suffix, such as a Korean particle written right after it. */
export function splitMentions(text: string, handles: ReadonlySet<string>): TextChunk[] {
  const chunks: TextChunk[] = [];
  const known = [...handles].filter(Boolean).sort((a, b) => b.length - a.length);
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const atBoundary = text[i] === "@" && (i === 0 || /\s/.test(text[i - 1]));
    const rest = atBoundary ? text.slice(i + 1).toLowerCase() : "";
    const hit = atBoundary
      ? known.find((h) => rest.startsWith(h.toLowerCase()) && !/[A-Za-z0-9_]/.test(rest[h.length] ?? ""))
      : undefined;
    if (hit) {
      if (plain) chunks.push({ kind: "text", value: plain });
      plain = "";
      chunks.push({ kind: "mention", value: text.slice(i, i + 1 + hit.length) });
      i += 1 + hit.length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain) chunks.push({ kind: "text", value: plain });
  return chunks;
}
