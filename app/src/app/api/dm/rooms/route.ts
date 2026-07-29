import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import {
  agentRoomStates,
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
import { relationshipRoomName } from "@/lib/auth/display-name";

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
  /** the agent-maintained relationship doc's page id, when one exists —
   * OKF path encoded as base64url (legacy rooms: the Postgres page id) */
  docPageId: string | null;
}

/** Assemble my DM rooms into summaries (members, last message, unread count). */
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

 // unread = others' messages after I joined (joinedAt) AND after my last
 // read (lastReadAt). GREATEST ignores NULLs, so lastReadAt=NULL (never
 // read) baselines at joinedAt — pre-invite history doesn't all count as unread.
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

  // relationship doc link (agent_room_states) — structured, no title parsing
  const states = await db
    .select({
      roomId: agentRoomStates.roomId,
      rootPageId: agentRoomStates.rootPageId,
      rootOkfPath: agentRoomStates.rootOkfPath,
    })
    .from(agentRoomStates)
    .where(inArray(agentRoomStates.roomId, roomIds));
  const docByRoom = new Map(
    states.map((st) => [
      st.roomId,
      st.rootOkfPath
        ? Buffer.from(st.rootOkfPath, "utf8").toString("base64url")
        : st.rootPageId,
    ])
  );

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
      docPageId: docByRoom.get(room.id) ?? null,
    };
  });
 // most recent conversation first (rooms without messages sort by creation)
  summaries.sort((a, b) => {
    const ta = (a.lastMessage?.createdAt ?? a.createdAt).getTime();
    const tb = (b.lastMessage?.createdAt ?? b.createdAt).getTime();
    return tb - ta;
  });
  return summaries;
}

/** My dm rooms in the active workspace. Each relationship lives in its own
 * "{me} ❤️ {partner}" workspace, so scoping by workspace shows one room per
 * relationship in the space that relationship belongs to. */
async function myDmRooms(meId: string, workspaceId: string): Promise<ChatRoom[]> {
  const rows = await db
    .select({ room: chatRooms })
    .from(chatRoomMembers)
    .innerJoin(chatRooms, eq(chatRooms.id, chatRoomMembers.roomId))
    .where(
      and(
        eq(chatRoomMembers.userId, meId),
        eq(chatRooms.kind, "dm"),
        eq(chatRooms.workspaceId, workspaceId)
      )
    );
  return rows.map((r) => r.room);
}

/** GET /api/dm/rooms → { rooms: DmRoomSummary[] } (most recent first) */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });
  const rooms = await myDmRooms(auth.user.id, workspaceId);
  return NextResponse.json({ rooms: await buildSummaries(auth.user.id, rooms) });
}

/** POST /api/dm/rooms { memberIds: string[], name? } → { room: DmRoomSummary }.
 * 1:1 (single partner) reuses an existing room (200), else creates (201). */
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

 // immutable identity key for 1:1 rooms — survives membership changes (group/agent rooms: null)
  const directKey =
    memberIds.length === 1 ? [meId, memberIds[0]].sort().join("|") : null;

 // every invitee must belong to the same workspace (no exposure of outside users)
  const wsRows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, memberIds))
    );
  if (wsRows.length !== memberIds.length)
    return NextResponse.json({ error: "All members must be in your workspace" }, { status: 400 });

 // 1:1 dedup — looked up by directKey (immutable, so old group rooms can't hijack a fresh 1:1)
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

 // relationship rooms run on the signed contract — every member (couple or
 // group) signs via wallet (/consent) before consentAt stamps and the agent
 // is born. Only rooms with wallet-less members (demo accounts) keep the
 // legacy instant consent.
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
      ? relationshipRoomName(byId.get(meId) ?? "Me", byId.get(memberIds[0]) ?? "Partner")
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
