import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiChats, aiChatMutes } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function ownsChat(chatId: string, userId: string) {
  const [chat] = await db
    .select({ id: aiChats.id })
    .from(aiChats)
    .where(and(eq(aiChats.id, chatId), eq(aiChats.userId, userId)))
    .limit(1);
  return !!chat;
}

/** POST → { muted: true } — mute this chat's notifications. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { chatId } = await ctx.params;
  if (!(await ownsChat(chatId, auth.user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.insert(aiChatMutes).values({ userId: auth.user.id, chatId }).onConflictDoNothing();
  return NextResponse.json({ muted: true });
}

/** DELETE → { muted: false } — unmute. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { chatId } = await ctx.params;
  await db
    .delete(aiChatMutes)
    .where(and(eq(aiChatMutes.userId, auth.user.id), eq(aiChatMutes.chatId, chatId)));
  return NextResponse.json({ muted: false });
}
