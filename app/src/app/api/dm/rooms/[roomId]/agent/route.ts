import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatRooms, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireRoomAccess, roomMemberIds, publishToRoomMembers } from "@/lib/chat-room-access";
import { provisionRoomAgent } from "@/lib/agent/provision";

export const dynamic = "force-dynamic";

/**
 * POST /api/dm/rooms/{roomId}/agent — 상호 동의 완료 → 관계 에이전트 생성·임포트.
 * (실제 동의 수집 플로우는 타 담당 — 여기서는 완료 이벤트로 취급해 consentAt을
 * 찍고 프로비저닝한다. 멱등.)
 * → { agentUserId, memberTokens: { [userId]: token }, a2aUrl }
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  const { room } = access;

  // The agent is born only from a signed contract: /consent stamps consentAt
  // once every member's wallet has signed. No signature, no agent.
  if (!room.consentAt) {
    return NextResponse.json(
      { error: "Relational agent contract not signed by all members yet" },
      { status: 403 }
    );
  }

  const memberIds = (await roomMemberIds(roomId)).filter((id) => id !== auth.user.id);
  const result = await provisionRoomAgent(room, [auth.user.id, ...memberIds], auth.user.id);
  const [agent] = await db.select().from(users).where(eq(users.id, result.agentUserId));
  if (!result.alreadyExisted)
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: `agent-join:${result.agentUserId}` });

  return NextResponse.json(
    {
      agentUserId: result.agentUserId,
      a2aUrl: agent?.a2aUrl ?? null,
      memberTokens: result.memberTokens,
      alreadyExisted: result.alreadyExisted,
    },
    { status: result.alreadyExisted ? 200 : 201 }
  );
}

/** GET — 이 방의 에이전트 정보 (없으면 404) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const { chatRoomBots } = await import("@/lib/db/schema");
  const bots = await db.select().from(chatRoomBots).where(eq(chatRoomBots.roomId, roomId));
  if (!bots.length) return NextResponse.json({ error: "No agent" }, { status: 404 });
  const agents = [];
  for (const b of bots) {
    const [u] = await db.select().from(users).where(eq(users.id, b.agentUserId));
    if (u?.isAgent)
      agents.push({
        agentUserId: u.id,
        displayName: u.displayName,
        a2aUrl: u.a2aUrl,
        agentConfig: u.agentConfig ?? {},
        ownerId: u.ownerId,
      });
  }
  return NextResponse.json({ agents });
}
