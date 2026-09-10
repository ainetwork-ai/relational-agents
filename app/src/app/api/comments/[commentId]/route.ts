import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { comments, pages, workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { isOkfId } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** A comment the user may touch = a comment on a page in a workspace they
 * belong to. */
async function loadAccessibleComment(commentId: string, userId: string) {
  const [comment] = await db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!comment) return null;
 // file-backed (OKF) page comment: text id, no pages row / per-page ACL —
 // any authenticated member may touch it
  if (isOkfId(comment.pageId)) return comment;
  const [page] = await db
    .select()
    .from(pages)
    .where(eq(pages.id, comment.pageId))
    .limit(1);
  if (!page) return null;
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, page.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  return membership ? comment : null;
}

/**
 * A comment the user may REWRITE or REMOVE: their own, and nobody else's.
 *
 * Measured on Notion 2026-09-10 (docs/notion-comment-delete.md): the ⋯ menu on
 * someone else's comment offers only 읽지 않음으로 표시 · 링크 복사, while your
 * own adds 편집하기 and 삭제하기 — so authorship, not workspace membership, is
 * the gate. Resolving is different: the 해결 button sits on anyone's thread
 * head, so that path keeps the membership check above.
 *
 * Separate loader rather than a flag, the way this repo already splits read
 * from write access (api/ai/agents/[agentId]/route.ts loadAccessible/loadOwned).
 */
async function loadOwnComment(commentId: string, userId: string) {
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.authorId, userId)))
    .limit(1);
  return comment ?? null;
}

/** PATCH { resolved?, body? } → resolve/reopen (any member) or edit (author). */
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

 // an edit needs authorship; a resolve only needs to be in the workspace
  const comment = wantsEdit
    ? await loadOwnComment(commentId, auth.user.id)
    : await loadAccessibleComment(commentId, auth.user.id);
  if (!comment) {
    return NextResponse.json(
      { error: wantsEdit ? "Only the author can edit this comment" : "Not found" },
      { status: wantsEdit ? 403 : 404 }
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
    const visible = await loadAccessibleComment(commentId, auth.user.id);
    return NextResponse.json(
      { error: visible ? "Only the author can delete this comment" : "Not found" },
      { status: visible ? 403 : 404 }
    );
  }

  await db.delete(comments).where(eq(comments.id, commentId));
  return NextResponse.json({ ok: true, id: commentId });
}
