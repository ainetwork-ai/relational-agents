import "server-only";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRoomStates,
  chatMessages,
  chatRoomMembers,
  chatRooms,
  callUtterances,
  users,
  type ChatMessage,
} from "@/lib/db/schema";
import { aiChat, type AiContentPart } from "@/lib/ai";
import { setOkfAcl } from "@/lib/okf-acl";
import { getCall } from "@/lib/call-store";
import {
  appendOkfLines,
  ensureOkfDocTree,
  okfDocMeta,
  okfDocPageId,
  readOkfSectionTexts,
  type NewLine,
} from "./okf-docs";
import { parseEdits, SECTIONS, type DocEdit, type TimelineEvent } from "./parse-edits";

/** Source deep-link prefix. Rooms live at /dm/[roomId]; /agent-lab has no
 *  per-room route, so provenance links pointed at a 404. */
export const CHAT_ROUTE_PREFIX = "/dm";

export interface RunResult {
  processed: number;
  edits: number;
  rootPageId: string | null;
  skipped?: string;
}

/** Per-room run mutex — manual/threshold/idle triggers can overlap without
 * double-applying. Assumes a single next-server process (demo scale). */
const running = new Map<string, Promise<RunResult>>();

/** Relationship docs write to the global OKF file root — no workspace argument needed. */
export function runPipeline(roomId: string): Promise<RunResult> {
  const prev = running.get(roomId) ?? Promise.resolve(undefined as unknown as RunResult);
  const next = prev.catch(() => undefined).then(() => runOnce(roomId));
  running.set(roomId, next);
 // cleanup derives a promise but swallows the reject, preventing unhandledRejection
  next.catch(() => {}).finally(() => {
    if (running.get(roomId) === next) running.delete(roomId);
  });
  return next;
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|heic)$/i;

/** Offline/test path (AGENT_FAKE_LLM=1): applies the batch deterministically.
 *  Image attachments are embedded as markdown so photos land in the doc too. */
function fakeEdits(batch: ChatMessage[]): DocEdit[] {
  const ids = batch.map((m) => m.id);
  const lines: string[] = [];
  for (const m of batch) {
    if (m.text) lines.push(`- ${m.text}`);
    for (const a of m.attachments ?? []) {
      if (IMG_EXT.test(a.url)) lines.push(`![${a.name || "photo"}](${a.url})`);
      else lines.push(`- 📎 [${a.name || "file"}](${a.url})`);
    }
  }
  // a batch with shared photos is a date event — the deterministic path keeps
  // the same formal template the LLM path writes (date h1 / title h2 / callout / timed photos)
  const hasPhotos = batch.some((m) => (m.attachments ?? []).some((a) => IMG_EXT.test(a.url)));
  const last = batch[batch.length - 1]!;
  return [
    {
      section: "timeline",
      markdown: lines.join("\n"),
      sourceMessageIds: ids,
      ...(hasPhotos
        ? { event: { kind: "date" as const, date: isoDay(last.createdAt), title: "Moments together" } }
        : {}),
    },
    { section: "overview", markdown: `Captured ${batch.length} recent messages.`, sourceMessageIds: ids },
  ];
}

// Photos shared in chat are part of the record, so the model is shown the actual
// pixels (gemma-4-31B-it reads images) instead of just a filename. Bounded: the
// batch is capped and each file is size-checked before it is inlined.
const MAX_VISION_IMAGES = 4;
const MAX_VISION_BYTES = 4 * 1024 * 1024;
const UPLOAD_URL = /^\/uploads\/([A-Za-z0-9._-]+)$/; // anchored — no path traversal
const VISION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Read an uploaded image off disk as a data URL. null = not a readable image
 *  the model can use (heic, oversized, missing, or an off-tree url). */
