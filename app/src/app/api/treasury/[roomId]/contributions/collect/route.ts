import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { collectAndAnnounce, isHumanMember, roomAgent } from "@/lib/agent/treasurer/tools";

export const dynamic = "force-dynamic";

/**
 * POST → collect every contribution that is due into the room's pot now, and say what came in.
 * Any human member may ask: a pull moves only what a member allowed, only into this pot, at most
 * once a period — the contract enforces that — and the agent pays the gas.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  if (!(await isHumanMember(roomId, auth.user.id))) return NextResponse.json({ error: "Only the relation's members can do this" }, { status: 403 });
  const agent = await roomAgent(roomId);
  if (!agent) return NextResponse.json({ error: "This relation has no agent" }, { status: 404 });

  const { collected, notCollected } = await collectAndAnnounce({ roomId, agentUserId: agent.agentUserId });
  return NextResponse.json({ collected, notCollected });
}
