import { isServableAssetUrl } from "@/lib/files/serve";
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRoomStates,
  chatMessages,
  chatRoomMembers,
  chatRooms,
  users,
  type AgentConfig,
  type ChatMessage,
  type User,
} from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { setOkfAcl } from "@/lib/okf-acl";
import { toPublicUser } from "@/lib/auth/public-user";
import { aiChat } from "@/lib/ai";
import { docPageIdOf, runPipeline } from "./pipeline";
import { resolveProfile, type RelationshipProfile } from "./profiles";
import { ensureOkfDocTree, readOkfSectionTexts, sectionTitles } from "./okf-docs";
import { runAsOrService } from "@/lib/aindrive-account";
import {
  aindriveConfigured,
  parseLink,
  listTree,
  readFile as readDriveFile,
  writeFile as writeDriveFile,
  type AindriveLink,
} from "@/lib/aindrive";

export interface RespondResult {
  action: "reply" | "silent";
  text?: string;
  /** Images the agent attaches to its reply — our own served paths only, taken from the doc. */
  attachments?: { url: string; name: string }[];
  messageId?: string;
  /** Linked-drive files the model asked to open before answering. */
  readPaths?: string[];
  /** Linked-drive files the model wants written alongside its reply. */
  writes?: { path: string; content: string }[];
}

/** The aindrive folder linked to this agent, as the model sees it. */
interface DriveContext {
  link: AindriveLink;
  files: string[];
  /** path → contents of the files opened for this answer */
  opened: Record<string, string>;
}

/** Who the agent's folder was linked by — its drive calls run as their account. */
function linkerOf(raw: unknown): string | null {
  const by = raw && typeof raw === "object" ? (raw as { linkedBy?: unknown }).linkedBy : null;
  return typeof by === "string" ? by : null;
}

/** The agent's aindrive link, or null when it has none (or a malformed one). */
function safeLink(raw: unknown): AindriveLink | null {
  try {
    return parseLink(raw);
  } catch (e) {
    console.error("aindrive link refused:", (e as Error).message);
    return null;
  }
}

const DRIVE_READ_MAX = 3;
// the local model's whole context is 8k tokens, record and history included
const DRIVE_FILE_CHARS = 4_000;
const DRIVE_WRITE_MAX = 3;

function stringList(raw: unknown, max: number): string[] {
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && !!p.trim()).slice(0, max) : [];
}

function writeList(raw: unknown): { path: string; content: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (w): w is { path: string; content: string } =>
        !!w && typeof w === "object" && typeof w.path === "string" && typeof w.content === "string"
    )
    .slice(0, DRIVE_WRITE_MAX)
    .map(({ path, content }) => ({ path, content }));
}

/** Only locally-uploaded images may ride along on an agent reply. */
function sanitizeAttachments(raw: unknown): { url: string; name: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (a): a is { url: string; name?: string } =>
        !!a && typeof a === "object" && typeof (a as { url?: unknown }).url === "string"
    )
    .filter((a) => isServableAssetUrl(a.url))
    .slice(0, 4)
    .map((a) => ({ url: a.url, name: typeof a.name === "string" ? a.name : "image" }));
}

/** A photo in the record, with the line that introduces it. */
interface DocPhoto {
  url: string;
  context: string;
}

