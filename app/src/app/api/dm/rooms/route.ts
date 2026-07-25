import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import {
  chatMessages,
  chatRoomMembers,
  chatRooms,
  users,
  workspaceMembers,
  type ChatRoom,
} from "@/lib/db/schema";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { toPublicUser, type PublicUser } from "@/lib/auth/public-user";
import { membersByRoom, publishToRoomMembers, UUID_RE } from "@/lib/chat-room-access";

export const dynamic = "force-dynamic";

const MAX_MEMBERS = 20;
const MAX_NAME = 200;

export interface DmRoomSummary {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  members: PublicUser[];
  lastMessage: {
    id: string;
    text: string;
    authorId: string;
    createdAt: Date;
    hasAttachments: boolean;
  } | null;
  unreadCount: number;
}

/** 내가 멤버인 dm 방들을 요약(멤버·마지막 메시지·미읽음 수)으로 조립. */
async function buildSummaries(meId: string, rooms: ChatRoom[]): Promise<DmRoomSummary[]> {
  const roomIds = rooms.map((r) => r.id);
  if (roomIds.length === 0) return [];

  const memberMap = await membersByRoom(roomIds);
  const allUserIds = [...new Set([...memberMap.values()].flat().map((m) => m.userId))];
  const userRows = allUserIds.length
    ? await db.select().from(users).where(inArray(users.id, allUserIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, toPublicUser(u)]));

  const lastMessages = await db
    .selectDistinctOn([chatMessages.roomId])
    .from(chatMessages)
    .where(inArray(chatMessages.roomId, roomIds))
    .orderBy(chatMessages.roomId, desc(chatMessages.createdAt), desc(chatMessages.id));
  const lastByRoom = new Map(lastMessages.map((m) => [m.roomId, m]));

  // 미읽음 = 내가 이 방에 합류(joinedAt)한 이후 + 내 마지막 읽음(lastReadAt) 이후에
  // 남이 쓴 메시지. GREATEST가 NULL을 무시하므로 lastReadAt=NULL(아직 안 읽음)이면
  // joinedAt이 기준선이 된다 — 초대 전 과거 대화가 통째로 미읽음으로 잡히지 않는다.
  const unreadRows = await db
    .select({ roomId: chatMessages.roomId, count: sql<number>`count(*)::int` })
    .from(chatMessages)
    .innerJoin(
      chatRoomMembers,
      and(eq(chatRoomMembers.roomId, chatMessages.roomId), eq(chatRoomMembers.userId, meId))
    )
    .where(
      and(
        inArray(chatMessages.roomId, roomIds),
        ne(chatMessages.authorId, meId),
        gt(
          chatMessages.createdAt,
          sql`GREATEST(${chatRoomMembers.lastReadAt}, ${chatRoomMembers.joinedAt})`
        )
      )
    )
    .groupBy(chatMessages.roomId);
  const unreadByRoom = new Map(unreadRows.map((r) => [r.roomId, r.count]));

  const summaries = rooms.map((room) => {
    const last = lastByRoom.get(room.id);
    return {
      id: room.id,
      name: room.name,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
      members: (memberMap.get(room.id) ?? [])
        .map((m) => userById.get(m.userId))
        .filter((u): u is PublicUser => !!u),
      lastMessage: last
        ? {
            id: last.id,
            text: last.text,
            authorId: last.authorId,
            createdAt: last.createdAt,
            hasAttachments: (last.attachments ?? []).length > 0,
          }
        : null,
      unreadCount: unreadByRoom.get(room.id) ?? 0,
    };
  });
  // 최근 대화 순 (메시지 없는 방은 생성 시각)
  summaries.sort((a, b) => {
    const ta = (a.lastMessage?.createdAt ?? a.createdAt).getTime();
    const tb = (b.lastMessage?.createdAt ?? b.createdAt).getTime();
    return tb - ta;
  });
  return summaries;
}

/** Every dm room I'm a member of — deliberately NOT workspace-scoped.
 *  Relationships travel with the person, not the workspace: your partner must
 *  see the room (and its contract banner) without ever entering your
 *  workspace. */
