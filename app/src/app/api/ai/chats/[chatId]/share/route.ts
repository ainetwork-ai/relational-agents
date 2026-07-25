import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiChats } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

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

/** POST → { shareToken, url } — mint a read-only share link (reused if present). */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { chatId } = await ctx.params;
  const chat = await loadChat(chatId, auth.user.id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const shareToken = chat.shareToken ?? randomUUID().replace(/-/g, "");
  if (!chat.shareToken) {
    await db.update(aiChats).set({ shareToken }).where(eq(aiChats.id, chatId));
  }
  return NextResponse.json({ shareToken, url: `/share/chat/${shareToken}` });
}

/** DELETE → { ok } — revoke the share link. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { chatId } = await ctx.params;
  const chat = await loadChat(chatId, auth.user.id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.update(aiChats).set({ shareToken: null }).where(eq(aiChats.id, chatId));
  return NextResponse.json({ ok: true });
}
