import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatRoomBots, chatRoomMembers, chatRooms, users } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET → { agents } — the relationship agents living in the caller's DM rooms.
 * These ARE the user's agents (one per relationship), shown in the sidebar. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const myRooms = await db
    .select({ roomId: chatRoomMembers.roomId })
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.userId, auth.user.id));
  const roomIds = myRooms.map((r) => r.roomId);
  if (!roomIds.length) return NextResponse.json({ agents: [] });

  const bots = await db
    .select({ roomId: chatRoomBots.roomId, agentUserId: chatRoomBots.agentUserId })
    .from(chatRoomBots)
    .where(inArray(chatRoomBots.roomId, roomIds));
  if (!bots.length) return NextResponse.json({ agents: [] });

  const agentIds = bots.map((b) => b.agentUserId);
  const agentRows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(inArray(users.id, agentIds), eq(users.isAgent, true)));
  const roomRows = await db
    .select({ id: chatRooms.id, name: chatRooms.name })
    .from(chatRooms)
    .where(inArray(chatRooms.id, bots.map((b) => b.roomId)));
  const roomName = new Map(roomRows.map((r) => [r.id, r.name]));
  const agentById = new Map(agentRows.map((a) => [a.id, a]));

  const agents = bots
    .map((b) => {
      const a = agentById.get(b.agentUserId);
      if (!a) return null;
      return {
        agentUserId: a.id,
        displayName: a.displayName,
        avatarUrl: a.avatarUrl,
        roomId: b.roomId,
        roomName: roomName.get(b.roomId) ?? "",
      };
    })
    .filter(Boolean);
  return NextResponse.json({ agents });
}
