import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { comments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isOkfId } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";
import {
  getPagePermission,
  hasPermission,
  type SharePermission,
} from "@/lib/auth/share-token";

export const dynamic = "force-dynamic";

/**
 * A comment the user may touch = a comment on a page they actually hold
 * `required` permission on.
 *
 * NOT "is in the workspace". A guest has a workspaceMembers row too, and a
 * restricted page (the participant-only relationship docs) lives inside a
 * workspace whose other members must not read it. Both used to pass this gate,
 * so a guest scoped to zero pages could read every comment body in the
 * workspace and resolve/reopen any thread. getPagePermission is the same
 * answer the page itself gives (lib/pages/edit-access.ts, and the POST half of
 * api/pages/[pageId]/comments).
 */
async function loadAccessibleComment(
  commentId: string,
  userId: string,
  required: SharePermission = "comment"
) {
  const [comment] = await db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!comment) return null;
 // file-backed (OKF) page comment: text id, no pages row — the path ACL is
 // the whole gate there (lib/okf-acl.ts), so ask it rather than nobody
  if (isOkfId(comment.pageId)) {
    const gate = await okfGateFor(userId);
    return gate.canReadId(comment.pageId) ? comment : null;
  }
  const perm = await getPagePermission(comment.pageId, userId);
  return perm && hasPermission(perm, required) ? comment : null;
}

/**
 * A comment the user may REWRITE or REMOVE: their own, on a page they can
 * still comment on.
 *
 * Measured on Notion 2026-09-10 (docs/notion-comment-delete.md): the ⋯ menu on
 * someone else's comment offers only Mark as unread · Copy link, while your
 * own adds Edit and Delete — so authorship gates these two. Resolving is
 * different: the Resolve button sits on anyone's thread head, so that path stays
 * on the access check alone.
 *
 * Authorship is ADDED to that access check, never substituted for it. Asking
 * only "authorId = me" left an offboarded author (workspaceMembers row gone,
 * page grant revoked) able to edit and delete their old comments long after
 * every other route stopped answering them.
 */
async function loadOwnComment(commentId: string, userId: string) {
  const comment = await loadAccessibleComment(commentId, userId, "comment");
  return comment && comment.authorId === userId ? comment : null;
}

/** PATCH { resolved?, body? } → resolve/reopen (any commenter) or edit (author). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { commentId } = await params;

  const raw = await req.json().catch(() => ({}));
  const wantsResolve = typeof raw?.resolved === "boolean";
  const wantsEdit = typeof raw?.body === "string" && raw.body.trim().length > 0;

 // an edit needs authorship on top of access; a resolve needs access alone
  const comment = wantsEdit
    ? await loadOwnComment(commentId, auth.user.id)
    : await loadAccessibleComment(commentId, auth.user.id);
  if (!comment) {
 // "not yours" only for someone who can see it — otherwise it does not exist
    const visible = wantsEdit
      ? await loadAccessibleComment(commentId, auth.user.id, "view")
      : null;
    return NextResponse.json(
      { error: visible ? "Only the author can edit this comment" : "Not found" },
      { status: visible ? 403 : 404 }
    );
  }

  const update: Record<string, unknown> = {};
  if (wantsResolve) update.resolved = raw.resolved;
  if (wantsEdit) update.body = raw.body.trim();

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ comment });
  }

  const [updated] = await db
    .update(comments)
    .set(update)
    .where(eq(comments.id, commentId))
    .returning();
  return NextResponse.json({ comment: updated });
}

/**
 * DELETE → remove the comment. Author only.
 *
 * ONE row: measured on Notion 2026-09-10 — deleting a thread head leaves its
 * replies alive and the next one becomes the head. Cascading would delete other
 * people's replies, which the author of the head is not entitled to do. The
 * clients render a reply whose parent is gone as a thread of its own so nothing
 * becomes invisible-but-counted.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { commentId } = await params;

  const own = await loadOwnComment(commentId, auth.user.id);
  if (!own) {
 // distinguish "not yours" from "no such comment", but only for people who
 // could see it in the first place
    const visible = await loadAccessibleComment(commentId, auth.user.id, "view");
    return NextResponse.json(
      { error: visible ? "Only the author can delete this comment" : "Not found" },
      { status: visible ? 403 : 404 }
    );
  }

  await db.delete(comments).where(eq(comments.id, commentId));
  return NextResponse.json({ ok: true, id: commentId });
}
