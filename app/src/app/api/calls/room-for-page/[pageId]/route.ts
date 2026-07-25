import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { agentRoomStates, chatRoomMembers, chatRooms } from "@/lib/db/schema";
import { docPageIdOf } from "@/lib/agent/pipeline";
import { decodeId, isOkfId } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/calls/room-for-page/{pageId} → { roomId } | 404
 *
 * Reverse lookup: which of MY dm rooms does this relationship-record page
 * belong to? Powers the call button on record pages. Matches the doc root
 * page exactly, or any page inside the root folder (Timeline.md etc.), so
 * the button shows on section pages too. Only the caller's own memberships
 * are searched — a page outside my relationships is a plain 404, leaking
 * nothing about other people's rooms.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ pageId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await ctx.params;

  const myRooms = await db
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .innerJoin(chatRoomMembers, eq(chatRoomMembers.roomId, chatRooms.id))
    .where(and(eq(chatRooms.kind, "dm"), eq(chatRoomMembers.userId, auth.user.id)));
  const roomIds = myRooms.map((r) => r.id);
  if (roomIds.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const states = await db
    .select()
    .from(agentRoomStates)
    .where(inArray(agentRoomStates.roomId, roomIds));

  const relPath = isOkfId(pageId) ? decodeId(pageId) : null;
  for (const state of states) {
    if (docPageIdOf(state) === pageId) return NextResponse.json({ roomId: state.roomId });
    // section page (Timeline.md, …) — path lives under the record's root folder
    if (relPath && state.rootOkfPath && relPath.startsWith(state.rootOkfPath + "/"))
      return NextResponse.json({ roomId: state.roomId });
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
