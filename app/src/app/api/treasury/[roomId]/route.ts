import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { db } from "@/lib/db";
import { agentRoomStates, chatRoomBots, chatRoomMembers, users } from "@/lib/db/schema";
import { resolveAvatarUrl } from "@/lib/avatar";
import { docPageIdOf } from "@/lib/agent/pipeline";
import { treasuryStatus } from "@/lib/agent/treasury/approvals";
import type { TreasuryRoomPerson, TreasuryRoomResponse } from "@/components/treasury-app/room/room-types";
import { agentWallet } from "./agent-wallet";

export const dynamic = "force-dynamic";

/** Members first (join order), then the room's agents; the dock names message authors from this. */
async function roomPeople(roomId: string): Promise<TreasuryRoomPerson[]> {
  const pick = { id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, isAgent: users.isAgent };
  const members = await db
    .select(pick)
    .from(chatRoomMembers)
    .innerJoin(users, eq(users.id, chatRoomMembers.userId))
    .where(eq(chatRoomMembers.roomId, roomId))
    .orderBy(asc(chatRoomMembers.joinedAt));
  const bots = await db
    .select(pick)
    .from(chatRoomBots)
    .innerJoin(users, eq(users.id, chatRoomBots.agentUserId))
    .where(eq(chatRoomBots.roomId, roomId))
    .orderBy(asc(chatRoomBots.importedAt));
  const seen = new Set<string>();
  const out: TreasuryRoomPerson[] = [];
  for (const p of [...members, ...bots]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ ...p, avatarUrl: resolveAvatarUrl(p.displayName, p.avatarUrl) });
  }
  return out;
}

/** The relation's doc, as the room header opens it (GET /api/dm/rooms/[roomId]). */
async function relationDocId(roomId: string): Promise<string | null> {
  const [state] = await db
    .select({ rootPageId: agentRoomStates.rootPageId, rootOkfPath: agentRoomStates.rootOkfPath })
    .from(agentRoomStates)
    .where(eq(agentRoomStates.roomId, roomId));
  return docPageIdOf(state);
}

/** GET → { status, room, me, wallet } — the relation's treasury as the viewer sees it, for the Treasury page. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const [status, people, docPageId] = await Promise.all([
    treasuryStatus(roomId, auth.user.id),
    roomPeople(roomId),
    relationDocId(roomId),
  ]);
  // same fallback as the room header (dm-view.tsx): an unnamed room is named by the others in it
  const others = people.filter((p) => !p.isAgent && p.id !== auth.user.id).map((p) => p.displayName);
  const body: TreasuryRoomResponse = {
    status,
    room: { id: roomId, name: access.room.name || others.join(", ") || "Relation", members: people, docPageId },
    me: { id: auth.user.id, displayName: auth.user.displayName },
    wallet: await agentWallet(status),
  };
  return NextResponse.json(body);
}
