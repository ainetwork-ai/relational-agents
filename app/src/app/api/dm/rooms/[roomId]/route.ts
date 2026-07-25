import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import {
  agentRoomStates,
  chatMessages,
  chatRoomMembers,
  chatRooms,
  users,
  type ChatRoom,
} from "@/lib/db/schema";
import { docPageIdOf } from "@/lib/agent/pipeline";
import { toPublicUser, type PublicUser } from "@/lib/auth/public-user";
import { publishToRoomMembers, requireRoomAccess } from "@/lib/chat-room-access";

export const dynamic = "force-dynamic";
const MAX_NAME = 200;

/** GET/PATCH 공통 방 표현 — 두 응답의 shape가 갈라지지 않게 한 곳에서 만든다. */
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
  // 관계 문서는 OKF 파일이 원본 — 인코딩된 OKF id를 우선 (레거시 방은 uuid)
  return docPageIdOf(state);
}

/** dm 방 전용 접근: 멤버가 아니거나 dm 방이 아니면 거절. */
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
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.roomId, roomId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));

  // 나간 멤버의 과거 메시지도 이름/아바타를 그리기 위해 작성자 전원을 함께 내려준다
  const memberIds = memberRows.map((m) => m.userId);
  const authorIds = [...new Set(messages.map((m) => m.authorId))];
  const allIds = [...new Set([...memberIds, ...authorIds])];
  const userRows = allIds.length
    ? await db.select().from(users).where(inArray(users.id, allIds))
    : [];
  const publicById = new Map(userRows.map((u) => [u.id, toPublicUser(u)]));

  return NextResponse.json({
    // meId를 한 응답에 포함 → 클라이언트가 별도 /api/auth/me 를 레이스로 부르지 않는다
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

/** PATCH /api/dm/rooms/{roomId} { name } → { room } (방 이름 변경) */
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
