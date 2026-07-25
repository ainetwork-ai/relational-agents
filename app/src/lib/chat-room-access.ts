import "server-only";
import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, chatRoomMembers, chatRooms, type ChatRoom } from "@/lib/db/schema";
import { publish, type PageEvent } from "@/lib/realtime";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DM inbox SSE channel key — one per user, derived from the session by /api/dm/events. */
export function dmInboxChannel(userId: string): string {
  return `dm-inbox:${userId}`;
}

/**
 * Room access. DM rooms = members only (even the creator loses access on
 * leaving); agent stub rooms = creator or member (a backwards-compatible
 * widening of the old creator-only model).
 */
export async function requireRoomAccess(
  roomId: string,
  userId: string
): Promise<{ room: ChatRoom } | { error: NextResponse }> {
  if (!UUID_RE.test(roomId))
    return { error: NextResponse.json({ error: "Bad room id" }, { status: 400 }) };
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId));
  if (!room) return { error: NextResponse.json({ error: "Room not found" }, { status: 404 }) };
  if (room.kind === "agent" && room.createdBy === userId) return { room };
  const [member] = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .where(and(eq(chatRoomMembers.roomId, roomId), eq(chatRoomMembers.userId, userId)))
    .limit(1);
  if (!member) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { room };
}

/** Current member userIds of a room. */
export async function roomMemberIds(roomId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.roomId, roomId));
  return rows.map((r) => r.userId);
}

/**
 * Publishes a notification event to every room member's DM inbox channel.
 * Never carries message bodies (notification-only) — channel subscription is
 * session-authorized, but the events themselves carrying no content is what
 * leaves zero leak surface. Receivers refetch.
 */
export async function publishToRoomMembers(
  roomId: string,
  event: Pick<PageEvent, "type" | "clientId"> & Partial<Pick<PageEvent, "user">>,
  memberIds?: string[]
): Promise<void> {
  const ids = memberIds ?? (await roomMemberIds(roomId));
  const at = Date.now();
  for (const uid of ids) {
    publish({ ...event, pageId: dmInboxChannel(uid), roomId, at });
  }
}

/** Fetch members for many rooms at once — kills the list API's N+1. */
export async function membersByRoom(roomIds: string[]) {
  if (roomIds.length === 0) return new Map<string, { userId: string; lastReadAt: Date | null }[]>();
  const rows = await db
    .select({
      roomId: chatRoomMembers.roomId,
      userId: chatRoomMembers.userId,
      lastReadAt: chatRoomMembers.lastReadAt,
    })
    .from(chatRoomMembers)
    .where(inArray(chatRoomMembers.roomId, roomIds));
  const map = new Map<string, { userId: string; lastReadAt: Date | null }[]>();
  for (const r of rows) {
    const list = map.get(r.roomId) ?? [];
    list.push({ userId: r.userId, lastReadAt: r.lastReadAt });
    map.set(r.roomId, list);
  }
  return map;
}

/**
 * A room's messages as `userId` is allowed to see them: shared messages plus
 * only that user's own quiet exchanges with the agent.
 *
 * Lives here because two routes serve messages — the room detail GET and the
 * messages GET. When only one of them filtered, quiet messages appeared on
 * refresh and vanished on the next realtime refetch, leaking them to the
 * partner in between.
 */
export async function visibleRoomMessages(roomId: string, userId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.roomId, roomId),
        or(
          isNull(chatMessages.privateToUserId),
          eq(chatMessages.privateToUserId, userId)
        )
      )
    )
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
}
