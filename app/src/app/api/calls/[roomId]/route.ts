import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { toPublicUser } from "@/lib/auth/public-user";
import { publishToRoomMembers, requireRoomAccess } from "@/lib/chat-room-access";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { chatMessages, type ChatRoom } from "@/lib/db/schema";
import { maybeAutoRun } from "@/lib/agent/triggers";
import { deleteCall, getCall, setCall, RING_STALE_MS, type CallSdp } from "@/lib/call-store";
import type { PageEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/**
 * Video-call signaling for a DM room — one live call per room, state in
 * memory (lib/call-store). Events are notification-only like every other
 * dm-* event: receivers GET this route to learn the actual state, so a
 * missed frame is recovered by the next refetch (SSE hello → refetch).
 *
 * Two phases:
 *  - ring:  invite / cancel / accept / decline  (no SDP)
 *  - media: offer / answer — non-trickle, one complete SDP each way,
 *           posted once both parties are on /call/{roomId}.
 */

/** GET → { call: CallState | null } */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  return NextResponse.json({ call: getCall(roomId) });
}

interface CallActionBody {
  action?: "invite" | "cancel" | "accept" | "decline" | "offer" | "answer" | "end";
  sdp?: CallSdp;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** KakaoTalk-style call record in the chat: a regular room message (author =
 * the caller) whose "📞 " prefix the DM view renders as a call bubble. Same
 * insert → publish → harvest dance as messages POST, so the bubble reaches
 * open panels live and the agent records that the call happened. */
async function postCallEvent(room: ChatRoom, authorId: string, text: string) {
  await db.insert(chatMessages).values({ roomId: room.id, authorId, text });
  await publishToRoomMembers(room.id, { type: "dm-message", clientId: null });
  const autoRun = await maybeAutoRun(room);
  if (autoRun && autoRun.edits > 0)
    await publishToRoomMembers(room.id, { type: "dm-message", clientId: null });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const body = (await req.json().catch(() => null)) as CallActionBody | null;
  const action = body?.action;
  const clientId = req.headers.get("x-client-id");
  const me = auth.user.id;
  const call = getCall(roomId);

  const notify = (type: PageEvent["type"], withUser = false) =>
    publishToRoomMembers(roomId, {
      type,
      clientId,
      ...(withUser ? { user: toPublicUser(auth.user) } : {}),
    });

  // one line per transition — today's "why is nobody ringing" hunts took
  // screenshots and guesswork; this makes them a grep
  console.log(
    `[call] ${action} room=${roomId.slice(0, 8)} by=${me.slice(0, 8)} was=${
      call ? call.status : "none"
    }`
  );

  switch (action) {
    case "invite": {
      // a ringing call nobody answered goes stale; an active call blocks
      if (call && !(call.status === "ringing" && Date.now() - call.startedAt > RING_STALE_MS))
        return NextResponse.json({ error: "Call already in progress" }, { status: 409 });
      setCall({
        roomId,
        callId: randomUUID(),
        callerId: me,
        status: "ringing",
        startedAt: Date.now(),
      });
      await notify("dm-call-ring", true);
      break;
    }
    case "cancel": {
      if (call && call.callerId !== me)
        return NextResponse.json({ error: "Only the caller can cancel" }, { status: 403 });
      deleteCall(roomId);
      await notify("dm-call-cancel");
      if (call) void postCallEvent(access.room, call.callerId, "📞 Missed call").catch(console.error);
      break;
    }
    case "accept": {
      if (!call || call.status !== "ringing")
        return NextResponse.json({ error: "No ringing call" }, { status: 409 });
      if (call.callerId === me)
        return NextResponse.json({ error: "Caller cannot accept" }, { status: 403 });
      setCall({ ...call, calleeId: me, status: "active", acceptedAt: Date.now() });
      await notify("dm-call-accept");
      void postCallEvent(access.room, call.callerId, "📞 Video Call").catch(console.error);
      break;
    }
    case "decline": {
      if (!call || call.callerId === me)
        return NextResponse.json({ error: "No call to decline" }, { status: 409 });
      deleteCall(roomId);
      await notify("dm-call-decline");
      void postCallEvent(access.room, call.callerId, "📞 Missed call").catch(console.error);
      break;
    }
    case "offer":
    case "answer": {
      if (!call || call.status !== "active")
        return NextResponse.json({ error: "No active call" }, { status: 409 });
      const sdp = body?.sdp;
      if (!sdp || typeof sdp.type !== "string" || typeof sdp.sdp !== "string")
        return NextResponse.json({ error: "Bad sdp" }, { status: 400 });
      // a fresh offer voids any earlier answer — otherwise a page that joins
      // a leftover call applies the STALE answer to its new pc and the media
      // never connects ("Connecting…" forever)
      setCall(
        action === "offer" ? { ...call, offer: sdp, answer: undefined } : { ...call, answer: sdp }
      );
      await notify("dm-call-signal");
      break;
    }
    case "end": {
      deleteCall(roomId);
      await notify("dm-call-end");
      if (call) {
        // ended mid-ring == the caller gave up — that's a missed call
        const text =
          call.status === "active" && call.acceptedAt
            ? `📞 Video Call ended · ${mmss(Date.now() - call.acceptedAt)}`
            : "📞 Missed call";
        void postCallEvent(access.room, call.callerId, text).catch(console.error);
      }
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json({ call: getCall(roomId) });
}
