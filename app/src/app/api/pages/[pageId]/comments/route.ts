import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { comments, pages, users, workspaceMembers } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { toPublicUser } from "@/lib/auth/public-user";
import { isOkfId } from "@/lib/okf-store";
import { notifyMentions, notifyPageComment } from "@/lib/notifications";
import {
  validateShareToken,
  hasPermission,
  forbiddenResponse,
  requirePagePermission,
} from "@/lib/auth/share-token";

export const dynamic = "force-dynamic";

async function loadAccessiblePage(pageId: string, userId: string) {
  if (isOkfId(pageId)) return null; // file-backed page: no SQL comment thread
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
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
  return membership ? page : null;
}

/**
 * Resolve access: session auth first, then share-token fallback.
 */
async function resolveAccess(req: NextRequest, pageId: string) {
  const auth = await requireAuth();
 // file-backed (OKF) pages have no per-page ACL — any authenticated member
  if (isOkfId(pageId)) {
    if ("error" in auth) return { authed: false as const };
    return { authed: true as const, user: auth.user, page: null, share: null };
  }
  if (!("error" in auth)) {
    const page = await loadAccessiblePage(pageId, auth.user.id);
    if (page) return { authed: true as const, user: auth.user, page, share: null };
  }

  const share = await validateShareToken(req, pageId);
  if (share) {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (page && !page.isArchived) {
      return { authed: true as const, user: null, page, share };
    }
  }

  return { authed: false as const };
}

/** GET → { comments: [...] } for the whole page, oldest-first (newest-last),
 * each with its author shaped via toPublicUser. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;
  const access = await resolveAccess(req, pageId);

  if (!access.authed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

 // Any permission (view/comment/edit/full) can read comments
  const rows = await db
    .select()
    .from(comments)
    .leftJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.pageId, pageId))
    .orderBy(asc(comments.createdAt));

  const result = rows.map((r) => ({
    ...r.comments,
    author: r.users ? toPublicUser(r.users) : null,
  }));
  return NextResponse.json({ comments: result });
}

/** POST { body, blockId? } → create a comment (blockId null = page thread). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;
  const access = await resolveAccess(req, pageId);

  if (!access.authed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

 // Share-token: must have comment, edit, or full
  if (access.share && !hasPermission(access.share.permission, "comment")) {
    return forbiddenResponse("comment");
  }

 // Anonymous share users cannot post comments (no author identity)
  if (!access.user) {
    return NextResponse.json(
      { error: "Commenting requires authentication" },
      { status: 403 }
    );
  }

 // Session auth: check page-level comment permission (OKF pages have none)
  if (!isOkfId(pageId)) {
    const check = await requirePagePermission(pageId, access.user.id, "comment");
    if (check !== true) return check;
  }

  const page = access.page;
  if (!page && !isOkfId(pageId))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = await req.json().catch(() => ({}));
  const body = typeof raw?.body === "string" ? raw.body.trim() : "";
  const blockId = typeof raw?.blockId === "string" ? raw.blockId : null;
  const parentId = typeof raw?.parentId === "string" ? raw.parentId : null;
  if (!body) return NextResponse.json({ error: "Empty body" }, { status: 400 });

 // Snapshot who has already commented (page participants) before we add ours.
  const priorAuthors = await db
    .select({ authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.pageId, pageId));

  const [comment] = await db
    .insert(comments)
    .values({ pageId, blockId, parentId, authorId: access.user.id, body })
    .returning();

  if (!isOkfId(pageId))
  await notifyMentions({
    html: body,
    actorId: access.user.id,
    pageId,
    commentId: comment.id,
    body,
  });
  if (!isOkfId(pageId))
  await notifyPageComment({
    actorId: access.user.id,
    pageCreatorId: page?.createdBy ?? null,
    pageId,
    commentId: comment.id,
    body,
    priorCommenterIds: priorAuthors.map((r) => r.authorId),
  });

  return NextResponse.json(
    { comment: { ...comment, author: toPublicUser(access.user) } },
    { status: 201 }
  );
}
