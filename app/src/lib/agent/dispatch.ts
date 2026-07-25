import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomBots, users, type ChatMessage, type ChatRoom } from "@/lib/db/schema";
import { a2aBaseUrl } from "./provision";
import { respondToMessage } from "./respond";

const PUSH_TIMEOUT_MS = 30_000;

/** SendMessage JSON-RPC push to an external A2A bot (spec v2 §5). One retry on failure. */
async function pushExternal(
  a2aUrl: string,
  room: ChatRoom,
  message: ChatMessage,
  authorName: string
): Promise<void> {
  const body = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "SendMessage",
    params: {
      message: {
        role: "user",
        messageId: message.id,
        parts: [{ kind: "text", text: message.text }],
        // standard A2A Message.metadata — room/speaker context (spec v2 §5)
        metadata: {
          roomId: room.id,
          roomName: room.name,
          authorId: message.authorId,
          authorName,
        },
      },
    },
  };
  const attempt = () =>
    fetch(a2aUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.A2A_SERVICE_TOKEN
          ? { authorization: `Bearer ${process.env.A2A_SERVICE_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  let res = await attempt().catch(() => null);
  if (!res || !res.ok) res = await attempt().catch(() => null);
  if (!res || !res.ok)
    console.error(`a2a dispatch failed: ${a2aUrl} → ${res ? res.status : "network error"}`);
}

/**
 * Delivers a new message to every bot imported into the room (spec v2 §5
 * dispatcher).
 * - Bot-authored messages are never delivered (no bot↔bot loops — demo policy)
 * - Our in-app relationship agent (self a2aUrl) runs in-process, no HTTP hop
 * - External bots get an A2A SendMessage POST
 * Meant to be called fire-and-forget; individual failures only log.
 */
export async function dispatchToRoomBots(room: ChatRoom, message: ChatMessage): Promise<void> {
  const bots = await db.select().from(chatRoomBots).where(eq(chatRoomBots.roomId, room.id));
  if (!bots.length) return;
  const agentIds = bots.map((b) => b.agentUserId);
  if (agentIds.includes(message.authorId)) return; // the bot's own message

  const agents = await db.select().from(users).where(inArray(users.id, agentIds));
  const [author] = await db.select().from(users).where(eq(users.id, message.authorId));
  if (author?.isAgent) return; // other bots' messages aren't delivered either (loop prevention)

  const self = a2aBaseUrl();
  await Promise.allSettled(
    agents.map(async (agent) => {
      if (!agent.isAgent) return;
      const url = agent.a2aUrl ?? "";
      const isInApp = url.startsWith(self) || url.includes("/api/a2a/");
      if (isInApp && agent.encryptedPrivateKey) {
        await respondToMessage(agent.id, room.id, message).catch((err) =>
          console.error("in-app agent respond failed:", err)
        );
      } else if (url) {
        await pushExternal(url, room, message, author?.displayName ?? "unknown");
      }
    })
  );
}
