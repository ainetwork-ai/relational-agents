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
  type User,
} from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { toPublicUser } from "@/lib/auth/public-user";
import { aiChat } from "@/lib/ai";
import { docPageIdOf, runPipeline } from "./pipeline";
import { resolveProfile, type RelationshipProfile } from "./profiles";
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

/** A photo in the record, with the line that introduces it. */
interface DocPhoto {
  url: string;
  context: string;
}

const IMG_LINE = /!\[([^\]]*)\]\((\/uploads\/[A-Za-z0-9._-]+)\)/g;

/** Photos the record holds, each carried with its caption and the line above
 *  it — that text is what an answer about the photo will echo. */
function docPhotos(sections: Record<string, string>): DocPhoto[] {
  const out: DocPhoto[] = [];
  for (const body of Object.values(sections)) {
    const lines = body.split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(IMG_LINE)) {
        const before = lines
          .slice(Math.max(0, i - 3), i)
          .filter((l) => l.trim() && !l.startsWith("Sources:"))
          .join(" ");
        out.push({ url: m[2], context: `${m[1]} ${before}`.trim() });
      }
    });
  }
  return out;
}

const STOPWORDS = new Set(
  "the a an and or of to in on at for with from this that they you your our we us it is was were be been are her his their there here what when where which who how".split(" ")
);

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

/** The photo whose surroundings the answer is talking about. Deterministic, so
 *  a recall that mentions the egg tart shows it whether or not the model
 *  remembered to fill in "attachments". */
