import "server-only";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRoomStates,
  chatMessages,
  chatRoomMembers,
  chatRooms,
  type ChatMessage,
} from "@/lib/db/schema";
import { aiChat } from "@/lib/ai";
import { setOkfAcl } from "@/lib/okf-acl";
import {
  appendOkfLines,
  ensureOkfDocTree,
  okfDocMeta,
  okfDocPageId,
  readOkfSectionTexts,
  type NewLine,
} from "./okf-docs";
import { parseEdits, SECTIONS, type DocEdit } from "./parse-edits";

/** Swap only this when the chat route settles (source deep-link prefix). */
export const CHAT_ROUTE_PREFIX = "/agent-lab";

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
  return [
    { section: "timeline", markdown: lines.join("\n"), sourceMessageIds: ids },
    { section: "overview", markdown: `Captured ${batch.length} recent messages.`, sourceMessageIds: ids },
  ];
}

async function llmEdits(
  batch: ChatMessage[],
  current: Record<string, string>,
  roomName: string
): Promise<DocEdit[]> {
  const sectionList = SECTIONS.map((s) => `${s.key} (${s.title})`).join(", ");
  const messages = batch.map((m) => `[${m.id}] (${m.authorId.slice(0, 8)}) ${m.text}`).join("\n");
  const raw = await aiChat(
    [
      {
        role: "system",
        content:
          `You are the record-keeper for the "${roomName}" relationship. Read the new batch of messages and incrementally update the relationship document.\n` +
          `Output a JSON array only: [{"section": <one key of ${sectionList}>, "markdown": "<markdown to append>", "sourceMessageIds": ["<supporting message id>"]}].\n` +
          `Do not repeat facts already in the document — only what is newly learned. Every entry must carry its supporting message ids.`,
      },
      {
        role: "user",
        content: `## Current document state\n${JSON.stringify(current, null, 2)}\n\n## New message batch\n${messages}`,
      },
    ],
    { maxTokens: 1500, temperature: 0.2 }
  );
  return parseEdits(raw);
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
  if (!batch.length)
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

  const current = readOkfSectionTexts(tree);
 // Deterministic path when the LLM is off or unreachable — the memory still
 // gets written (fakeEdits appends each message to the Timeline), so the
 // agent always records even without an AI endpoint configured.
  let rawEdits: DocEdit[];
  if (process.env.AGENT_FAKE_LLM === "1" || !process.env.AI_URL) {
    rawEdits = fakeEdits(batch);
  } else {
    try {
      rawEdits = await llmEdits(batch, current, room.name);
    } catch (err) {
      console.error("llm edits failed, recording deterministically:", err);
      rawEdits = fakeEdits(batch);
    }
  }
 // source forgery prevention: sourceMessageIds only count if they exist in this batch
  const batchIds = new Set(batch.map((m) => m.id));
  const edits = rawEdits.map((e) => ({
    ...e,
    sourceMessageIds: e.sourceMessageIds.filter((id) => batchIds.has(id)),
  }));

 // apply to files — append at the section .md's end (never overwrite wholesale; keeps prior curation).
  for (const edit of edits) {
    const rel = tree.sectionPaths[edit.section];
    if (!rel) continue;
    const lines: NewLine[] = edit.markdown
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => ({
        type: l.startsWith("- ") ? ("bulleted_list" as const) : ("paragraph" as const),
        text: l.replace(/^- /, ""),
      }));
    if (edit.sourceMessageIds.length) {
      const links = edit.sourceMessageIds
        .map((id) => `${CHAT_ROUTE_PREFIX}/${roomId}#msg-${id}`)
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
  await db.transaction(async (tx) => {
    await tx
      .update(chatMessages)
      .set({ processedAt: now })
      .where(inArray(chatMessages.id, batch.map((m) => m.id)));
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
    processed: batch.length,
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
