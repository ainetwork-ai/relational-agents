import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomBots, users, type ChatMessage, type ChatRoom } from "@/lib/db/schema";
import { a2aBaseUrl } from "./provision";
import { respondToMessage } from "./respond";

const PUSH_TIMEOUT_MS = 30_000;

/** 외부 A2A 봇에게 SendMessage JSON-RPC push (스펙 v2 §5). 실패 시 1회 재시도. */
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
        // A2A 표준 Message.metadata — 방/화자 컨텍스트 (스펙 v2 §5)
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
 * 방에 임포트된 모든 봇에게 새 메시지를 배달한다 (스펙 v2 §5 디스패처).
 * - 봇이 쓴 메시지는 배달하지 않는다 (봇 간 무한 루프 방지 — 데모 정책)
 * - 우리 인앱 관계 에이전트(a2aUrl이 self)는 HTTP 왕복 없이 in-process 실행
 * - 외부 봇은 A2A SendMessage POST
 * fire-and-forget으로 호출하는 것을 전제로, 개별 실패는 로그만 남긴다.
 */
export async function dispatchToRoomBots(room: ChatRoom, message: ChatMessage): Promise<void> {
  const bots = await db.select().from(chatRoomBots).where(eq(chatRoomBots.roomId, room.id));
  if (!bots.length) return;
  const agentIds = bots.map((b) => b.agentUserId);
  if (agentIds.includes(message.authorId)) return; // 봇 자신의 발언

  const agents = await db.select().from(users).where(inArray(users.id, agentIds));
  const [author] = await db.select().from(users).where(eq(users.id, message.authorId));
  if (author?.isAgent) return; // 다른 봇의 발언도 배달 안 함 (루프 방지)

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
