import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRoomStates, chatMessages, chatRoomBots, chatRoomMembers } from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { aiChat } from "@/lib/ai";
import { okfDocTreeFromState, readOkfSectionTexts } from "./okf-docs";

/**
 * The agent listening in on a call.
 *
 * Two rules decide whether to speak up, and *we* decide them, not the model:
 * a question to your member always earns a whisper (the answer may be on
 * record, or conspicuously not), a statement only when it touches something
 * recorded. Asking the model "should you whisper?" gave different answers to
 * the same kind of line — "do you like egg tarts?" and "what's your favourite
 * dessert?" split — so the model is left with the part it is good at: what the
 * line is about, and whether this relationship has it.
 */

/** Anything that asks the other person something. */
const QUESTION = /\?|^(do|did|does|have|has|are|is|was|were|what|where|when|why|how|which|who|can|could|would|will|should)\b/i;

export interface CallFacts {
  /** compact digest of the record, built once per call */
  sheet: string;
}

const KEY = Symbol.for("app.callFacts");
function cache(): Map<string, CallFacts> {
  const g = globalThis as unknown as Record<symbol, Map<string, CallFacts>>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

/** One pass over the record at call start. During the call every line is
 *  checked against this digest, so judging a line costs no document reading. */
async function factSheet(roomId: string, callId: string): Promise<string> {
  const hit = cache().get(callId);
  if (hit) return hit.sheet;

  const [state] = await db.select().from(agentRoomStates).where(eq(agentRoomStates.roomId, roomId));
  const tree = okfDocTreeFromState(state);
  const sections = tree ? readOkfSectionTexts(tree) : {};
  const body = Object.entries(sections)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `## ${k}\n${v}`)
    .join("\n\n");

  let sheet = "places: (nothing recorded)\ntastes: (nothing recorded)\nfoods: (nothing recorded)\nevents: (nothing recorded)";
  if (body.trim()) {
    try {
      sheet = await aiChat(
        [
          {
            role: "system",
            content:
              "Condense this relationship's record into a lookup sheet for a live call. " +
              "Lines: places, tastes, foods, events, people. List only what the record states, with the wording it uses plus obvious synonyms. " +
              'Write "(nothing recorded)" for a line the record says nothing about — that absence is meaningful. No prose, no headings.',
          },
          { role: "user", content: body.slice(0, 8_000) },
        ],
        { maxTokens: 300, temperature: 0 }
      );
    } catch (err) {
      console.error("call fact sheet failed:", err);
    }
  }
  cache().set(callId, { sheet });
  return sheet;
}

export function forgetCallFacts(callId: string): void {
  cache().delete(callId);
}

interface Read {
  topic: string | null;
  known: boolean;
}

/** What the line is about, and whether this relationship has it — the only
 *  judgement the model makes. Pronouns resolve here ("that place back then"). */
async function readLine(text: string, sheet: string): Promise<Read> {
  const raw = await aiChat(
    [
      {
        role: "system",
        content:
          `On record for this relationship:\n${sheet}\n\n` +
          "Name what the line is about and whether this relationship has it on record. " +
          'Resolve pronouns (that place, back then, it) from the line. "(nothing recorded)" means nothing of that kind is on record. ' +
          'If the line is about nothing in particular — small talk, a reaction, the weather, how someone feels — answer {"topic":null,"known":false}.\n' +
          'JSON only: {"topic":"<subject>"|null,"known":true|false}',
      },
      { role: "user", content: text },
    ],
    { maxTokens: 60, temperature: 0 }
  );
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { topic: null, known: false };
  try {
    const parsed = JSON.parse(m[0]) as Partial<Read>;
    return { topic: typeof parsed.topic === "string" ? parsed.topic : null, known: parsed.known === true };
  } catch {
    return { topic: null, known: false };
  }
}

function whisperText(read: Read, said: string): string {
  if (read.known) return `🔎 ${read.topic} — you two have this in your record.`;
  // a question can arrive without a topic the model would name; quoting what
  // was asked beats warning about "that"
  const about = read.topic ?? `“${said.trim().replace(/\s+/g, " ").slice(0, 60)}”`;
  return `🔎 Nothing in your record about ${about} — not in this relationship, at least.`;
}

/**
 * Judge one spoken line and, if it is worth it, whisper to the listener — the
 * member who did NOT say it. The whisper is a private message in the room's
 * chat, so it reaches the side panel already open next to the call and stays
 * invisible to the person on the other end of the line.
 */
export async function watchUtterance(
  roomId: string,
  callId: string,
  speakerId: string,
  text: string
): Promise<{ whispered: boolean; topic?: string | null }> {
  const [bot] = await db.select().from(chatRoomBots).where(eq(chatRoomBots.roomId, roomId));
  if (!bot) return { whispered: false };

  const sheet = await factSheet(roomId, callId);
  const read = await readLine(text, sheet);
  const asks = QUESTION.test(text.trim());
  const worth = asks || Boolean(read.topic && read.known);
  if (!worth) return { whispered: false, topic: read.topic };

  // everyone in the room except the speaker and the agent itself
  const members = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .where(and(eq(chatRoomMembers.roomId, roomId), ne(chatRoomMembers.userId, speakerId)));
  const listeners = members.map((m) => m.userId).filter((id) => id !== bot.agentUserId);
  if (!listeners.length) return { whispered: false, topic: read.topic };

  const body = whisperText(read, text);
  for (const userId of listeners) {
    await db.insert(chatMessages).values({
      roomId,
      authorId: bot.agentUserId,
      text: body,
      privateToUserId: userId,
    });
  }
  await publishToRoomMembers(roomId, { type: "dm-message", clientId: null });
  return { whispered: true, topic: read.topic };
}
