import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/i18n/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { RecurringBuyRefusal, logLine } from "@/lib/agent/treasury/recurring";
import { roomAgent, runAndAnnounce, stopAndAnnounce } from "@/lib/agent/treasurer/tools";

export const dynamic = "force-dynamic";

/**
 * POST { action: "run" | "stop" } → the buttons on the room's recurring buy
 * (treasury panel, Treasury page). recurring.ts decides who may (run: a voting
 * member; stop: any human member) and writes the Treasury Activity line; the
 * room's agent tells the room about a stop or a real buy, as it does when the
 * treasurer or the card does it (tools.ts). Only fixed sentences go back to
 * the browser.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== "run" && body.action !== "stop")
    return NextResponse.json({ error: 'action must be "run" or "stop"' }, { status: 400 });
  const agent = await roomAgent(roomId);
  if (!agent) return NextResponse.json({ error: "This room has no agent" }, { status: 404 });
  const asker = {
    roomId,
    agentUserId: agent.agentUserId,
    askerId: auth.user.id,
    askerName: auth.user.displayName,
    t: await getT(auth.user.language),
  };

  if (body.action === "stop") {
    const stopped = await stopAndAnnounce(asker);
    return stopped.ok
      ? NextResponse.json({ ok: true, actionId: stopped.actionId })
      : NextResponse.json({ error: stopped.reason }, { status: 409 });
  }

  try {
    const { run } = await runAndAnnounce(asker);
    return NextResponse.json({ ok: true, result: run });
  } catch (err) {
    if (err instanceof RecurringBuyRefusal) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error(`recurring route: run failed for room ${roomId}:`, logLine(err));
    return NextResponse.json(
      { error: "Couldn't read the treasury wallet right now — nothing was bought. Try again in a moment." },
      { status: 502 }
    );
  }
}
