import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatMessages, chatRoomMembers } from "@/lib/db/schema";
import { publishToRoomMembers, requireRoomAccess } from "@/lib/chat-room-access";
import { maybeAutoRun } from "@/lib/agent/triggers";
import { dispatchToRoomBots } from "@/lib/agent/dispatch";

export const dynamic = "force-dynamic";

const MAX_TEXT = 8_000;
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_NAME = 200;

interface Attachment {
  url: string;
  name: string;
}

/** Only same-origin /uploads/* paths from the upload API are allowed (blocks external/scheme injection). */
function parseAttachments(raw: unknown): Attachment[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null;
  const out: Attachment[] = [];
  for (const item of raw) {
    const url = (item as { url?: unknown })?.url;
    const name = (item as { name?: unknown })?.name;
    if (typeof url !== "string" || !/^\/uploads\/[A-Za-z0-9._-]+$/.test(url)) return null;
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
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.roomId, roomId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return NextResponse.json({ messages });
}

/** POST { text?, attachments?: [{url,name}] } → { message, autoRun? }.
 *  Sending marks read and publishes a dm-message notice (no body) to member inboxes. */
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

  // authorId is always the session user — never client-supplied (no spoofing)
  const [message] = await db
    .insert(chatMessages)
    .values({ roomId, authorId: auth.user.id, text, attachments })
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

  // When the agent just recorded something, let it react in the room so the
  // memory is visible — "saved this to our story" with a link to the doc.
  if (autoRun && autoRun.edits > 0 && auth.user.id !== null) {
    try {
      const { chatRoomBots } = await import("@/lib/db/schema");
      const [bot] = await db.select().from(chatRoomBots).where(eq(chatRoomBots.roomId, roomId));
      if (bot) {
        const hadImage = attachments.length > 0;
        await db.insert(chatMessages).values({
          roomId,
          authorId: bot.agentUserId,
          text: hadImage
            ? "📌 Saved this moment to our story — photo and all. I'll remember it for us. 💞"
            : "📌 Noted — I've added that to our relationship's memory. 💞",
        });
        await publishToRoomMembers(roomId, { type: "dm-message", clientId: null });
      }
    } catch (err) {
      console.error("agent ack failed:", err);
    }
  }

  // A2A delivery to the room's imported bots (spec v2 §5) — fire-and-forget, never blocks the response
  void dispatchToRoomBots(room, message).catch((err) =>
    console.error("bot dispatch failed:", err)
  );
  return NextResponse.json({ message, autoRun }, { status: 201 });
}
