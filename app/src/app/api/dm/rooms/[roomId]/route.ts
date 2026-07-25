import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import {
  agentRoomStates,
  chatRoomMembers,
  chatRooms,
  users,
  type ChatRoom,
} from "@/lib/db/schema";
import { docPageIdOf } from "@/lib/agent/pipeline";
import { toPublicUser, type PublicUser } from "@/lib/auth/public-user";
import {
  publishToRoomMembers,
  requireRoomAccess,
  visibleRoomMessages,
} from "@/lib/chat-room-access";

export const dynamic = "force-dynamic";
const MAX_NAME = 200;

/** Shared room shape for GET/PATCH — built in one place so the two responses never diverge. */
function toDmRoom(room: ChatRoom, rootPageId: string | null) {
  return {
    id: room.id,
    name: room.name,
    kind: room.kind,
    createdBy: room.createdBy,
    createdAt: room.createdAt,
    rootPageId,
  };
}

async function roomRootPageId(roomId: string): Promise<string | null> {
  const [state] = await db
    .select({
      rootPageId: agentRoomStates.rootPageId,
      rootOkfPath: agentRoomStates.rootOkfPath,
    })
    .from(agentRoomStates)
    .where(eq(agentRoomStates.roomId, roomId));
 // relationship docs are OKF-file-canonical — prefer the encoded OKF id (legacy rooms: uuid)
  return docPageIdOf(state);
}

/** DM-room access: refuse non-members and non-DM rooms. */
async function requireDmRoom(roomId: string, userId: string) {
  const access = await requireRoomAccess(roomId, userId);
  if ("error" in access) return access;
  if (access.room.kind !== "dm")
    return { error: NextResponse.json({ error: "Room not found" }, { status: 404 }) };
  return access;
}

/** GET /api/dm/rooms/{roomId} → { room(+rootPageId), members, authors, messages } */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireDmRoom(roomId, auth.user.id);
  if ("error" in access) return access.error;
  const { room } = access;

  const memberRows = await db
    .select({ userId: chatRoomMembers.userId, lastReadAt: chatRoomMembers.lastReadAt })
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.roomId, roomId));
  // same visibility rule as GET .../messages — quiet exchanges belong to their
  // asker only (shared helper so the two loaders can never diverge again)
  const messages = await visibleRoomMessages(roomId, auth.user.id);

 // include every author so past messages from departed members still render names/avatars
  const memberIds = memberRows.map((m) => m.userId);
  const authorIds = [...new Set(messages.map((m) => m.authorId))];
  const allIds = [...new Set([...memberIds, ...authorIds])];
  const userRows = allIds.length
    ? await db.select().from(users).where(inArray(users.id, allIds))
    : [];
  const publicById = new Map(userRows.map((u) => [u.id, toPublicUser(u)]));

  return NextResponse.json({
 // meId rides along → the client never races a separate /api/auth/me call
    meId: auth.user.id,
    room: toDmRoom(room, await roomRootPageId(roomId)),
    members: memberIds
      .map((id) => publicById.get(id))
      .filter((u): u is PublicUser => !!u),
    authors: authorIds
      .filter((id) => !memberIds.includes(id))
      .map((id) => publicById.get(id))
      .filter((u): u is PublicUser => !!u),
    messages,
  });
}

/** PATCH /api/dm/rooms/{roomId} { name } → { room } (rename) */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireDmRoom(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const body = await req.json().catch(() => ({}));
  if (typeof body?.name !== "string")
    return NextResponse.json({ error: "name required" }, { status: 400 });
  const name = body.name.trim().slice(0, MAX_NAME);

  const [updated] = await db
    .update(chatRooms)
    .set({ name })
    .where(eq(chatRooms.id, roomId))
    .returning();
  await publishToRoomMembers(roomId, {
    type: "dm-room",
    clientId: req.headers.get("x-client-id"),
  });
  return NextResponse.json({ room: toDmRoom(updated, await roomRootPageId(roomId)) });
}
