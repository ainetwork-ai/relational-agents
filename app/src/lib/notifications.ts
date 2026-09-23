import "server-only";
import { db } from "@/lib/db";
import { notifications, pages, users, workspaceMembers } from "@/lib/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getPagePermission, hasPermission } from "@/lib/auth/share-token";
import { isOkfId } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";

/**
 * Inbox notification pipeline (server-side). Two collaboration signals feed it:
 * - PERSON @-mentions inside saved block HTML or a comment body
 * - a new comment on a page (its other participants get pinged)
 *
 * A mention chip is inline HTML: <span|a … data-mention-type="person"
 * data-mention-id="<userId>">. We pull the recipient user id straight off the
 * chip, independent of attribute order, so the scan is general to any content.
 *
 * COMMENT bodies are the exception: they are stored as plain text, so there is
 * no chip to scan. The comment route sends the mentioned ids alongside the body
 * (notifyMentionIds) after checking each one against the page's access gate.
 * Both paths write the same row through the same insertMentions.
 */

/** All distinct user ids referenced by a person @-mention chip in `html`. */
export function extractPersonMentionIds(html: string | undefined | null): string[] {
  if (!html) return [];
  const ids = new Set<string>();
 // Look at each tag that carries any mention marker, then keep the person ones.
  for (const tag of html.match(/<[^>]*data-mention[^>]*>/gi) ?? []) {
    if (!/data-mention-type="person"/i.test(tag)) continue;
    const m = tag.match(/data-mention-id="([^"]+)"/i);
    if (m?.[1]) ids.add(m[1]);
  }
  return [...ids];
}

export interface MentionNotifyOpts {
  actorId: string;
  pageId: string;
  commentId?: string | null;
  body?: string;
  dedupeUnread?: boolean;
}

/**
 * Narrow would-be recipients to the ones who may actually READ the page.
 *
 * **The gate lives here, not in the callers.** The recipient of a mention is
 * chosen by whoever wrote the content, and on the block-save path that means it
 * comes out of client HTML: `extractPersonMentionIds` will happily return any
 * user id someone pastes into a `data-mention-id`. Ungated, that let any signed
 * -in user drop an unread notification carrying text of their choosing into any
 * other user's inbox (reproduced on dev, 2026-09-10). Putting the check inside
 * insertMentions means no present or future caller can forget it.
 *
 * Same rule the page itself uses: `getPagePermission` ≥ view, and the OKF path
 * ACL for file-backed pages, which have no `pages` row to ask about.
 */
export async function mentionableUserIds(pageId: string, ids: Iterable<string>): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];

  if (isOkfId(pageId)) {
    const known = await db.select({ id: users.id }).from(users).where(inArray(users.id, unique));
    const out: string[] = [];
    for (const { id } of known) {
      const gate = await okfGateFor(id);
      if (gate.canReadId(pageId)) out.push(id);
    }
    return out;
  }

  const [page] = await db
    .select({ workspaceId: pages.workspaceId })
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1);
  if (!page) return [];

 // a workspace_members row first, so a stranger's id never reaches the
 // per-page lookup; then the page's own answer, which is what actually rules
 // out guests with no grant and members of a restricted page
  const members = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, page.workspaceId),
        inArray(workspaceMembers.userId, unique)
      )
    );
  const out: string[] = [];
  for (const { userId } of members) {
    const perm = await getPagePermission(pageId, userId);
    if (perm && hasPermission(perm, "view")) out.push(userId);
  }
  return out;
}

/**
 * The one place a `mention` row is written — both entry points below funnel
 * through it so they cannot drift apart.
 *
 * Two behaviours live here on purpose:
 *  · the recipient list is DEDUPED (mentioning someone twice in one body, or a
 *    client sending the same id twice, is still one notification);
 *  · SELF-mentions are KEPT. Mentioning an identity is an explicit act, and it
 *    is the blessed single-demo-user path for proving the inbox end-to-end.
 *    (notifyPageComment is the opposite — see its own note.)
 *
 * `dedupeUnread` (used by block autosave) skips creating a row when an identical
 * UNREAD mention for the same recipient+page+actor already exists, so repeated
 * autosaves of the same block never spam the inbox.
 *
 * Returns the ids that actually got a row — the caller uses it to avoid
 * double-notifying the same person through another channel.
 */
