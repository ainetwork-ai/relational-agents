import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatRooms, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireRoomAccess, roomMemberIds, publishToRoomMembers } from "@/lib/chat-room-access";
import { provisionRoomAgent } from "@/lib/agent/provision";

export const dynamic = "force-dynamic";

/**
 * POST /api/dm/rooms/{roomId}/agent — consent complete → create & import the
 * relationship agent. Requires the signed contract (consentAt). Idempotent.
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

/** GET — this room's agent info (404 if none) */
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

/** PATCH { name } → rename this room's relationship agent (any member). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const { chatRoomBots } = await import("@/lib/db/schema");
  const [bot] = await db.select().from(chatRoomBots).where(eq(chatRoomBots.roomId, roomId));
  if (!bot) return NextResponse.json({ error: "No agent" }, { status: 404 });

  const [agent] = await db
    .update(users)
    .set({ displayName: name })
    .where(eq(users.id, bot.agentUserId))
    .returning();
  await publishToRoomMembers(
    roomId,
    { type: "dm-room", clientId: req.headers.get("x-client-id") },
    await roomMemberIds(roomId)
  );
  return NextResponse.json({ agentUserId: agent.id, displayName: agent.displayName });
}
