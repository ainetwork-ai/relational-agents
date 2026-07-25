import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { toPublicUser } from "@/lib/auth/public-user";
import { publishToRoomMembers, requireRoomAccess } from "@/lib/chat-room-access";

export const dynamic = "force-dynamic";

/** POST /api/dm/rooms/{roomId}/typing → { ok }.
 *  "입력 중" 신호 — 저장하지 않고 멤버 인박스로만 브로드캐스트. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  await publishToRoomMembers(roomId, {
    type: "dm-typing",
    clientId: req.headers.get("x-client-id"),
    user: toPublicUser(auth.user),
  });
  return NextResponse.json({ ok: true });
}