async function myDmRooms(meId: string): Promise<ChatRoom[]> {
  const rows = await db
    .select({ room: chatRooms })
    .from(chatRoomMembers)
    .innerJoin(chatRooms, eq(chatRooms.id, chatRoomMembers.roomId))
    .where(and(eq(chatRoomMembers.userId, meId), eq(chatRooms.kind, "dm")));
  return rows.map((r) => r.room);
}

/** GET /api/dm/rooms → { rooms: DmRoomSummary[] } (최근 대화 순) */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const rooms = await myDmRooms(auth.user.id);
  return NextResponse.json({ rooms: await buildSummaries(auth.user.id, rooms) });
}

/** POST /api/dm/rooms { memberIds: string[], name? } → { room: DmRoomSummary }.
 *  1:1(상대 1명)은 기존 방이 있으면 재사용(200), 없으면 생성(201). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const meId = auth.user.id;
  const workspaceId = await getDefaultWorkspaceId(meId);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const rawIds: unknown[] = Array.isArray(body?.memberIds) ? body.memberIds : [];
  const memberIds = [
    ...new Set(
      rawIds.filter((v): v is string => typeof v === "string" && UUID_RE.test(v) && v !== meId)
    ),
  ];
  if (memberIds.length === 0)
    return NextResponse.json({ error: "memberIds required" }, { status: 400 });
  if (memberIds.length > MAX_MEMBERS)
    return NextResponse.json({ error: `Too many members (max ${MAX_MEMBERS})` }, { status: 400 });
  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";

  // 1:1 방의 불변 정체성 키 — 멤버십이 변해도 안 바뀐다(그룹/agent 방은 null)
  const directKey =
    memberIds.length === 1 ? [meId, memberIds[0]].sort().join("|") : null;

  // 초대 대상은 전원 같은 워크스페이스 멤버여야 한다 (워크스페이스 밖 사용자 노출 금지)
  const wsRows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, memberIds))
    );
  if (wsRows.length !== memberIds.length)
    return NextResponse.json({ error: "All members must be in your workspace" }, { status: 400 });

  // 1:1 중복 방지 — directKey로 조회(불변 키라 과거 그룹방이 새 1:1을 가로채지 못한다)
  if (directKey) {
    const [existing] = await db
      .select()
      .from(chatRooms)
      .where(
        and(
          eq(chatRooms.kind, "dm"),
          eq(chatRooms.workspaceId, workspaceId),
          eq(chatRooms.directKey, directKey)
        )
      )
      .limit(1);
    if (existing) {
      const [summary] = await buildSummaries(meId, [existing]);
      return NextResponse.json({ room: summary });
    }
  }

  // 관계 방은 계약 서명제 — 멤버 전원(커플이든 그룹이든)이 지갑으로 계약
  // (/consent)에 서명해야 consentAt이 찍히고 에이전트가 태어난다. 지갑 없는
  // 멤버(데모 계정 등)가 섞인 방만 기존 간소화(즉시 동의)를 유지한다.
  const allMemberIds = [meId, ...memberIds];
  const memberRows = await db
    .select({ id: users.id, address: users.ainAddress, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, allMemberIds));
  const allWallets =
    memberRows.length === allMemberIds.length &&
    memberRows.every((r) => /^0x[0-9a-f]{40}$/i.test(r.address));
  // relationship rooms are named after their people: "{me} ❤️ {partner}"
  const byId = new Map(memberRows.map((r) => [r.id, r.displayName]));
  const roomName =
    name ||
    (directKey
      ? `${byId.get(meId) ?? "Me"} ❤️ ${byId.get(memberIds[0]) ?? "Partner"}`
      : "");
  const [room] = await db
    .insert(chatRooms)
    .values({
      name: roomName,
      kind: "dm",
      workspaceId,
      createdBy: meId,
      consentAt: allWallets ? null : new Date(),
      directKey,
    })
    .returning();
  await db
    .insert(chatRoomMembers)
    .values(allMemberIds.map((userId) => ({ roomId: room.id, userId })))
    .onConflictDoNothing();

  await publishToRoomMembers(
    room.id,
    { type: "dm-room", clientId: req.headers.get("x-client-id") },
    allMemberIds
  );

  const [summary] = await buildSummaries(meId, [room]);
  return NextResponse.json({ room: summary }, { status: 201 });
}
