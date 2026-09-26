import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/i18n/server";
import { requireAuth } from "@/lib/auth/middleware";
import { UUID_RE, requireRoomAccess } from "@/lib/chat-room-access";
import { parseA2uiAction } from "@/lib/x402/a2ui";
import { answerSendOffer, endSend, offerRoom, postOfferReply, sendOfferCard, startSend, tFor } from "@/lib/agent/send-offer";
import { SEND_ANSWER_ACTION, SEND_CANCELLED_ACTION, SEND_FAILED_ACTION, SEND_GO_ACTION, type SendOfferView } from "@/lib/agent/send-offer-surface";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ offerId: string }> };

/**
 * The send-by-name skill's inline cards (lib/agent/send-offer-surface.ts), as the viewer sees
 * them now — what a chat draws for a `[[a2ui:send-check/<id>]]` or `[[a2ui:send/<id>]]` line.
 *
 *   GET  ?view=check|send          → { messages } (A2UI v0.9)
 *   POST ?view=… { action }        → the card's own actions, the asker's only:
 *        ainmem.send.answer {answer: yes|no}  "Is this Minjun?" — the agent replies in the chat
 *                                             (the Send card, or "Okay, I won't send it.")
 *        ainmem.send.go                       every check, then the one wallet request:
 *                                             { messages, wallet: {token, from, to, amountMicro} }
 *        ainmem.send.cancelled / .failed {reason}  what MetaMask said
 *      answers { messages } redrawn.
 * The transaction hash goes to /api/ens/send/confirm, which spends the intent and moves the card.
 */
async function gate(req: NextRequest, ctx: Params) {
  const auth = await requireAuth();
  if ("error" in auth) return { error: auth.error };
  const { offerId } = await ctx.params;
  if (!UUID_RE.test(offerId)) return { error: NextResponse.json({ error: "Bad offer id" }, { status: 400 }) };
  const roomId = await offerRoom(offerId);
  if (!roomId) return { error: NextResponse.json({ error: "No such card" }, { status: 404 }) };
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return { error: access.error };
  const view: SendOfferView = req.nextUrl.searchParams.get("view") === "send" ? "send" : "check";
  return { user: auth.user, offerId, view };
}

export async function GET(req: NextRequest, ctx: Params) {
  const g = await gate(req, ctx);
  if ("error" in g) return g.error;
  const card = await sendOfferCard(g.offerId, g.view, g.user.id, await getT(g.user.language));
  if (!card) return NextResponse.json({ error: "No such card" }, { status: 404 });
  return NextResponse.json({ messages: card.messages });
}

export async function POST(req: NextRequest, ctx: Params) {
  const g = await gate(req, ctx);
  if ("error" in g) return g.error;
  const t = await getT(g.user.language);
  const action = parseA2uiAction(await req.json().catch(() => null));
  if (!action) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const redraw = async (extra: Record<string, unknown> = {}, status = 200) => {
    const card = await sendOfferCard(g.offerId, g.view, g.user.id, t);
    return card ? NextResponse.json({ messages: card.messages, ...extra }, { status }) : NextResponse.json({ error: "No such card" }, { status: 404 });
  };

  if (action.name === SEND_ANSWER_ACTION) {
    const answer = action.context?.answer;
    if (answer !== "yes" && answer !== "no") return NextResponse.json({ error: "answer must be yes or no" }, { status: 400 });
    // the reply is the agent's, in the asker's language (the question was theirs)
    const reply = await answerSendOffer(g.offerId, g.user.id, answer, tFor(g.user.language));
    if (reply) await postOfferReply(g.offerId, reply.text);
    return redraw({}, reply ? 200 : 409);
  }
  if (action.name === SEND_GO_ACTION) {
    const r = await startSend(g.offerId, g.user.id);
    if (r.ok) return redraw({ wallet: r.wallet });
    return redraw({ refused: r.reason }, r.reason === "not-yours" ? 403 : 409);
  }
  if (action.name === SEND_CANCELLED_ACTION || action.name === SEND_FAILED_ACTION) {
    const reason = typeof action.context?.reason === "string" ? action.context.reason : null;
    await endSend(g.offerId, g.user.id, action.name === SEND_CANCELLED_ACTION ? "cancelled" : "failed", reason);
    return redraw();
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
