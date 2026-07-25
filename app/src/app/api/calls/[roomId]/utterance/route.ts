import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { callUtterances } from "@/lib/db/schema";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { getCall } from "@/lib/call-store";
import { watchUtterance } from "@/lib/agent/call-watch";

export const dynamic = "force-dynamic";

const MAX_TEXT = 2_000;

/**
 * POST { text } — one transcribed utterance from the live call.
 *
 * Speech does not become chat. The two of them see only what they typed; this
 * feeds the agent, which keeps the relationship record current and decides
 * whether to say something. The speaker is the session user, since each client
 * transcribes its own microphone — no diarization to get wrong.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const call = getCall(roomId);
  if (!call || call.status !== "active")
    return NextResponse.json({ error: "No active call" }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Empty utterance" }, { status: 400 });

  const [utterance] = await db
    .insert(callUtterances)
    .values({
      roomId,
      callId: call.callId,
      speakerId: auth.user.id, // never client-supplied
      text: text.slice(0, MAX_TEXT),
    })
    .returning();

  // Judge it out of band: the speaker's client must not wait on the agent to
  // finish thinking before the next sentence can be posted.
  void watchUtterance(roomId, call.callId, auth.user.id, utterance.text).catch((err) =>
    console.error("call watch failed:", err)
  );

  return NextResponse.json({ utterance: { id: utterance.id, callId: utterance.callId } }, { status: 201 });
}