function imageDataUrl(url: string): string | null {
  const m = UPLOAD_URL.exec(url);
  if (!m) return null;
  const mime = VISION_MIME[(m[1].split(".").pop() ?? "").toLowerCase()];
  if (!mime) return null;
  const abs = path.join(process.cwd(), "public", "uploads", m[1]);
  try {
    if (fs.statSync(abs).size > MAX_VISION_BYTES) return null;
    return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
  } catch {
    return null; // file gone — the transcript line still carries the link
  }
}

async function llmEdits(
  batch: ChatMessage[],
  current: Record<string, string>,
  roomName: string
): Promise<DocEdit[]> {
  const sectionList = SECTIONS.map((s) => `${s.key} (${s.title})`).join(", ");
  const messages = batch
    .map((m) => {
      const who = `[${m.id}] (${m.authorId.slice(0, 8)})`;
      const files = (m.attachments ?? [])
        .map((a) => `${IMG_EXT.test(a.url) ? "photo" : "file"} "${a.name || "untitled"}" → ${a.url}`)
        .join(" | ");
      return files ? `${who} ${m.text}${m.text ? " " : ""}[attached: ${files}]` : `${who} ${m.text}`;
    })
    .join("\n");

  // Inline the actual photos so the model can write what is in them.
  const photos: AiContentPart[] = [];
  for (const m of batch) {
    for (const a of m.attachments ?? []) {
      if (photos.length >= MAX_VISION_IMAGES * 2) break;
      const dataUrl = imageDataUrl(a.url);
      if (!dataUrl) continue;
      photos.push({ type: "text", text: `Photo from message ${m.id} (${a.url}):` });
      photos.push({ type: "image_url", image_url: { url: dataUrl } });
    }
  }
  const raw = await aiChat(
    [
      {
        role: "system",
        content:
          `You are the record-keeper for the "${roomName}" relationship. Read the new batch of messages and incrementally update the relationship document.\n` +
          `Output a JSON array only: [{"section": <one key of ${sectionList}>, "markdown": "<markdown to append>", "sourceMessageIds": ["<supporting message id>"]}].\n` +
          `Timeline entries additionally classify the moment with an "event" field: a shared outing/date/meetup (especially one with photos) gets ` +
          `"event": {"kind": "date", "date": "YYYY-MM-DD", "title": "<short evocative event title>"}; the story of how the two FIRST MET gets ` +
          `"event": {"kind": "first-met", "date": "<the met date if stated>"}. Ordinary chatter gets no event field. ` +
          `Today is ${isoDay(batch[batch.length - 1]!.createdAt)} — date the event by when it happened, not when it was told.\n` +
          `Do not repeat facts already in the document — only what is newly learned. Every entry must carry its supporting message ids.\n` +
          `Photos shared in the chat are part of the record. When a message has one, write what it actually shows, then embed it as ![caption](the /uploads/... url exactly as given). ` +
          `The image must sit on its own line with nothing before it — a leading "- " turns it into a bullet and the photo stops rendering.\n` +
          `Write entries someone can answer questions from later: name the food, place, and people plainly, and say what the members did. ` +
          `Casual or misspelled wording is not a proper noun — "midnight natas" is a late-night pastel de nata, not a person called Natas. When a word is ambiguous, trust the photo over the spelling.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `## Current document state\n${JSON.stringify(current, null, 2)}\n\n## New message batch\n${messages}`,
          },
          ...photos,
        ],
      },
    ],
    { maxTokens: 1500, temperature: 0.2 }
  );
  return parseEdits(raw);
}

const IMG_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const pad2 = (n: number) => String(n).padStart(2, "0");
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
const hhmm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/**
 * The formal Timeline template — the agent writes events in it directly:
 *
 *   # 2026-08-04                ← event date (h1)
 *   ## Belém day — natas …      ← short title (h2, date events only)
 *   > 💕 detail plain text      ← callout (💘 for first-met)
 *   ### 14:02 ~                 ← per shared photo: message time (h3)
 *   [image]                     ←   then the photo, LLM caption preserved
 *
 * Detail text = the edit's markdown minus its photo lines (those become the
 * timed image blocks, timed by their message's createdAt).
 */
