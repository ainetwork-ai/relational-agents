import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/i18n/server";
import { requireAuth } from "@/lib/auth/middleware";
import { UUID_RE, requireRoomAccess } from "@/lib/chat-room-access";
import { humanMemberIds } from "@/lib/agent/treasury/memory";
import { recurringBuyStatus } from "@/lib/agent/treasury/recurring";
import { parseA2uiAction } from "@/lib/x402/a2ui";
import { runNote } from "@/lib/agent/treasury/run-note";
import { TREASURY_BUY_ACTION, TREASURY_STOP_ACTION } from "@/lib/agent/treasurer/surfaces";
import { recurringBuySurfaceFor, roomAgent, runAndAnnounce, stopAndAnnounce } from "@/lib/agent/treasurer/tools";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ roomId: string; actionId: string }> };

/**
 * One recurring buy's A2UI card (lib/agent/treasurer/surfaces.ts), as the
 * viewer sees it now — what the room chat draws for a
 * `[[a2ui:recurring-buy/<id>]]` line and the treasurer streams.
 *
 *   GET                         → { messages } (A2UI v0.9)
 *   POST { action }             → the card's own actions:
 *                                 `ainmem.treasury.stop` and
 *                                 `ainmem.treasury.buy` (approve navigates to
 *                                 the World ID page, open to the Treasury
 *                                 page); answers { messages } redrawn, with
 *                                 the outcome as the card's notice. A buy runs
 *                                 the week the way the chat command does —
 *                                 the server buys, skips or rehearses.
 */
async function gate(req: NextRequest, ctx: Params) {
  const auth = await requireAuth();
  if ("error" in auth) return { error: auth.error };
  const { roomId, actionId } = await ctx.params;
  if (!UUID_RE.test(actionId)) return { error: NextResponse.json({ error: "Bad action id" }, { status: 400 }) };
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return { error: access.error };
  return { user: auth.user, roomId, actionId };
}

export async function GET(req: NextRequest, ctx: Params) {
  const g = await gate(req, ctx);
  if ("error" in g) return g.error;
  const t = await getT(g.user.language);
  const messages = await recurringBuySurfaceFor(g.roomId, g.actionId, g.user.id, t);
  if (!messages) return NextResponse.json({ error: "No such recurring buy in this room" }, { status: 404 });
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, ctx: Params) {
  const g = await gate(req, ctx);
  if ("error" in g) return g.error;
  const t = await getT(g.user.language);
  const action = parseA2uiAction(await req.json().catch(() => null));
  if (!action || (action.name !== TREASURY_STOP_ACTION && action.name !== TREASURY_BUY_ACTION))
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!(await humanMemberIds(g.roomId)).includes(g.user.id))
    return NextResponse.json({ error: "Only human members can act on the recurring buy" }, { status: 403 });
  const agent = await roomAgent(g.roomId);
  if (!agent) return NextResponse.json({ error: "This room has no agent" }, { status: 404 });

  // the card acts only on what it shows: a stale card of an old request must not stop or buy under the one running now
  const status = await recurringBuyStatus(g.roomId);
  let notice: string;
  if (action.name === TREASURY_BUY_ACTION) {
    notice =
      status.live?.actionId !== g.actionId
        ? t("This recurring buy isn't running any more — nothing to buy.")
        : runNote(
            (await runAndAnnounce({ roomId: g.roomId, agentUserId: agent.agentUserId, askerId: g.user.id, askerName: g.user.displayName, t })).run,
            t
          ).text;
  } else if (status.live?.actionId !== g.actionId && status.pending?.actionId !== g.actionId) {
    notice = t("This recurring buy isn't running any more — nothing to stop.");
  } else {
    const stopped = await stopAndAnnounce({
      roomId: g.roomId,
      agentUserId: agent.agentUserId,
      askerId: g.user.id,
      askerName: g.user.displayName,
      t,
    });
    notice = stopped.ok ? stopped.line : stopped.reason;
  }
  const messages = await recurringBuySurfaceFor(g.roomId, g.actionId, g.user.id, t, notice);
  if (!messages) return NextResponse.json({ error: "No such recurring buy in this room" }, { status: 404 });
  return NextResponse.json({ messages });
}
