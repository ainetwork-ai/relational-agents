import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { isServableAssetUrl } from "@/lib/files/serve";
import { db } from "@/lib/db";
import { chatMessages, chatRoomBots, chatRoomMembers } from "@/lib/db/schema";
import {
  publishToRoomMembers,
  requireRoomAccess,
  visibleRoomMessages,
} from "@/lib/chat-room-access";
import { maybeAutoRun } from "@/lib/agent/triggers";
import { dispatchToRoomBots } from "@/lib/agent/dispatch";
import { buyEggTarts, isBuyEggTartsCommand } from "@/lib/agent/spend";

export const dynamic = "force-dynamic";

const MAX_TEXT = 8_000;
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_NAME = 200;

interface Attachment {
  url: string;
  name: string;
}

/** Only what the upload API hands the browser — a legacy /uploads/* file name or
 *  the key-addressed /api/files/key/… path — never an external or scheme url. */
function parseAttachments(raw: unknown): Attachment[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null;
  const out: Attachment[] = [];
  for (const item of raw) {
    const url = (item as { url?: unknown })?.url;
    const name = (item as { name?: unknown })?.name;
    if (typeof url !== "string" || !isServableAssetUrl(url)) return null;
    out.push({
      url,
      name: typeof name === "string" ? name.slice(0, MAX_ATTACHMENT_NAME) : "file",
    });
  }
  return out;
}

/** GET /api/dm/rooms/{roomId}/messages → { messages } (ascending) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
 // Private agent exchanges are visible only to the member they belong to.
  const messages = await visibleRoomMessages(roomId, auth.user.id);
  return NextResponse.json({ messages });
}

/** POST { text?, attachments?: [{url,name}], quiet? } → { message, autoRun? }.
 * Sending marks read and publishes a dm-message notice (no body) to member inboxes. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  const { room } = access;

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const attachments = parseAttachments(body?.attachments);
  if (attachments === null)
    return NextResponse.json({ error: "Bad attachments" }, { status: 400 });
  if (!text && attachments.length === 0)
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  if (text.length > MAX_TEXT)
    return NextResponse.json({ error: `Text too long (max ${MAX_TEXT})` }, { status: 400 });

 // Asking quietly is a mode the sender picks, not something we infer from the
 // wording. Mentioning the agent is an ordinary mention — it answers in the
 // room, where both of them see it. A quiet message and its answer stay with
 // the asker and never reach the shared record, so the switch that does that
 // has to be one the sender can see themselves holding.
  const { chatRoomBots: bots } = await import("@/lib/db/schema");
  const [roomBot] = await db.select().from(bots).where(eq(bots.roomId, roomId));
 // no agent in the room means there is nobody to be quiet with
  const privateToUserId = body?.quiet === true && roomBot ? auth.user.id : null;

 // authorId is always the session user — never client-supplied (no spoofing)
  const [message] = await db
    .insert(chatMessages)
    .values({ roomId, authorId: auth.user.id, text, attachments, privateToUserId })
    .returning();

 // the sender has read their own message — advance the unread baseline
  await db
    .update(chatRoomMembers)
    .set({ lastReadAt: new Date() })
    .where(and(eq(chatRoomMembers.roomId, roomId), eq(chatRoomMembers.userId, auth.user.id)));

  await publishToRoomMembers(roomId, {
    type: "dm-message",
    clientId: req.headers.get("x-client-id"),
  });

 // DM rooms share the agent rooms' harvest trigger — K+ pending now / idle scheduling
  const autoRun = await maybeAutoRun(room);

 // No "saved it!" bubble: this is a room between two people, and an assistant
 // narrating its own bookkeeping pushes their conversation off screen. The
 // pipeline stamps recordedAt on the messages it used and the transcript shows
 // a quiet marker there instead.
  if (autoRun && autoRun.edits > 0) {
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: null });
  }

 // "@agent buy egg tarts" is the one sentence that spends money, so it is
 // matched exactly rather than interpreted: the model may talk about egg tarts
 // all it likes, but only this exact line moves the agent's wallet. Handled
 // before the bots see it, so the agent acts instead of replying about it.
  if (isBuyEggTartsCommand(text)) {
    const [bot] = await db
      .select({ agentUserId: chatRoomBots.agentUserId })
      .from(chatRoomBots)
      .where(eq(chatRoomBots.roomId, roomId))
      .limit(1);
    if (bot) {
      void buyEggTarts(bot.agentUserId, roomId, req.nextUrl.origin).catch((err) =>
        console.error("chat-triggered spend failed:", err)
      );
      return NextResponse.json({ message, autoRun }, { status: 201 });
    }
  }

 // A2A delivery to the room's imported bots (spec v2 §5) — fire-and-forget, never blocks the response
  void dispatchToRoomBots(room, message).catch((err) =>
    console.error("bot dispatch failed:", err)
  );
  return NextResponse.json({ message, autoRun }, { status: 201 });
}
