import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { agentRoomStates, chatRoomMembers, pageMembers, users, workspaceMembers } from "@/lib/db/schema";
import { toPublicUser } from "@/lib/auth/public-user";
import { publishToRoomMembers, requireRoomAccess, roomMemberIds, UUID_RE } from "@/lib/chat-room-access";

export const dynamic = "force-dynamic";

/** If a (restricted) relationship doc already exists, grant the new member read access too. */
async function grantDocAccess(roomId: string, userId: string) {
  const [state] = await db
    .select({ rootPageId: agentRoomStates.rootPageId, sectionPageIds: agentRoomStates.sectionPageIds })
    .from(agentRoomStates)
    .where(eq(agentRoomStates.roomId, roomId));
  if (!state?.rootPageId) return;
  const pageIds = [state.rootPageId, ...Object.values(state.sectionPageIds ?? {})];
  await db
    .insert(pageMembers)
    .values(pageIds.map((pageId) => ({ pageId, userId, permission: "full" as const })))
    .onConflictDoNothing();
}

/** POST /api/dm/rooms/{roomId}/members { userId } → { member } (invite a same-workspace member) */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  const { room } = access;

  const body = await req.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" && UUID_RE.test(body.userId) ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (!room.workspaceId)
    return NextResponse.json({ error: "Room has no workspace" }, { status: 400 });

 // invitees must belong to the room's workspace
  const [ws] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, room.workspaceId), eq(workspaceMembers.userId, userId))
    )
    .limit(1);
  if (!ws)
    return NextResponse.json({ error: "Not a workspace member" }, { status: 400 });

  await db.insert(chatRoomMembers).values({ roomId, userId }).onConflictDoNothing();
  await grantDocAccess(roomId, userId);

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
 // notify everyone including the new member (their sidebar must show the room too)
  await publishToRoomMembers(roomId, {
    type: "dm-room",
    clientId: req.headers.get("x-client-id"),
  });
  return NextResponse.json({ member: target ? toPublicUser(target) : null }, { status: 201 });
}

/** DELETE /api/dm/rooms/{roomId}/members?userId= → { ok }.
 * Anyone may leave; only the room creator removes others. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  const { room } = access;

  const target = req.nextUrl.searchParams.get("userId") ?? auth.user.id;
  if (!UUID_RE.test(target))
    return NextResponse.json({ error: "Bad userId" }, { status: 400 });
  if (target !== auth.user.id && room.createdBy !== auth.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

 // the leaver needs the event too so the room vanishes from their sidebar — capture members before deleting
  const ids = await roomMemberIds(roomId);
  await db
    .delete(chatRoomMembers)
    .where(and(eq(chatRoomMembers.roomId, roomId), eq(chatRoomMembers.userId, target)));
  await publishToRoomMembers(
    roomId,
    { type: "dm-room", clientId: req.headers.get("x-client-id") },
    ids
  );
  return NextResponse.json({ ok: true });
}
