import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiChats, aiChatMutes } from "@/lib/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 30;

/**
 * GET /api/ai/chats?limit=&before= → { chats, mutedChatIds, hasMore }
 * Pinned (isPinned) chats are always included in full; unpinned chats follow,
 * paginated `limit` (default 30) by updatedAt desc. With a `before` cursor
 * (ISO updatedAt), only unpinned chats older than it are returned (no pinned
 * section) as the next page.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const limitParam = parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT;
  const beforeParam = req.nextUrl.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : null;

  const pinned =
    before === null
      ? await db
          .select()
          .from(aiChats)
          .where(and(eq(aiChats.userId, auth.user.id), eq(aiChats.isPinned, true)))
          .orderBy(desc(aiChats.updatedAt))
      : [];

  const unpinnedWhere =
    before === null
      ? and(eq(aiChats.userId, auth.user.id), eq(aiChats.isPinned, false))
      : and(eq(aiChats.userId, auth.user.id), eq(aiChats.isPinned, false), lt(aiChats.updatedAt, before));
  const unpinnedPage = await db
    .select()
    .from(aiChats)
    .where(unpinnedWhere)
    .orderBy(desc(aiChats.updatedAt))
    .limit(limit + 1);
  const hasMore = unpinnedPage.length > limit;
  const unpinned = hasMore ? unpinnedPage.slice(0, limit) : unpinnedPage;

  const mutes = await db
    .select({ chatId: aiChatMutes.chatId })
    .from(aiChatMutes)
    .where(eq(aiChatMutes.userId, auth.user.id));
  return NextResponse.json({
    chats: [...pinned, ...unpinned],
    mutedChatIds: mutes.map((m) => m.chatId),
    hasMore,
  });
}

/** POST /api/ai/chats { title?, icon?, agentName? } → { chat } — new AI chat. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const [chat] = await db
    .insert(aiChats)
    .values({
      workspaceId,
      userId: auth.user.id,
      title: typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "New chat",
      icon: typeof body?.icon === "string" ? body.icon : null,
      agentName: typeof body?.agentName === "string" ? body.agentName : null,
    })
    .returning();
  return NextResponse.json({ chat }, { status: 201 });
}
