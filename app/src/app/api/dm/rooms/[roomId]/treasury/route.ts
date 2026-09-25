import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { treasuryStatus } from "@/lib/agent/treasury/approvals";

export const dynamic = "force-dynamic";

/** GET → the relation's treasury as the viewer sees it (rules, seats, requests). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  return NextResponse.json(await treasuryStatus(roomId, auth.user.id));
}