function timelineEventLines(
  edit: DocEdit,
  event: TimelineEvent,
  source: ChatMessage[]
): NewLine[] {
  const cited = source.filter((m) => edit.sourceMessageIds.includes(m.id));
  const anchor = cited[cited.length - 1] ?? source[source.length - 1];
  const day = event.date ?? isoDay(anchor?.createdAt ?? new Date());

  const captionByUrl = new Map<string, string>();
  const detail: string[] = [];
  for (const raw of edit.markdown.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const img = IMG_LINE.exec(l);
    if (img) {
      captionByUrl.set(img[2], img[1]);
      continue;
    }
    // LLM noise that must not become prose: bare date lines, self-made Sources
    const cleaned = l.replace(/^- /, "").replace(/^\d{4}-\d{2}-\d{2}[.:]?\s*/, "");
    if (!cleaned || /^Sources:/i.test(cleaned)) continue;
    detail.push(cleaned);
  }

  const firstMet = event.kind === "first-met";
  // real-time writes arrive one message at a time, so the LLM rarely names the
  // event — with several detail sentences the first stands in as the summary
  // heading; a lone sentence lives in the callout only (no verbatim-echo h2)
  const calloutText = detail.join(" ") || event.title || "A moment together";
  const title =
    event.title ?? (detail.length >= 2 ? detail[0].slice(0, 80) : undefined);
  const lines: NewLine[] = [{ type: "heading1", text: day }];
  if (!firstMet && title && !calloutText.startsWith(title))
    lines.push({ type: "heading2", text: title });
  lines.push({ type: "callout", text: calloutText, icon: firstMet ? "💘" : "💕" });
  // first-met is date + callout only; date events carry their timed photos
  if (!firstMet) {
    for (const m of cited) {
      for (const a of m.attachments ?? []) {
        if (!IMG_EXT.test(a.url)) continue;
        lines.push({ type: "heading3", text: `${hhmm(m.createdAt)} ~` });
        lines.push({ type: "image", text: captionByUrl.get(a.url) || a.name || "", url: a.url });
      }
    }
  }
  return lines;
}

/** Spec §4: collect → ensure doc → generate edits → apply (+sources) →
 * checkpoint. Apply and mark-processed share one transaction (partial apply
 * → no duplicate re-collection). Idempotent. */
