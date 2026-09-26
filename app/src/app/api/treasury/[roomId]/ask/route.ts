import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/i18n/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { humanMemberIds } from "@/lib/agent/treasury/memory";
import { agUiStream, eventId } from "@/lib/agui/events";
import { postRoomMessage, privateHistory } from "@/lib/agent/treasurer/history";
import { logLine, runTreasurer } from "@/lib/agent/treasurer/loop";
import { treasurerSystemPrompt } from "@/lib/agent/treasurer/prompt";
import { recurringBuyMarker } from "@/lib/agent/treasurer/surfaces";
import { roomAgent } from "@/lib/agent/treasurer/tools";

export const dynamic = "force-dynamic";

const MAX_QUESTION = 2_000;

/**
 * The treasurer (the room's agent, with tools) for one member.
 *
 *   GET  → { agent: { name }, messages } — the member's quiet exchanges with
 *          the agent, oldest first (the conversation the page reopens with)
 *   POST { message, mode: "private" | "room" } → text/event-stream of AG-UI
 *          events. The question and the answer are saved as chat messages:
 *          "private" keeps both quiet to the asker (privateToUserId), "room"
 *          posts them as ordinary room messages everyone sees.
 *
 * Human members only: the agent answering the room's money questions to an
 * outsider — or to another agent — would leak what the room keeps.
 */
async function gate(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return { error: auth.error };
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return { error: access.error };
  if (!(await humanMemberIds(roomId)).includes(auth.user.id))
    return { error: NextResponse.json({ error: "Only human members of this room can talk to its treasurer" }, { status: 403 }) };
  const agent = await roomAgent(roomId);
  if (!agent) return { error: NextResponse.json({ error: "This room has no agent" }, { status: 404 }) };
  return { user: auth.user, room: access.room, agent };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const g = await gate(req, ctx);
  if ("error" in g) return g.error;
  const messages = await privateHistory(g.room.id, g.user.id, g.agent.agentUserId);
  return NextResponse.json({ agent: { name: g.agent.displayName }, messages });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const g = await gate(req, ctx);
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => ({}));
  const question = typeof body?.message === "string" ? body.message.trim() : "";
  if (!question) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  if (question.length > MAX_QUESTION)
    return NextResponse.json({ error: `Message too long (max ${MAX_QUESTION})` }, { status: 400 });
  const mode: "private" | "room" = body?.mode === "room" ? "room" : "private";

  const { user, room, agent } = g;
  const t = await getT(user.language);
  const privateTo = mode === "private" ? user.id : null;
  // read before the question is saved, so it isn't in its own history
  const history = await privateHistory(room.id, user.id, agent.agentUserId);
  const asked = await postRoomMessage({ roomId: room.id, authorId: user.id, text: question, privateToUserId: privateTo });

  return agUiStream(
    async (emit, signal) => {
      const threadId = `treasurer-${room.id}-${user.id}`;
      const runId = eventId("run");
      emit({ type: "RUN_STARTED", threadId, runId });
      const system = await treasurerSystemPrompt({
        roomId: room.id,
        roomName: room.name,
        agentName: agent.displayName,
        askerName: user.displayName,
      });
      const answer = await runTreasurer({
        ctx: { roomId: room.id, agentUserId: agent.agentUserId, askerId: user.id, askerName: user.displayName, t },
        system,
        history,
        question,
        emit,
        signal,
      });
      // a quiet answer keeps its cards, so reopening the conversation redraws them; in the room
      // the proposal card is already posted (tools.ts), and a second copy would only repeat it
      const saved =
        mode === "private" ? [answer.text, ...answer.cardActionIds.map(recurringBuyMarker)].join("\n") : answer.text;
      const posted = await postRoomMessage({
        roomId: room.id,
        authorId: agent.agentUserId,
        text: saved,
        privateToUserId: privateTo,
        byAgent: true,
      });
      emit({ type: "RUN_FINISHED", threadId, runId, result: { mode, questionId: asked.id, answerId: posted.id } });
    },
    {
      failureMessage: t("The treasurer couldn't finish that answer. Anything it already did shows in the treasury — try again."),
      onError: (err) => console.error("treasurer: run failed:", logLine(err)),
    }
  );
}
