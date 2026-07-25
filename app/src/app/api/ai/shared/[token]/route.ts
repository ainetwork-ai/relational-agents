import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiChats, aiChatMessages } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/ai/shared/{token} → { chat, messages } — read-only, no auth. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const [chat] = await db.select().from(aiChats).where(eq(aiChats.shareToken, token)).limit(1);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const messages = await db
    .select()
    .from(aiChatMessages)
    .where(eq(aiChatMessages.chatId, chat.id))
    .orderBy(asc(aiChatMessages.createdAt));
  // the shared view exposes only title/icon/messages (owner identifiers stay hidden)
  return NextResponse.json({
    chat: { title: chat.title, icon: chat.icon },
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      sources: m.sources ?? [],
      createdAt: m.createdAt,
    })),
    readOnly: true,
  });
}