function photoForAnswer(text: string, photos: DocPhoto[]): DocPhoto | null {
  const words = contentWords(text);
  let best: DocPhoto | null = null;
  let bestScore = 0;
  for (const p of photos) {
    let score = 0;
    for (const w of contentWords(p.context)) if (words.has(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 2 ? best : null;
}

/** Mention detection: @agent / @{displayName} (case-insensitive). */
export function isMentioned(text: string, agentName: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("@agent") ||
    (agentName.trim().length > 0 && t.includes(`@${agentName.toLowerCase()}`))
  );
}

/** A decision that actually says something. */
function isAnswer(d: RespondResult): boolean {
  return d.action === "reply" && Boolean(d.text?.trim());
}

const TYPING_BEAT_MS = 2_000;

/** Typing dots while the agent works, scoped like the answer itself: a quiet
 *  question is between the asker and the agent, so the partner must not even
 *  see that someone is being answered. Returns the stop function. */
function showAgentTyping(roomId: string, agent: User, onlyFor: string | null): () => void {
  const beat = () =>
    void publishToRoomMembers(
      roomId,
      { type: "dm-typing", clientId: `agent:${agent.id}`, user: toPublicUser(agent) },
      onlyFor ? [onlyFor] : undefined
    ).catch(() => {});
  beat();
  const timer = setInterval(beat, TYPING_BEAT_MS);
  return () => clearInterval(timer);
}

/** Offline/test path: deterministic reply on mention, silence otherwise. */
function fakeDecision(message: ChatMessage, mentioned: boolean): RespondResult {
  if (!mentioned) return { action: "silent" };
  return { action: "reply", text: `[fake-agent] Reply to "${message.text.slice(0, 60)}".` };
}

/** Attach what the answer is about. The model is asked to fill in
 *  "attachments" and often does not — or paraphrases the url until it no
 *  longer resolves — so a miss falls back to matching the record itself. */
function withPhoto(
  text: string,
  supplied: { url: string; name: string }[],
  sections: Record<string, string>
): RespondResult {
  const photos = docPhotos(sections);
  const known = new Set(photos.map((p) => p.url));
  const valid = supplied.filter((a) => known.has(a.url));
  if (valid.length) return { action: "reply", text, attachments: valid };
  const match = photoForAnswer(text, photos);
  return {
    action: "reply",
    text,
    attachments: match ? [{ url: match.url, name: match.context.slice(0, 60) || "photo" }] : [],
  };
}

async function llmDecision(
  message: ChatMessage,
  mentioned: boolean,
  roomName: string,
  config: AgentConfig,
  profile: RelationshipProfile,
  sections: Record<string, string>,
  recent: ChatMessage[],
  rootPageId: string | null
): Promise<RespondResult> {
  const persona = profile.persona.name;
  const custom = typeof config.systemPrompt === "string" ? `\nExtra instructions: ${config.systemPrompt}` : "";
  const proactive = profile.behavior.proactive;
  const docs = profile.sections.map((s) => `### ${s.title}\n${sections[s.key] || "(empty)"}`).join("\n\n");
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
          `You are the ${persona} of the "${roomName}" room, in a ${profile.persona.tone} voice. Take part in the conversation grounded in the ${profile.voice.subject} document.${custom}\n` +
          `Rules: always reply when mentioned. When not mentioned, ${proactive ? "chime in briefly only if the members must know something (a scheduling conflict, an important remembered fact)" : "stay silent"}. Otherwise stay silent.\n` +
          `Answer from the document above. If a section records something that bears on the question, say what is recorded — a partial memory is still an answer. ` +
          `When asked what to do, where to go, or what they would like, make one concrete suggestion and say which remembered detail it follows from ` +
          `("she loves sunsets — you two watched one at …"), and attach the photo that detail came from. A preference that is not in the document does not exist: suggest from what is recorded or say you have nothing to go on. ` +
          `Only say you do not have it when the sections are genuinely silent on the subject, and never park a question as an open topic instead of answering what you already know.\n` +
          `When you cite the document, mention its link (/p/${rootPageId ?? ""}).\n` +
          `When you recommend a place or a date idea, ground it in this relationship's memories (say WHY — e.g. a preference the person mentioned before), include the place's Google Maps link if the document has one, and attach its image by putting the document's /uploads/... path in "attachments".\n` +
          // The whole promise of a per-relationship agent: what it was never
          // told, it cannot say. It is only ever handed this relationship's
          // sections, so this restates a boundary the code already enforces.
          `Never reveal, hint at, or draw on anything not written in this relationship's document sections above — other relationships do not exist to you. When the sections are silent, say so plainly and do not speculate.\n` +
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
      return withPhoto(parsed.text.trim(), sanitizeAttachments(parsed.attachments), sections);
    return { action: "silent" };
  } catch {
 // parse failure → on mention, reply with the raw text (model broke JSON); else stay silent
    return mentioned ? withPhoto(raw.trim().slice(0, 2000), [], sections) : { action: "silent" };
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
 // the agent's own config decides how it behaves here — not the room's, since
 // an imported external agent brings its own
  const profile = resolveProfile(config);
 // a quiet message is addressed to the agent by definition — the lock is the
 // address, so it need not also be spelled out with an @
  const mentioned =
    Boolean(message.privateToUserId) || isMentioned(message.text, agent.displayName);

 // The answer is on its way — say so on screen. Only when the agent is
 // addressed: a chime-in is decided after the fact, and dots that resolve into
 // silence are a lie.
  const stopTyping = mentioned
    ? showAgentTyping(roomId, agent, message.privateToUserId ?? null)
    : null;

  let decision: RespondResult;
  try {
    if (process.env.AGENT_FAKE_LLM === "1") {
      decision = fakeDecision(message, mentioned);
    } else {
      const [state] = await db
        .select()
        .from(agentRoomStates)
        .where(eq(agentRoomStates.roomId, roomId));
   // the relationship doc is OKF-file-canonical — answer evidence reads from files too
      const tree = ensureOkfDocTree(roomId, room.name, profile, {
        rootPath: state?.rootOkfPath,
        sectionPaths: state?.sectionOkfPaths,
      });
      const sections = readOkfSectionTexts(tree, profile);
      const recent = await db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.roomId, roomId)))
        .orderBy(desc(chatMessages.createdAt))
        .limit(20);
      const ask = (nudge: string) =>
        llmDecision(
          nudge ? { ...message, text: `${message.text}\n\n${nudge}` } : message,
          mentioned,
          room.name,
          config,
          profile,
          sections,
          recent,
          docPageIdOf(state)
        );
      decision = await ask("");
   // Being asked and saying nothing is not an outcome this can ship with: the
   // model sometimes answers a direct question with {"action":"silent"}, which
   // reads on screen as a broken agent. Ask once more, spelling out the rule.
      if (mentioned && !isAnswer(decision))
        decision = await ask("(You were addressed directly. Reply — silence is not an option here.)");
    }
    if (mentioned && !isAnswer(decision))
      decision = { action: "reply", text: "I couldn't put that together just now — ask me once more?" };
  } finally {
    stopTyping?.();
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
