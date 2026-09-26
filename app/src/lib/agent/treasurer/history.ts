import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages } from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";

/**
 * The treasurer's conversation is the asker's quiet side-channel with the
 * room's agent — the same rows a "quiet" room message and its answer make
 * (chat_messages.privateToUserId = the asker; visibleRoomMessages shows them
 * to that member only). So the Treasury page and the room chat are one
 * conversation, and nothing here needs a table of its own.
 */

export const HISTORY_LIMIT = 20;

export interface TreasurerTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

/** The asker's last quiet exchanges with the agent, oldest first. */
export async function privateHistory(
  roomId: string,
  askerId: string,
  agentUserId: string,
  limit = HISTORY_LIMIT
): Promise<TreasurerTurn[]> {
  const rows = await db
    .select({ id: chatMessages.id, authorId: chatMessages.authorId, text: chatMessages.text, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.roomId, roomId),
        eq(chatMessages.privateToUserId, askerId),
        inArray(chatMessages.authorId, [askerId, agentUserId])
      )
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit);
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.authorId === askerId ? "user" : "assistant",
    text: r.text,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * A message in the room, private to `privateToUserId` or shared when null,
 * and the realtime nudge that makes open room views refetch (the event
 * carries no body).
 */
export async function postRoomMessage(input: {
  roomId: string;
  authorId: string;
  text: string;
  privateToUserId: string | null;
  /** the agent's own messages are tagged so a client can tell them from a member's */
  byAgent?: boolean;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(chatMessages)
    .values({
      roomId: input.roomId,
      authorId: input.authorId,
      text: input.text,
      attachments: [],
      privateToUserId: input.privateToUserId,
    })
    .returning({ id: chatMessages.id });
  await publishToRoomMembers(input.roomId, {
    type: "dm-message",
    clientId: input.byAgent ? `agent:${input.authorId}` : null,
  }).catch((err: unknown) => console.error("treasurer: realtime publish failed:", err));
  return row;
}
