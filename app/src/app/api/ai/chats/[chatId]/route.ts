import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiChats, aiChatMessages } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";

// default first-load page size for long chats — generous so ordinary tests (a few messages) are unaffected.
const DEFAULT_MESSAGES_LIMIT = 50;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadChat(chatId: string, userId: string) {
  const [chat] = await db
    .select()
    .from(aiChats)
    .where(and(eq(aiChats.id, chatId), eq(aiChats.userId, userId)))
    .limit(1);
  return chat ?? null;
}

/**
 * GET → { chat, messages, hasMore } (opening does NOT clear unread — that's explicit markRead).
 * Long chats: returns only the latest `?limit` (default 50) — ordinary tests are unaffected.
 * The chat view shows "load earlier messages" only while `hasMore` is true.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { chatId } = await ctx.params;
  const chat = await loadChat(chatId, auth.user.id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : DEFAULT_MESSAGES_LIMIT;

  const page = await db
    .select()
    .from(aiChatMessages)
    .where(eq(aiChatMessages.chatId, chatId))
    .orderBy(desc(aiChatMessages.createdAt))
    .limit(limit + 1);
  const hasMore = page.length > limit;
  const messages = page.slice(0, limit).reverse();

  return NextResponse.json({ chat, messages, hasMore });
}

/** PATCH { title?, icon?, isFavorite?, isPinned?, markRead? } → { chat }. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { chatId } = await ctx.params;
  const chat = await loadChat(chatId, auth.user.id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const patch: Partial<typeof aiChats.$inferInsert> = {};
  if (typeof body?.title === "string") patch.title = body.title.trim() || "New chat";
  if (typeof body?.icon === "string" || body?.icon === null) patch.icon = body.icon;
  if (typeof body?.isFavorite === "boolean") patch.isFavorite = body.isFavorite;
  if (typeof body?.isPinned === "boolean") patch.isPinned = body.isPinned;
  if (body?.markRead === true) patch.hasUnread = false;
  if (Object.keys(patch).length === 0) return NextResponse.json({ chat });

  const [updated] = await db
    .update(aiChats)
    .set(patch)
    .where(eq(aiChats.id, chatId))
    .returning();
  return NextResponse.json({ chat: updated });
}

/** DELETE → { ok } (messages go with it via FK cascade). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { chatId } = await ctx.params;
  const chat = await loadChat(chatId, auth.user.id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(aiChats).where(eq(aiChats.id, chatId));
  return NextResponse.json({ ok: true });
}