async function insertMentions(
  userIds: Iterable<string>,
  opts: MentionNotifyOpts
): Promise<string[]> {
  const asked = [...new Set(userIds)];
  if (asked.length === 0) return [];
 // never trust the caller's list — see mentionableUserIds
  const recipients = await mentionableUserIds(opts.pageId, asked);
  if (recipients.length === 0) return [];

  const notified: string[] = [];
  for (const userId of recipients) {
    if (opts.dedupeUnread) {
      const [existing] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, "mention"),
            eq(notifications.actorId, opts.actorId),
            eq(notifications.pageId, opts.pageId),
            eq(notifications.read, false),
            isNull(notifications.commentId)
          )
        )
        .limit(1);
      if (existing) continue;
    }
    await db.insert(notifications).values({
      userId,
      type: "mention",
      actorId: opts.actorId,
      pageId: opts.pageId,
      commentId: opts.commentId ?? null,
      body: opts.body ?? "",
    });
    notified.push(userId);
  }
  return notified;
}

/**
 * Mentions found INSIDE content: scan `html` for person chips and notify them.
 * Used by block autosave, where the mention lives in the saved markup.
 *
 * The html is CLIENT INPUT. The ids it yields are gated by mentionableUserIds
 * inside insertMentions; do not add a path around that.
 */
export async function notifyMentions(
  opts: MentionNotifyOpts & { html: string | undefined | null }
): Promise<string[]> {
  return insertMentions(extractPersonMentionIds(opts.html), opts);
}

/**
 * Mentions carried ALONGSIDE content: notify an explicit list of user ids.
 * Used by the comment route, whose body is PLAIN TEXT — there is no chip
 * markup to scan, so the composer sends the ids it resolved.
 *
 * The ids are still put through the page's own access gate here
 * (mentionableUserIds) — the caller's check is a courtesy, not the boundary.
 */
export async function notifyMentionIds(
  opts: MentionNotifyOpts & { userIds: string[] }
): Promise<string[]> {
  return insertMentions(opts.userIds, opts);
}

/**
 * Notify a page's other participants that a new comment landed. Participants =
 * the page creator ∪ everyone who previously commented, minus the actor (you do
 * not get pinged for your own comment on your own page — the general rule).
 *
 * `excludeUserIds` are the people already notified about THIS comment another
 * way — in practice the ones it @-mentioned. One comment must not land in one
 * inbox twice, and the mention is the more specific of the two, so it wins.
 */
export async function notifyPageComment(opts: {
  actorId: string;
  pageCreatorId: string | null;
  pageId: string;
  commentId: string;
  body: string;
  priorCommenterIds: string[];
  excludeUserIds?: string[];
}): Promise<void> {
  const recipients = new Set<string>();
  if (opts.pageCreatorId) recipients.add(opts.pageCreatorId);
  for (const id of opts.priorCommenterIds) recipients.add(id);
  recipients.delete(opts.actorId);
  for (const id of opts.excludeUserIds ?? []) recipients.delete(id);
  if (recipients.size === 0) return;

  for (const userId of recipients) {
    await db.insert(notifications).values({
      userId,
      type: "comment",
      actorId: opts.actorId,
      pageId: opts.pageId,
      commentId: opts.commentId,
      body: opts.body,
    });
  }
}

/**
 * Consent-flow inbox alert. `pageId` carries the DM ROOM id — the inbox
 * routes `consent` notifications to /dm/<roomId> (not /p/…). An identical
 * UNREAD row (recipient + room + body) is not duplicated, so a re-submitted
 * signature never spams the partner's inbox.
 */
export async function notifyConsent(opts: {
  recipientIds: string[];
  actorId: string;
  roomId: string;
  body: string;
}) {
  for (const userId of opts.recipientIds) {
    if (userId === opts.actorId) continue;
    const [dupe] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, "consent"),
          eq(notifications.pageId, opts.roomId),
          eq(notifications.body, opts.body),
          eq(notifications.read, false)
        )
      )
      .limit(1);
    if (dupe) continue;
    await db.insert(notifications).values({
      userId,
      type: "consent",
      actorId: opts.actorId,
      pageId: opts.roomId,
      body: opts.body,
    });
  }
}
