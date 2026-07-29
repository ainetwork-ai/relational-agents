import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { agentRoomStates, chatRooms } from "@/lib/db/schema";
import { docPageIdOf } from "@/lib/agent/pipeline";

export const dynamic = "force-dynamic";

/** GET /api/agent/rooms → { rooms: (ChatRoom & { rootPageId })[] } — agent rooms only (no DMs) */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const rooms = await db
    .select()
    .from(chatRooms)
    .where(and(eq(chatRooms.createdBy, auth.user.id), eq(chatRooms.kind, "agent")))
    .orderBy(desc(chatRooms.createdAt));
  const states = await db.select().from(agentRoomStates);
  const stateBy = new Map(states.map((s) => [s.roomId, s]));
  return NextResponse.json({
    rooms: rooms.map((r) => ({ ...r, rootPageId: docPageIdOf(stateBy.get(r.id)) })),
  });
}

/** POST /api/agent/rooms { name } → { room }.
 * Demo shortcut: consentAt=now at creation (the real mutual-consent flow lives elsewhere). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "New relationship";
  const [room] = await db
    .insert(chatRooms)
    .values({ name, createdBy: auth.user.id, consentAt: new Date() })
    .returning();
  return NextResponse.json({ room }, { status: 201 });
}
