import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatRoomBots, chatRoomMembers, chatRooms, users, workspaces } from "@/lib/db/schema";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { provisionRoomAgent } from "@/lib/agent/provision";
import { ASSISTANT_ROOM } from "@/lib/agent/assistant-room";
import { sharedDriveSources } from "@/lib/agent/shared-drives";
import { driveOnline } from "@/lib/aindrive";
import { runAsOrService } from "@/lib/aindrive-account";

export const dynamic = "force-dynamic";


/**
 * GET → { roomId, agentId, agentName, drives: [{ label, owner, online }] }
 *
 * The caller's own agent in the active workspace (the round button, bottom
 * right): a room of one person and one agent, made on first open. With nobody
 * else in the room, the agent reads every aindrive folder shared into the
 * teamspaces the caller can see — each family member's phone, read as them.
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 404 });
  const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));

  let [room] = await db
    .select()
    .from(chatRooms)
    .where(and(eq(chatRooms.workspaceId, workspaceId), eq(chatRooms.createdBy, auth.user.id), eq(chatRooms.kind, "agent"), eq(chatRooms.name, ASSISTANT_ROOM)))
    .limit(1);
  if (!room) {
    [room] = await db
      .insert(chatRooms)
      .values({ name: ASSISTANT_ROOM, kind: "agent", workspaceId, createdBy: auth.user.id, consentAt: new Date() })
      .returning();
    await db.insert(chatRoomMembers).values({ roomId: room.id, userId: auth.user.id });
    const { agentUserId } = await provisionRoomAgent(room, [auth.user.id], auth.user.id);
    await db.update(users).set({ displayName: `${ws?.name ?? ""} 에이전트`.trim() }).where(eq(users.id, agentUserId));
  }
  const [bot] = await db
    .select({ id: users.id, name: users.displayName })
    .from(chatRoomBots)
    .innerJoin(users, eq(users.id, chatRoomBots.agentUserId))
    .where(eq(chatRoomBots.roomId, room.id))
    .limit(1);
  const sources = await sharedDriveSources(workspaceId, [auth.user.id]).catch(() => []);
  const online = await Promise.all(
    sources.map((s) => runAsOrService(s.linkedBy, () => driveOnline(s.link.driveId)).catch(() => false))
  );
  return NextResponse.json({
    roomId: room.id,
    agentId: bot?.id ?? null,
    agentName: bot?.name ?? "에이전트",
    drives: sources.map((s, i) => ({ label: s.label, owner: s.ownerName ?? null, online: online[i] })),
  });
}
