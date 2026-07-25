import "server-only";
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomMembers, chatRooms, type ChatRoom } from "@/lib/db/schema";
import { publish, type PageEvent } from "@/lib/realtime";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DM 인박스 SSE 채널 키 — 사용자당 하나, /api/dm/events 가 세션에서 유도한다. */
export function dmInboxChannel(userId: string): string {
  return `dm-inbox:${userId}`;
}

/**
 * 방 접근 권한. dm 방 = 멤버만(생성자도 나가면 접근 상실),
 * agent 스텁 방 = 생성자 또는 멤버(기존 생성자-전용 모델의 하위호환 확장).
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

/** 방의 현재 멤버 userId 목록. */
export async function roomMemberIds(roomId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.roomId, roomId));
  return rows.map((r) => r.userId);
}

/**
 * 방 멤버 전원의 DM 인박스 채널로 알림 이벤트를 발행.
 * 메시지 본문은 절대 싣지 않는다(알림 전용) — 채널 구독 인가는 세션 기반이지만
 * 이벤트 자체가 내용을 담지 않아야 유출 표면이 없다. 수신자는 refetch.
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

/** 여러 방의 멤버를 한 번에 조회 — 목록 API의 N+1 방지용. */
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
