import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatMessages } from "@/lib/db/schema";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { maybeAutoRun } from "@/lib/agent/triggers";
import type { RunResult } from "@/lib/agent/pipeline";

export const dynamic = "force-dynamic";
const MAX_TEXT = 8_000;

/** GET /api/agent/rooms/{roomId}/messages → { messages } */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  // agent rooms only — DM rooms use /api/dm/rooms/* (different body/read/realtime contracts)
  if (access.room.kind !== "agent")
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.roomId, roomId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return NextResponse.json({ messages });
}

/** POST { text } → { message, autoRun? } — run now at K+ pending, else schedule on idle. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  const { room } = access;
  if (room.kind !== "agent")
    return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Empty text" }, { status: 400 });
  if (text.length > MAX_TEXT)
    return NextResponse.json({ error: `Text too long (max ${MAX_TEXT})` }, { status: 400 });

  // authorId is always the session user — never client-supplied (no spoofing)
  const [message] = await db
    .insert(chatMessages)
    .values({ roomId, authorId: auth.user.id, text })
    .returning();

  const autoRun: RunResult | undefined = await maybeAutoRun(room);
  return NextResponse.json({ message, autoRun }, { status: 201 });
}
