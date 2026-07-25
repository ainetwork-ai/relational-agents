import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRoomStates,
  chatMessages,
  chatRooms,
  users,
  type AgentConfig,
  type ChatMessage,
} from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { aiChat } from "@/lib/ai";
import { docPageIdOf, runPipeline } from "./pipeline";
import { SECTIONS } from "./parse-edits";
import { ensureOkfDocTree, readOkfSectionTexts } from "./okf-docs";

export interface RespondResult {
  action: "reply" | "silent";
  text?: string;
  messageId?: string;
}

/** 멘션 감지: @에이전트 / @{displayName} / @agent (대소문자 무시). */
export function isMentioned(text: string, agentName: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("@agent") ||
    t.includes("@agent") ||
    (agentName.trim().length > 0 && t.includes(`@${agentName.toLowerCase()}`))
  );
}

/** 오프라인/테스트 경로: 멘션이면 결정적 응답, 아니면 침묵. */
function fakeDecision(message: ChatMessage, mentioned: boolean): RespondResult {
  if (!mentioned) return { action: "silent" };
  return { action: "reply", text: `[fake-agent] Reply to "${message.text.slice(0, 60)}".` };
}

async function llmDecision(
  message: ChatMessage,
  mentioned: boolean,
  roomName: string,
  config: AgentConfig,
  sections: Record<string, string>,
  recent: ChatMessage[],
  rootPageId: string | null
): Promise<RespondResult> {
  const persona = config.persona?.name ?? "Relationship agent";
  const custom = typeof config.systemPrompt === "string" ? `\nExtra instructions: ${config.systemPrompt}` : "";
  const proactive = config.behavior?.proactive !== false;
  const docs = SECTIONS.map((s) => `### ${s.title}\n${sections[s.key] || "(empty)"}`).join("\n\n");
  const history = recent
    .slice()
    .reverse()
    .map((m) => `(${m.authorId.slice(0, 8)}) ${m.text}`)
    .join("\n");

  const raw = await aiChat(
    [
      {
        role: "system",
        content:
          `You are the ${persona} of the "${roomName}" room. Take part in the conversation grounded in the relationship document.${custom}\n` +
          `Rules: always reply when mentioned. When not mentioned, ${proactive ? "chime in briefly only if the members must know something (a scheduling conflict, an important remembered fact)" : "stay silent"}. Otherwise stay silent.\n` +
          `When you cite the document, mention the relationship-doc link (/p/${rootPageId ?? ""}).\n` +
          `Output JSON only: {"action":"reply","text":"..."} or {"action":"silent"}`,
      },
      {
        role: "user",
        content: `## Relationship document\n${docs}\n\n## Recent conversation\n${history}\n\n## New message (mentioned: ${mentioned})\n${message.text}`,
      },
    ],
    { maxTokens: 600, temperature: 0.4 }
  );
  try {
    const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    const parsed = JSON.parse((fenced ? fenced[1] : raw).trim()) as RespondResult;
    if (parsed.action === "reply" && typeof parsed.text === "string" && parsed.text.trim())
      return { action: "reply", text: parsed.text.trim() };
    return { action: "silent" };
  } catch {
    // 판별 실패 → 멘션이면 원문 그대로 응답(모델이 JSON을 어긴 경우), 아니면 침묵
    return mentioned ? { action: "reply", text: raw.trim().slice(0, 2000) } : { action: "silent" };
  }
}

/**
 * 인앱 에이전트 read 경로 (스펙 v2 §5): 새 메시지 1건에 대해
 * ① write 파이프라인(비동기, 멱등) ② 응답 판단 → 방에 게시.
 */
export async function respondToMessage(
  agentUserId: string,
  roomId: string,
  message: ChatMessage
): Promise<RespondResult> {
  const [agent] = await db.select().from(users).where(eq(users.id, agentUserId));
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId));
  if (!agent?.isAgent || !room) return { action: "silent" };

  // write 경로: 관찰 → 문서 갱신 (실패해도 응답은 계속)
  const writeDone = runPipeline(roomId).catch((err) =>
    console.error("agent write failed:", err)
  );

  const config = (agent.agentConfig ?? {}) as AgentConfig;
  const mentioned = isMentioned(message.text, agent.displayName);

  let decision: RespondResult;
  if (process.env.AGENT_FAKE_LLM === "1") {
    decision = fakeDecision(message, mentioned);
  } else {
    const [state] = await db
      .select()
      .from(agentRoomStates)
      .where(eq(agentRoomStates.roomId, roomId));
    // 관계 문서는 OKF 파일이 원본 — 답변 근거도 파일에서 읽는다
    const tree = ensureOkfDocTree(roomId, room.name, {
      rootPath: state?.rootOkfPath,
      sectionPaths: state?.sectionOkfPaths,
    });
    const sections = readOkfSectionTexts(tree);
    const recent = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.roomId, roomId)))
      .orderBy(desc(chatMessages.createdAt))
      .limit(20);
    decision = await llmDecision(
      message,
      mentioned,
      room.name,
      config,
      sections,
      recent,
      docPageIdOf(state)
    );
  }

  if (decision.action === "reply" && decision.text) {
    const [reply] = await db
      .insert(chatMessages)
      .values({ roomId, authorId: agentUserId, text: decision.text })
      .returning();
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: `agent:${agentUserId}` });
    decision.messageId = reply.id;
  }

  await writeDone;
  return decision;
}
