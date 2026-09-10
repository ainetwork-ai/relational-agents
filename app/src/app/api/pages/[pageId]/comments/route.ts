import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { comments, files, pages, users, workspaceMembers } from "@/lib/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { toPublicUser } from "@/lib/auth/public-user";
import { storageRefFromClientUrl } from "@/lib/files/serve";
import { isOkfId } from "@/lib/okf-store";
import { notifyMentionIds, notifyPageComment } from "@/lib/notifications";
import {
  validateShareToken,
  hasPermission,
  forbiddenResponse,
  requirePagePermission,
  getPagePermission,
} from "@/lib/auth/share-token";
import { okfGateFor } from "@/lib/okf-acl";

export const dynamic = "force-dynamic";

const MAX_ATTACHMENTS = 8;
/** Notion refuses well before this; the point is a ceiling, not a style rule. */
const MAX_BODY = 20_000;
const MAX_ATTACHMENT_NAME = 200;
const MAX_MENTIONS = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface IncomingAttachment {
  url: string;
  name: string;
  size?: number;
  mimeType?: string;
}

/**
 * Only urls the upload path itself produced — the key-addressed serving path,
 * or a legacy `/uploads/` file name. The `s3://` token the row stores is
 * derived on the server (storageRefFromClientUrl); a client never holds one,
 * so one arriving here is not ours and is refused like any other url.
 */
function parseAttachments(raw: unknown): IncomingAttachment[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null;
  const out: IncomingAttachment[] = [];
  for (const item of raw) {
    const url = (item as { url?: unknown })?.url;
    const name = (item as { name?: unknown })?.name;
    const size = (item as { size?: unknown })?.size;
    const mimeType = (item as { mimeType?: unknown })?.mimeType;
    if (typeof url !== "string") return null;
    const ref = storageRefFromClientUrl(url);
    if (!ref) return null;
    out.push({
      url: ref,
      name: typeof name === "string" ? name.slice(0, MAX_ATTACHMENT_NAME) : "file",
      ...(typeof size === "number" && size >= 0 ? { size } : {}),
      ...(typeof mimeType === "string" ? { mimeType: mimeType.slice(0, 200) } : {}),
    });
  }
  return out;
}

/**
 * `mentionIds` — who this comment @-mentions. The body is PLAIN TEXT, so the
 * ids cannot be recovered from it (there is no chip markup to scan); the
 * composer sends what it resolved and the server re-checks every one of them.
 *
 * Same contract as parseAttachments: a malformed SHAPE is a 400 (not an array,
 * or more than MAX_MENTIONS), while junk INSIDE a well-formed array is dropped
 * — a stale or half-typed id is not worth failing a comment over. Duplicates
 * collapse here so the count that matters is the deduped one.
 */
function parseMentionIds(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_MENTIONS) return null;
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim().toLowerCase();
    if (UUID_RE.test(id)) out.add(id);
  }
  return [...out];
}

/**
 * Which of those ids may actually be told about this comment.
 *
 * NEVER the client's word: a notification names the page and quotes the comment
 * body, so notifying someone who cannot open the page leaks both. Two things
 * must hold — the target is in THIS page's workspace, and the page's own gate
 * (getPagePermission ≥ view, what loadAccessiblePage uses) lets them read it.
 * Workspace membership alone is not access: a guest holds a members row too,
 * and a restricted page is private from its own workspace.
 *
 * OKF (file-backed) pages have no `pages` row and no workspace, so
 * getPagePermission has nothing to read — their gate is the path ACL
 * (okfGateFor), the same one resolveAccess uses above.
 *
 * Failures are dropped SILENTLY. A list that went stale between typing and
 * sending is normal; it must not fail the comment the person wrote.
 */
async function verifyMentionTargets(
  pageId: string,
  workspaceId: string | null,
  ids: string[]
): Promise<string[]> {
  if (!ids.length) return [];

  if (isOkfId(pageId)) {
    const known = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, ids));
    const out: string[] = [];
    for (const { id } of known) {
      const gate = await okfGateFor(id);
      if (gate.canReadId(pageId)) out.push(id);
    }
    return out;
  }

  if (!workspaceId) return [];
  const members = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.userId, ids)
      )
    );
  const out: string[] = [];
  for (const { userId } of members) {
    const perm = await getPagePermission(pageId, userId);
    if (perm && hasPermission(perm, "view")) out.push(userId);
  }
  return out;
}

/** Attachments as the client consumes them: an id it can build proxy URLs
 *  from, plus what it needs to draw the row without fetching the bytes. */
async function attachmentsByComment(commentIds: string[]) {
  if (!commentIds.length) return new Map<string, unknown[]>();
  const rows = await db.select().from(files).where(inArray(files.commentId, commentIds));
  const map = new Map<string, unknown[]>();
  for (const f of rows) {
    const list = map.get(f.commentId) ?? [];
    list.push({
      id: f.id,
      name: f.fileName,
      size: f.fileSize ?? undefined,
      mimeType: f.mimeType ?? undefined,
      width: f.width ?? undefined,
      height: f.height ?? undefined,
    });
    map.set(f.commentId, list);
  }
  return map;
}