async function runOnce(roomId: string): Promise<RunResult> {
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId));
  if (!room) throw new Error(`agent: room ${roomId} not found`);
  const [state0] = await db.select().from(agentRoomStates).where(eq(agentRoomStates.roomId, roomId));
  if (!room.consentAt)
    return { processed: 0, edits: 0, rootPageId: docPageIdOf(state0), skipped: "no consent yet" };

 // unprocessed (processedAt IS NULL) + post-consent messages only
  const batch = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.roomId, roomId),
        isNull(chatMessages.processedAt),
        gt(chatMessages.createdAt, room.consentAt)
      )
    )
    .orderBy(asc(chatMessages.createdAt))
    .limit(200); // caps LLM prompt blowup — the excess waits for the next run (idempotent)

 // What was said aloud on a call counts as much as what was typed, so the
 // record keeps up with a conversation that never touched the keyboard.
  const spoken = await db
    .select()
    .from(callUtterances)
    .where(
      and(
        eq(callUtterances.roomId, roomId),
        isNull(callUtterances.processedAt),
        gt(callUtterances.createdAt, room.consentAt)
      )
    )
    .orderBy(asc(callUtterances.createdAt))
    .limit(200);

 // A call in progress belongs to the recap, which writes it up as one entry
 // when it ends — folding its lines in now would scatter it across the timeline.
  const live = getCall(roomId);
  const settled = live ? spoken.filter((u) => u.callId !== live.callId) : spoken;

  if (!batch.length && !settled.length)
    return { processed: 0, edits: 0, rootPageId: docPageIdOf(state0), skipped: "no new messages" };

 // participants = room members + creator. The OKF tree has no permissions,
 // so okf_acl uses this list to make the doc (folder and below) participant-only.
  const memberIds = (
    await db
      .select({ userId: chatRoomMembers.userId })
      .from(chatRoomMembers)
      .where(eq(chatRoomMembers.roomId, roomId))
  ).map((m) => m.userId);
  const participants = [...new Set([room.createdBy, ...memberIds])];

 // the relationship doc is OKF-file-canonical (CLAUDE.md: folder = content DB).
  const tree = ensureOkfDocTree(roomId, room.name, {
    rootPath: state0?.rootOkfPath,
    sectionPaths: state0?.sectionOkfPaths,
  });
  await setOkfAcl(tree.rootPath, roomId, participants);

  // The agent's own greeting and system notices are not memories — recording
  // them made the Timeline a transcript of the bot talking to itself. They stay
  // in `batch` so the checkpoint still advances past them.
  const authorIds = [...new Set(batch.map((m) => m.authorId))];
  const agentIds = new Set(
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, authorIds), eq(users.isAgent, true)))
    ).map((u) => u.id)
  );
 // Private @agent exchanges belong to one member; the record is shared by both,
 // so they never become memories (they stay in `batch` to advance the checkpoint).
  // "📞 Video Call ended · 4:12" is the call bubble the DM view renders, not
  // something either of them said. Now that a finished call writes its own
  // recap, leaving these in would record the call twice — once as what was
  // discussed, once as the bare fact that a call happened.
  const typed = batch.filter(
    (m) => !agentIds.has(m.authorId) && !m.privateToUserId && !m.text.startsWith("📞 ")
  );
 // Spoken lines join the same stream, tagged so the model knows they were said
 // out loud and so provenance can cite the call instead of a message anchor.
  const callOf = new Map(settled.map((u) => [u.id, u.callId]));
  const source = [
    ...typed,
    ...settled.map((u) => ({
      id: u.id,
      roomId: u.roomId,
      authorId: u.speakerId,
      text: u.text,
      attachments: [],
      privateToUserId: null,
      processedAt: null,
      recordedAt: null,
      createdAt: u.createdAt,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) as ChatMessage[];

  const current = readOkfSectionTexts(tree);
 // Deterministic path when the LLM is off or unreachable — the memory still
 // gets written (fakeEdits appends each message to the Timeline), so the
 // agent always records even without an AI endpoint configured.
  let rawEdits: DocEdit[];
  // Only an explicit opt-out picks the deterministic path. AI_URL is optional —
  // the provider defaults to the local vLLM — so gating on it here silently
  // demoted every real run to fakeEdits (no photo reading, chat copied verbatim).
  if (!source.length) {
    rawEdits = []; // nothing but agent chatter this round
  } else if (process.env.AGENT_FAKE_LLM === "1") {
    rawEdits = fakeEdits(source);
  } else {
    try {
      rawEdits = await llmEdits(source, current, room.name);
    } catch (err) {
      console.error("llm edits failed, recording deterministically:", err);
      rawEdits = fakeEdits(source);
    }
  }
 // source forgery prevention: sourceMessageIds only count if they exist in this batch
  const batchIds = new Set(source.map((m) => m.id));
  const edits = rawEdits.map((e) => ({
    ...e,
    // the batch is fed to the model as "[id] (author) text", and it copies that
    // shape back into prose — provenance already rides in Sources, so a raw
    // uuid in the record is noise the reader should never see
    markdown: e.markdown.replace(/\s*\[[0-9a-f]{8}-[0-9a-f-]{27}\]/gi, "").trimEnd(),
    sourceMessageIds: e.sourceMessageIds.filter((id) => batchIds.has(id)),
  }));

 // apply to files — append at the section .md's end (never overwrite wholesale; keeps prior curation).
  for (const edit of edits) {
    const rel = tree.sectionPaths[edit.section];
    if (!rel) continue;
    // "photos shared = a date event" is a hard rule, not an LLM judgement call:
    // real-time single-message batches rarely get classified, but a moment with
    // pictures must still land in the formal template.
    let event = edit.section === "timeline" ? edit.event : undefined;
    if (edit.section === "timeline" && !event) {
      const cited = source.filter((m) => edit.sourceMessageIds.includes(m.id));
      if (cited.some((m) => (m.attachments ?? []).some((a) => IMG_EXT.test(a.url))))
        event = { kind: "date" };
    }
    const lines: NewLine[] =
      edit.section === "timeline" && event
        ? timelineEventLines(edit, event, source)
        : edit.markdown
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => {
              // ![caption](url) becomes a real image block — as a paragraph the photo
              // would sit in the doc as literal markdown text and never render.
              const img = IMG_LINE.exec(l.trim());
              if (img) return { type: "image" as const, text: img[1], url: img[2] };
              return {
                type: l.startsWith("- ") ? ("bulleted_list" as const) : ("paragraph" as const),
                text: l.replace(/^- /, ""),
              };
            });
    if (edit.sourceMessageIds.length) {
      const links = edit.sourceMessageIds
        .map((id) => {
          const callId = callOf.get(id);
          // a settled line has no message to jump to — cite the call it came from
          return callId
            ? `${CHAT_ROUTE_PREFIX}/${roomId}#call-${callId}`
            : `${CHAT_ROUTE_PREFIX}/${roomId}#msg-${id}`;
        })
        .join(" · ");
      lines.push({ type: "paragraph", text: `Sources: ${links}` });
    }
    const title = SECTIONS.find((s) => s.key === edit.section)?.title ?? edit.section;
    appendOkfLines(rel, title, lines, okfDocMeta(roomId, edit.section));
  }

 // the checkpoint advances only after file writes finish. Files can't join
 // the DB transaction, so if the DB fails after a successful write the next
 // run re-applies the same batch (duplicate lines) — a known trade-off of
 // the file-canonical model.
  const now = new Date();
 // messages an applied edit cited — the transcript marks these quietly instead
 // of the agent posting "saved it!" into the middle of the conversation.
  const recordedIds = [...new Set(edits.flatMap((e) => e.sourceMessageIds))];
  await db.transaction(async (tx) => {
    if (batch.length)
      await tx
        .update(chatMessages)
        .set({ processedAt: now })
        .where(inArray(chatMessages.id, batch.map((m) => m.id)));
    if (settled.length)
      await tx
        .update(callUtterances)
        .set({ processedAt: now })
        .where(inArray(callUtterances.id, settled.map((u) => u.id)));
    if (recordedIds.length) {
      await tx
        .update(chatMessages)
        .set({ recordedAt: now })
        .where(inArray(chatMessages.id, recordedIds));
    }
    await tx
      .insert(agentRoomStates)
      .values({
        roomId,
        rootOkfPath: tree.rootPath,
        sectionOkfPaths: tree.sectionPaths,
        lastRunAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentRoomStates.roomId,
        set: {
          rootOkfPath: tree.rootPath,
          sectionOkfPaths: tree.sectionPaths,
          lastRunAt: now,
          updatedAt: now,
        },
      });
  });

  return {
    processed: batch.length + settled.length,
    edits: edits.length,
    rootPageId: okfDocPageId(tree.rootPath),
  };
}

/** Room state → a page id that opens the doc root. Prefers OKF (current);
 * rooms from the Postgres-doc era return their legacy uuid unchanged. */
export function docPageIdOf(
  state: { rootOkfPath?: string | null; rootPageId?: string | null } | undefined
): string | null {
  if (state?.rootOkfPath) return okfDocPageId(state.rootOkfPath);
  return state?.rootPageId ?? null;
}
