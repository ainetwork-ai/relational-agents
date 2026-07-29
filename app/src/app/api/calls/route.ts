import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { toPublicUser } from "@/lib/auth/public-user";
import { db } from "@/lib/db";
import { chatRoomMembers, users } from "@/lib/db/schema";
import { listCalls, RING_STALE_MS } from "@/lib/call-store";

export const dynamic = "force-dynamic";

/**
 * GET → { ringing: [{ roomId, caller }] } — calls currently ringing FOR me.
 *
 * The dm-call-ring event is notification-only; if the SSE inbox happens to be
 * reconnecting when it fires, the callee never sees the incoming card and the
 * caller rings into silence. IncomingCallHost calls this on every SSE hello,
 * so a missed ring recovers on reconnect.
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const me = auth.user.id;

  const candidates = listCalls().filter(
    (c) =>
      c.status === "ringing" &&
      c.callerId !== me &&
      Date.now() - c.startedAt <= RING_STALE_MS
  );
  if (candidates.length === 0) return NextResponse.json({ ringing: [] });

  // only rooms I belong to may ring me
  const roomIds = candidates.map((c) => c.roomId);
  const memberships = await db
    .select({ roomId: chatRoomMembers.roomId })
    .from(chatRoomMembers)
    .where(and(inArray(chatRoomMembers.roomId, roomIds), eq(chatRoomMembers.userId, me)));
  const mine = new Set(memberships.map((m) => m.roomId));
  const ringingForMe = candidates.filter((c) => mine.has(c.roomId));
  if (ringingForMe.length === 0) return NextResponse.json({ ringing: [] });

  const callerRows = await db
    .select()
    .from(users)
    .where(inArray(users.id, ringingForMe.map((c) => c.callerId)));
  const callerById = new Map(callerRows.map((u) => [u.id, toPublicUser(u)]));

  return NextResponse.json({
    ringing: ringingForMe
      .map((c) => ({ roomId: c.roomId, caller: callerById.get(c.callerId) ?? null }))
      .filter((r) => r.caller !== null),
  });
}
