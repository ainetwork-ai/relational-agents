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
  /** Images the agent attaches to its reply — /uploads/* only, taken from the doc. */
  attachments?: { url: string; name: string }[];
  messageId?: string;
}

/** Only locally-uploaded images may ride along on an agent reply. */
function sanitizeAttachments(raw: unknown): { url: string; name: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (a): a is { url: string; name?: string } =>
        !!a && typeof a === "object" && typeof (a as { url?: unknown }).url === "string"
    )
    .filter((a) => a.url.startsWith("/uploads/") && !a.url.includes(".."))
    .slice(0, 4)
    .map((a) => ({ url: a.url, name: typeof a.name === "string" ? a.name : "image" }));
}

/** Mention detection: @agent / @{displayName} (case-insensitive). */
export function isMentioned(text: string, agentName: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("@agent") ||
    (agentName.trim().length > 0 && t.includes(`@${agentName.toLowerCase()}`))
  );
}

/** Offline/test path: deterministic reply on mention, silence otherwise. */
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
          `Answer from the document above. If a section records something that bears on the question, say what is recorded — a partial memory is still an answer. ` +
          `Only say you do not have it when the sections are genuinely silent on the subject, and never park a question as an open topic instead of answering what you already know.\n` +
          `When you cite the document, mention the relationship-doc link (/p/${rootPageId ?? ""}).\n` +
          `When you recommend a place or a date idea, ground it in this relationship's memories (say WHY — e.g. a preference the person mentioned before), include the place's Google Maps link if the document has one, and attach its image by putting the document's /uploads/... path in "attachments".\n` +
          `Output JSON only: {"action":"reply","text":"..."} or {"action":"reply","text":"...","attachments":[{"url":"/uploads/...","name":"..."}]} or {"action":"silent"}`,
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
      return {
        action: "reply",
        text: parsed.text.trim(),
        attachments: sanitizeAttachments(parsed.attachments),
      };
    return { action: "silent" };
  } catch {
 // parse failure → on mention, reply with the raw text (model broke JSON); else stay silent
    return mentioned ? { action: "reply", text: raw.trim().slice(0, 2000) } : { action: "silent" };
  }
}

/**
 * In-app agent read path (spec v2 §5): for one new message, run
 * ① the write pipeline (async, idempotent) ② the reply decision → post to the room.
 */
export async function respondToMessage(
  agentUserId: string,
  roomId: string,
  message: ChatMessage
): Promise<RespondResult> {
  const [agent] = await db.select().from(users).where(eq(users.id, agentUserId));
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId));
  if (!agent?.isAgent || !room) return { action: "silent" };

 // write path: observe → update the doc (replies continue even if it fails)
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
 // the relationship doc is OKF-file-canonical — answer evidence reads from files too
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
      .values({
        roomId,
        authorId: agentUserId,
        text: decision.text,
        attachments: decision.attachments ?? [],
        // an answer to a private question stays in that member's side-channel
        privateToUserId: message.privateToUserId ?? null,
      })
      .returning();
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: `agent:${agentUserId}` });
    decision.messageId = reply.id;
  }

  await writeDone;
  return decision;
}