// a photo is at the pre-migration disk path or the key-addressed serving path
const IMG_LINE =
  /!\[([^\]]*)\]\(((?:\/uploads\/[A-Za-z0-9._-]+|\/api\/files\/key\/files\/[0-9a-f]{64}\.[a-z0-9]{1,8}))\)/g;

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
  titles: Record<string, string>,
  recent: ChatMessage[],
  rootPageId: string | null,
  drive: DriveContext | null
): Promise<RespondResult> {
  const persona = profile.persona.name;
  const custom = typeof config.systemPrompt === "string" ? `\nExtra instructions: ${config.systemPrompt}` : "";
  const proactive = profile.behavior.proactive;
  const docs = Object.entries(titles)
    .map(([key, title]) => `### ${title}\n${sections[key] || "(empty)"}`)
    .join("\n\n");
  const history = recent
    .slice()
    .reverse()
    .map((m) => `(${m.authorId.slice(0, 8)}) ${m.text}`)
    .join("\n");
  const opened = drive ? Object.entries(drive.opened) : [];
  const driveRules = drive
    ? `\nYou also have a linked file folder (aindrive). Its files:\n${drive.files.map((f) => `- ${f}`).join("\n") || "(empty)"}\n` +
      (opened.length
        ? `The files you opened are under "## Opened files". Do not ask to open more.\n`
        : `If answering needs a file's contents, output {"action":"read_files","paths":["<path from the list>"]} (at most ${DRIVE_READ_MAX}) and you will be shown them.\n`) +
      `Only when a member asks you to create or change a file, add "writes":[{"path":"<path relative to the folder>","content":"<the full new file contents>"}] to your reply and say in the text what you wrote. Never write unasked.`
    : "";
  const openedText = opened.length
    ? `\n\n## Opened files\n${opened.map(([p, c]) => `### ${p}\n${c}`).join("\n\n")}`
    : "";

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
          `When you recommend ${profile.voice.suggestion}, ground it in this ${profile.voice.subject}'s memories (say WHY — e.g. a preference the person mentioned before), include the place's Google Maps link if the document has one, and attach its image by putting the document's image url (exactly as written there) in "attachments".\n` +
          // The whole promise of a per-relationship agent: what it was never
          // told, it cannot say. It is only ever handed this relationship's
          // sections, so this restates a boundary the code already enforces.
          `Never reveal, hint at, or draw on anything not written in this ${profile.voice.subject}'s document sections above — other relationships do not exist to you. When the sections are silent, say so plainly and do not speculate.\n` +
          `Output JSON only: {"action":"reply","text":"..."} or {"action":"reply","text":"...","attachments":[{"url":"<image url from the document>","name":"..."}]} or {"action":"silent"}` +
          driveRules,
      },
      {
        role: "user",
        content: `## Shared document\n${docs}${openedText}\n\n## Recent conversation\n${history}\n\n## New message (mentioned: ${mentioned})\n${message.text}`,
      },
    ],
    // a reply that carries a file needs room for it, or the JSON is cut mid-string
    { maxTokens: drive ? 1_500 : 600, temperature: 0.4 }
  );
  try {
    const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    const parsed = JSON.parse((fenced ? fenced[1] : raw).trim()) as Omit<RespondResult, "action"> & {
      action: string;
      paths?: unknown;
    };
    if (drive && !opened.length && parsed.action === "read_files") {
      const readPaths = stringList(parsed.paths, DRIVE_READ_MAX);
      if (readPaths.length) return { action: "silent", readPaths };
    }
    if (parsed.action === "reply" && typeof parsed.text === "string" && parsed.text.trim()) {
      const reply = withPhoto(parsed.text.trim(), sanitizeAttachments(parsed.attachments), sections);
      const writes = drive ? writeList(parsed.writes) : [];
      return writes.length ? { ...reply, writes } : reply;
    }
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
   // ensureOkfDocTree CREATES the folder, and an OKF path nobody registered is
   // workspace-readable. Answering is often a room's first doc-touching event
   // (the write pipeline returns early when there is nothing new to record), so
   // registering here is what keeps the record participant-only.
      const memberIds = (
        await db
          .select({ userId: chatRoomMembers.userId })
          .from(chatRoomMembers)
          .where(eq(chatRoomMembers.roomId, roomId))
      ).map((m) => m.userId);
      await setOkfAcl(tree.rootPath, roomId, [...new Set([room.createdBy, ...memberIds])]);
      const sections = readOkfSectionTexts(tree, profile);
    const titles = sectionTitles(tree, profile);
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
          titles,
          recent,
          docPageIdOf(state),
          drive
        );
   // A linked aindrive folder is consulted only when the agent is addressed —
   // listing someone's drive on every passing message is traffic nobody asked for.
      const link = safeLink(config.aindrive);
      const drive: DriveContext | null =
        mentioned && link && aindriveConfigured()
          ? await runAsOrService(linkerOf(config.aindrive), () => listTree(link, 100))
              .then((files) => ({ link, files, opened: {} }))
              .catch((e) => {
                console.error("aindrive list failed:", e);
                return null;
              })
          : null;
      decision = await ask("");
      if (drive && decision.readPaths?.length) {
        for (const p of decision.readPaths) {
          drive.opened[p] = await runAsOrService(linkerOf(config.aindrive), () => readDriveFile(drive.link, p))
            .then((c) => (c.length > DRIVE_FILE_CHARS ? `${c.slice(0, DRIVE_FILE_CHARS)}\n…(truncated)` : c))
            .catch((e) => `(could not read: ${(e as Error).message})`);
        }
        decision = await ask("");
      }
   // Being asked and saying nothing is not an outcome this can ship with: the
   // model sometimes answers a direct question with {"action":"silent"}, which
   // reads on screen as a broken agent. Ask once more, spelling out the rule.
      if (mentioned && !isAnswer(decision))
        decision = await ask("(You were addressed directly. Reply — silence is not an option here.)");
    }
    if (mentioned && !isAnswer(decision))
      decision = { action: "reply", text: "I couldn't put that together just now — ask me once more?" };
    const link = safeLink(config.aindrive);
    if (decision.writes?.length && link) {
      const failed: string[] = [];
      for (const w of decision.writes) {
        await runAsOrService(linkerOf(config.aindrive), () => writeDriveFile(link, w.path, w.content)).catch((e) => {
          console.error("aindrive write failed:", e);
          failed.push(w.path);
        });
      }
   // the reply said it wrote the file; if it did not, the reply must not stand alone
      if (failed.length && decision.text)
        decision.text += `\n\n(Could not write ${failed.join(", ")} to the linked folder.)`;
    }
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
