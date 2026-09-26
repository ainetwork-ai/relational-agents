import { isServableAssetUrl } from "@/lib/files/serve";
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
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
import { asksForPipeline, buildSalesPipeline } from "./sales-pipeline";
import { answerViewers, ownDriveSources, readableFile, sharedDriveSources, type DriveSource } from "./shared-drives";
import { langOf, matchFamilySkill, runFamilySkill } from "./family-skills";
import { handleTreasuryCommand } from "./treasury/skill";
import { isAssistantRoom } from "./assistant-room";
import { makeT } from "@/i18n/translate";
import { runAsOrService } from "@/lib/aindrive-account";
import {
  aindriveConfigured,
  parseLink,
  listTree,
  notUserFolder,
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

/** The aindrive folders this agent reads, as the model sees them: its own
 *  linked folder, or the folders shared into the teamspaces of the room. */
interface DriveContext {
  sources: DriveSource[];
  /** the one folder the agent may write to (its own link) — shared folders are read-only */
  writable: DriveSource | null;
  /** "<label>/<path>" per file ("<path>" for the agent's own folder) */
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

/** The aindrive folders a room's agent may read: what was shared into the
 *  teamspaces everyone reading the answer can see — and, in a person's own
 *  assistant room, their own drives too. */
async function roomSources(room: { kind: string; name: string; workspaceId: string | null }, roomId: string, message: ChatMessage): Promise<DriveSource[]> {
  if (!room.workspaceId) return [];
  const shared = await sharedDriveSources(room.workspaceId, await answerViewers(roomId, message.authorId, message.privateToUserId ?? null));
  if (!isAssistantRoom(room)) return shared;
  return [...shared, ...(await ownDriveSources(message.authorId, shared).catch(() => []))];
}

/** The folder a model-given path belongs to, and the path inside it. */
function locate(drive: DriveContext, p: string): { src: DriveSource; rel: string } | null {
  const own = drive.sources.find((x) => x.label === "");
  const hit = drive.sources
    .filter((x) => x.label && p.startsWith(`${x.label}/`))
    .sort((a, b) => b.label.length - a.label.length)[0];
  if (hit) return { src: hit, rel: p.slice(hit.label.length + 1) };
  return own ? { src: own, rel: p } : null;
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
      .replace(/[^a-z0-9\uAC00-\uD7A3\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

/** The photo whose surroundings the answer is talking about. Deterministic, so
 *  a recall that mentions grandma's songpyeon shows it whether or not the model
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
  /** userId → display name, so the model knows who said what */
  names: Map<string, string>,
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
    .map((m) => `${names.get(m.authorId) ?? m.authorId.slice(0, 8)}: ${m.text}`)
    .join("\n");
  const opened = drive ? Object.entries(drive.opened) : [];
  const shared = drive ? drive.sources.some((x) => x.label) : false;
  const driveRules = drive
    ? (shared
        ? `\nYou can also read the aindrive folders the members shared with this space (each file is "<folder>/<path>"; the folder name says whose it is). ` +
          `Answer from these files when they bear on the question, and say which file you took it from. Files:\n`
        : `\nYou also have a linked file folder (aindrive). Its files:\n`) +
      `${drive.files.map((f) => `- ${f}`).join("\n") || "(empty)"}\n` +
      (opened.length
        ? `The files you opened are under "## Opened files". Do not ask to open more.\n`
        : `If a listed file may hold the answer (judge by its name), output {"action":"read_files","paths":["<path from the list>"]} (at most ${DRIVE_READ_MAX}) and you will be shown them — ` +
          `open it before ever saying something is not recorded.\n`) +
      (drive.writable
        ? `Only when a member asks you to create or change a file, add "writes":[{"path":"<path relative to the folder>","content":"<the full new file contents>"}] to your reply and say in the text what you wrote. Never write unasked.`
        : `These folders are read-only to you: never offer to change them.`)
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
          `("grandma loves her songpyeon with sesame filling — you made them together last Chuseok"), and attach the photo that detail came from. A preference that is not in the document does not exist: suggest from what is recorded or say you have nothing to go on. ` +
          `Only say you do not have it when the sections are genuinely silent on the subject, and never park a question as an open topic instead of answering what you already know.\n` +
          `When you cite the document, mention its link (/p/${rootPageId ?? ""}).\n` +
          `When you recommend ${profile.voice.suggestion}, ground it in this ${profile.voice.subject}'s memories (say WHY — e.g. a preference the person mentioned before), include the place's Google Maps link if the document has one, and attach its image by putting the document's image url (exactly as written there) in "attachments".\n` +
          // The whole promise of a per-relationship agent: what it was never
          // told, it cannot say. It is only ever handed this relationship's
          // sections, so this restates a boundary the code already enforces.
          `Never reveal, hint at, or draw on anything not written in this ${profile.voice.subject}'s document sections above — other relationships do not exist to you. When the sections are silent, say so plainly and do not speculate.\n` +
          // Money is moved and reported by code (treasury/skill.ts) in fixed
          // templates; the history shows those templates, and a model that
          // imitates one would announce a payment that never happened.
          `You cannot move money. Never say that you paid, sent, transferred, queued or approved any money, or that a payment went through — only the treasury's own messages report money.\n` +
          `Write "text" in the language the new message is written in (English message → English reply, even when the files are Korean).\n` +
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
      const writes = drive?.writable ? writeList(parsed.writes) : [];
      return writes.length ? { ...reply, writes } : reply;
    }
    return { action: "silent" };
  } catch {
 // parse failure → on mention, reply with the raw text (model broke JSON); else stay silent
    return mentioned ? withPhoto(raw.trim().slice(0, 2000), [], sections) : { action: "silent" };
  }
}

/** Context sent with a message but not stored with it. */
export interface MessageContext {
  /** the page open on the sender's screen (the assistant panel) — "this page" */
  contextPageId?: string | null;
}

/**
 * In-app agent read path (spec v2 §5): for one new message, run
 * ① the write pipeline (async, idempotent) ② the reply decision → post to the room.
 */
export async function respondToMessage(
  agentUserId: string,
  roomId: string,
  message: ChatMessage,
  /** what the sender's screen adds and the stored message does not carry */
  extra: MessageContext = {}
): Promise<RespondResult> {
  const [agent] = await db.select().from(users).where(eq(users.id, agentUserId));
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId));
  if (!agent?.isAgent || !room) return { action: "silent" };

 // write path: observe → update the doc (replies continue even if it fails)
  const assistant = isAssistantRoom(room);
  const writeDone = assistant
    ? Promise.resolve()
    : runPipeline(roomId).catch((err) => console.error("agent write failed:", err));

  const config = (agent.agentConfig ?? {}) as AgentConfig;
 // the agent's own config decides how it behaves here — not the room's, since
 // an imported external agent brings its own
  const profile = resolveProfile(config);
 // a quiet message is addressed to the agent by definition — the lock is the
 // address, so it need not also be spelled out with an @
  // a room of one person and their agent (the assistant panel) needs no "@agent":
  // everything said there is said to it
  const humans = await answerViewers(roomId, message.authorId, null);
  const mentioned =
    Boolean(message.privateToUserId) || humans.length === 1 || isMentioned(message.text, agent.displayName);

 // The answer is on its way — say so on screen. Only when the agent is
 // addressed: a chime-in is decided after the fact, and dots that resolve into
 // silence are a lie.
  const stopTyping = mentioned
    ? showAgentTyping(roomId, agent, message.privateToUserId ?? null)
    : null;

  // an agent message in the room, seen by the same people the reply would be
  const post = async (text: string) => {
    const [row] = await db
      .insert(chatMessages)
      .values({ roomId, authorId: agentUserId, text, attachments: [], privateToUserId: message.privateToUserId ?? null })
      .returning();
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: `agent:${agentUserId}` });
    return row;
  };

  let decision: RespondResult;
  try {
    // the relation's treasury: a money sentence is matched by shape and decided
    // by the rules in the relation's memory, never by the model (treasury/skill.ts)
    const treasuryReply =
      mentioned && process.env.AGENT_FAKE_LLM !== "1"
        ? await handleTreasuryCommand({
            roomId,
            agentUserId,
            askerId: message.authorId,
            text: message.text,
            agentName: agent.displayName,
          }).catch((e) => {
            console.error("[treasury] failed:", e);
            return null;
          })
        : null;
    // what a family agent can do beyond answering: build a page from the
    // family's shared folders, or pay a gift over x402 (family-skills.ts)
    // (the prompt skill is code end to end, so it runs even with the model faked)
    // (the room and asker: the prompt skill may be waiting on this person's answer)
    const matched =
      mentioned && room.workspaceId && !treasuryReply ? matchFamilySkill(message.text, { roomId, askerId: message.authorId }) : null;
    const skill = matched === "prompt" || process.env.AGENT_FAKE_LLM !== "1" ? matched : null;
    // a work agent (business profile, or given the skill) can build the pipeline
    const canPipeline =
      profile.key === "business" || (Array.isArray(config.skills) && config.skills.includes("sales-pipeline"));
    // a skill's answer — null when it was not a request for it after all (the prompt
    // skill hands a "maybe" back), and the agent answers as it would otherwise
    let done: { text: string } | null = null;
    if (skill && room.workspaceId) {
      const sources = skill === "prompt" ? [] : await roomSources(room, roomId, message).catch(() => []);
      const lang = langOf(message.text);
      const viewerIds = await answerViewers(roomId, message.authorId, message.privateToUserId ?? null);
      done = await runFamilySkill(skill, {
        workspaceId: room.workspaceId,
        askerId: message.authorId,
        sources,
        text: message.text,
        lang,
        roomId,
        viewerIds,
        contextPageId: extra.contextPageId ?? null,
      }).catch(
        (e: Error) => {
          console.error(`[family-skill:${skill}] failed:`, e);
          return { text: makeT(lang)("I stopped partway: {error}", { error: e.message }) };
        }
      );
    }
    if (treasuryReply) {
      decision = { action: "reply", text: treasuryReply.text };
    } else if (done) {
      decision = { action: "reply", text: done.text };
    } else if (mentioned && canPipeline && asksForPipeline(message.text) && process.env.AGENT_FAKE_LLM !== "1") {
      // a skill, not an answer: gather the linked call histories and build the page
      const viewers = await answerViewers(roomId, message.authorId, message.privateToUserId ?? null);
      const built = await buildSalesPipeline(room.workspaceId, message.authorId, viewers, async (line) => {
        await post(line);
      }).catch((e) => {
        console.error("[sales-pipeline] failed:", e);
        return { pageId: null, text: makeT("ko")("Stopped while building the pipeline: {error}", { error: (e as Error).message }) };
      });
      decision = { action: "reply", text: built.text };
    } else if (process.env.AGENT_FAKE_LLM === "1") {
      decision = fakeDecision(message, mentioned);
    } else {
      const [state] = await db
        .select()
        .from(agentRoomStates)
        .where(eq(agentRoomStates.roomId, roomId));
   // the relationship doc is OKF-file-canonical — answer evidence reads from files too
      const tree = assistant
        ? null
        : ensureOkfDocTree(roomId, room.name, profile, {
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
      if (tree) await setOkfAcl(tree.rootPath, roomId, [...new Set([room.createdBy, ...memberIds])]);
      const sections = tree ? readOkfSectionTexts(tree, profile) : {};
      const titles = tree ? sectionTitles(tree, profile) : {};
      const recent = await db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.roomId, roomId)))
        .orderBy(desc(chatMessages.createdAt))
        .limit(20);
      const authors = [...new Set(recent.map((m) => m.authorId))];
      const names = new Map(
        authors.length
          ? (await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, authors))).map(
              (u) => [u.id, u.name] as const
            )
          : []
      );
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
          names,
          docPageIdOf(state),
          drive
        );
   // aindrive folders are consulted only when the agent is addressed — listing
   // people's drives on every passing message is traffic nobody asked for.
   // Its own linked folder when it has one; otherwise the folders the room's
   // people shared into their teamspaces (the ones all of them can see).
      const own = safeLink(config.aindrive);
      let sources: DriveSource[] = [];
      if (mentioned && aindriveConfigured()) {
        if (own) sources = [{ label: "", link: own, linkedBy: linkerOf(config.aindrive) }];
        else if (room.workspaceId)
          sources = await roomSources(room, roomId, message).catch((e) => {
            console.error("shared drives failed:", e);
            return [];
          });
      }
      const listed = await Promise.all(
        sources.map((src) =>
          runAsOrService(src.linkedBy, () => listTree(src.link, 100, 40, notUserFolder))
            .then((files) => (src.label ? files.filter(readableFile).map((f) => `${src.label}/${f}`) : files))
            .catch((e) => {
              console.error("aindrive list failed:", src.label, e);
              return null;
            })
        )
      );
      const drive: DriveContext | null = listed.some((l) => l !== null)
        ? {
            sources,
            writable: own ? sources[0] : null,
            files: listed.flatMap((l) => l ?? []).slice(0, 150),
            opened: {},
          }
        : null;
      decision = await ask("");
      if (drive && decision.readPaths?.length) {
        for (const p of decision.readPaths) {
          const at = locate(drive, p);
          drive.opened[p] = !at
            ? "(no such file)"
            : await runAsOrService(at.src.linkedBy, () => readDriveFile(at.src.link, at.rel))
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
