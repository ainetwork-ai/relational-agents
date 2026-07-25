import "server-only";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Inbox notification pipeline (server-side). Two collaboration signals feed it:
 * - PERSON @-mentions inside saved block HTML or a comment body
 * - a new comment on a page (its other participants get pinged)
 *
 * A mention chip is inline HTML: <span|a … data-mention-type="person"
 * data-mention-id="<userId>">. We pull the recipient user id straight off the
 * chip, independent of attribute order, so the scan is general to any content.
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

/**
 * Create a `mention` notification for each mentioned person. Self-mentions are
 * kept intentionally: mentioning an identity is an explicit act, and it is the
 * blessed single-demo-user path for proving the inbox pipeline end-to-end.
 *
 * `dedupeUnread` (used by block autosave) skips creating a row when an identical
 * UNREAD mention for the same recipient+page+actor already exists, so repeated
 * autosaves of the same block never spam the inbox.
 */
export async function notifyMentions(opts: {
  html: string | undefined | null;
  actorId: string;
  pageId: string;
  commentId?: string | null;
  body?: string;
  dedupeUnread?: boolean;
}): Promise<void> {
  const recipients = extractPersonMentionIds(opts.html);
  if (recipients.length === 0) return;

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
  }
}

/**
 * Notify a page's other participants that a new comment landed. Participants =
 * the page creator ∪ everyone who previously commented, minus the actor (you do
 * not get pinged for your own comment on your own page — the general rule).
 */
export async function notifyPageComment(opts: {
  actorId: string;
  pageCreatorId: string | null;
  pageId: string;
  commentId: string;
  body: string;
  priorCommenterIds: string[];
}): Promise<void> {
  const recipients = new Set<string>();
  if (opts.pageCreatorId) recipients.add(opts.pageCreatorId);
  for (const id of opts.priorCommenterIds) recipients.add(id);
  recipients.delete(opts.actorId);
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