/**
 * The page whose comments this user may read.
 *
 * "Is in the workspace" is not access: a guest holds a workspaceMembers row
 * too but is scoped to the pages explicitly shared with them, and a restricted
 * page is private from the other members of its own workspace. Both used to
 * pass here, which handed comment bodies to people who cannot open the page.
 * getPagePermission is the gate the page itself uses.
 */
async function loadAccessiblePage(pageId: string, userId: string) {
  if (isOkfId(pageId)) return null; // file-backed page: no SQL comment thread
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return null;
  const perm = await getPagePermission(pageId, userId);
  return perm && hasPermission(perm, "view") ? page : null;
}

/**
 * Resolve access: session auth first, then share-token fallback.
 */
async function resolveAccess(req: NextRequest, pageId: string) {
  const auth = await requireAuth();
 // file-backed (OKF) pages have no pages row; their gate is the path ACL
 // (lib/okf-acl.ts), which is what keeps participant-only docs private
  if (isOkfId(pageId)) {
    if ("error" in auth) return { authed: false as const };
    const gate = await okfGateFor(auth.user.id);
    if (!gate.canReadId(pageId)) return { authed: false as const };
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

  const byComment = await attachmentsByComment(rows.map((r) => r.comments.id));
 // the fileUrl never leaves the server — the client addresses bytes by file id
 // through the proxy routes, so a storage key is not a thing it can hold
  const result = rows.map((r) => ({
    ...r.comments,
    author: r.users ? toPublicUser(r.users) : null,
    attachments: byComment.get(r.comments.id) ?? [],
  }));
  return NextResponse.json({ comments: result });
}

/** POST { body, blockId?, attachments?, mentionIds? } → create a comment (blockId null = page thread). */
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
 // a comment is copied verbatim into one notification row per mentioned user,
 // so an unbounded body is a fan-out amplifier as well as a big row
  const rawBody = typeof raw?.body === "string" ? raw.body : "";
  if (rawBody.length > MAX_BODY)
    return NextResponse.json({ error: "Comment too long" }, { status: 400 });
  const body = rawBody.trim();
  const blockId = typeof raw?.blockId === "string" ? raw.blockId : null;
  const parentId = typeof raw?.parentId === "string" ? raw.parentId : null;
  const attachments = parseAttachments(raw?.attachments);
  if (attachments === null)
    return NextResponse.json({ error: "Bad attachments" }, { status: 400 });
  const mentionIds = parseMentionIds(raw?.mentionIds);
  if (mentionIds === null)
    return NextResponse.json({ error: "Bad mentions" }, { status: 400 });
 // a comment may be nothing but files — the clip alone is a valid comment
  if (!body && !attachments.length)
    return NextResponse.json({ error: "Empty body" }, { status: 400 });

 // Snapshot who has already commented (page participants) before we add ours.
  const priorAuthors = await db
    .select({ authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.pageId, pageId));

  const [comment] = await db
    .insert(comments)
    .values({ pageId, blockId, parentId, authorId: access.user.id, body })
    .returning();

 // file rows are created WITH the comment, not when the upload finished — an
 // upload nobody sent leaves nothing behind, and comment_id can stay NOT NULL
 // so the cascade answers "is this object still referenced?"
  const saved = attachments.length
    ? await db
        .insert(files)
        .values(
          attachments.map((a) => ({
            commentId: comment.id,
            userId: access.user.id,
            fileName: a.name,
            fileUrl: a.url,
            fileSize: a.size ?? null,
            mimeType: a.mimeType ?? null,
          }))
        )
        .returning()
    : [];

 // @-mentions. This used to hand the plain-text body to notifyMentions as
 // `html`, which finds chips — plain text has none, so a comment mention has
 // never notified anyone. The ids now arrive explicitly and are re-checked
 // against the page gate here; scanning the body was also forgeable, since a
 // body is whatever the client typed.
  const mentioned = await verifyMentionTargets(
    pageId,
    page?.workspaceId ?? null,
    mentionIds
  );
  if (mentioned.length)
    await notifyMentionIds({
      userIds: mentioned,
      actorId: access.user.id,
      pageId,
      commentId: comment.id,
      body,
    });
 // One comment, one inbox row per person: whoever just got the mention above
 // is excluded from the participants ping for the same comment.
  if (!isOkfId(pageId))
    await notifyPageComment({
      actorId: access.user.id,
      pageCreatorId: page?.createdBy ?? null,
      pageId,
      commentId: comment.id,
      body,
      priorCommenterIds: priorAuthors.map((r) => r.authorId),
      excludeUserIds: mentioned,
    });

  return NextResponse.json(
    {
      comment: {
        ...comment,
        author: toPublicUser(access.user),
        attachments: saved.map((f) => ({
          id: f.id,
          name: f.fileName,
          size: f.fileSize ?? undefined,
          mimeType: f.mimeType ?? undefined,
          width: f.width ?? undefined,
          height: f.height ?? undefined,
        })),
      },
    },
    { status: 201 }
  );
}
