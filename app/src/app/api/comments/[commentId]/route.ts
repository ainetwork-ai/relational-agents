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

/** PATCH { resolved?, body? } → update the comment (resolve/reopen or edit). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { commentId } = await params;

  const comment = await loadAccessibleComment(commentId, auth.user.id);
  if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  if (typeof raw?.resolved === "boolean") update.resolved = raw.resolved;
  if (typeof raw?.body === "string" && raw.body.trim()) update.body = raw.body.trim();

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

/** DELETE → remove the comment. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { commentId } = await params;

  const comment = await loadAccessibleComment(commentId, auth.user.id);
  if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(comments).where(eq(comments.id, commentId));
  return NextResponse.json({ ok: true });
}
