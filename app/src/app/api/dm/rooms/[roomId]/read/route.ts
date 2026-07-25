import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatRoomMembers } from "@/lib/db/schema";
import { requireRoomAccess } from "@/lib/chat-room-access";

export const dynamic = "force-dynamic";

/** POST /api/dm/rooms/{roomId}/read → { ok } (내 읽음 시각을 지금으로) */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  await db
    .update(chatRoomMembers)
    .set({ lastReadAt: new Date() })
    .where(and(eq(chatRoomMembers.roomId, roomId), eq(chatRoomMembers.userId, auth.user.id)));
  return NextResponse.json({ ok: true });
}
