import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, type ChatRoom } from "@/lib/db/schema";
import { runPipeline, type RunResult } from "@/lib/agent/pipeline";

const BATCH_SIZE = Number(process.env.AGENT_BATCH_SIZE ?? 10);
const IDLE_MS = Number(process.env.AGENT_IDLE_MS ?? 120_000);

// Idle trigger: per-room debounce — runs IDLE_MS after the last
// message. Lives in server-process memory (demo scale). Lost on restart, but
// the next message / manual trigger recovers the backlog (safe because the
// pipeline is idempotent).
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleIdleRun(roomId: string) {
  clearTimeout(idleTimers.get(roomId));
  idleTimers.set(
    roomId,
    setTimeout(() => {
      idleTimers.delete(roomId);
      runPipeline(roomId).catch((err) => console.error("agent idle-run failed:", err));
    }, IDLE_MS)
  );
}

/**
 * Called right after a message is stored — runs the pipeline immediately at
 * K+ uncollected messages, else schedules an idle run. Agent rooms and DM
 * rooms share the same harvesting path.
 */
export async function maybeAutoRun(room: ChatRoom): Promise<RunResult | undefined> {
  const pending = room.consentAt
    ? await db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.roomId, room.id),
            isNull(chatMessages.processedAt),
            gt(chatMessages.createdAt, room.consentAt)
          )
        )
    : [];
 // Relationship DM rooms are human-paced and low-volume — record each message
 // right away so the memory shows up immediately. Agent-lab rooms keep the batch.
  const threshold = room.kind === "dm" ? 1 : BATCH_SIZE;
  if (pending.length >= threshold) {
    clearTimeout(idleTimers.get(room.id));
    idleTimers.delete(room.id);
    try {
      return await runPipeline(room.id);
    } catch (err) {
      console.error("agent auto-run failed:", err);
      return undefined;
    }
  }
  if (room.consentAt) scheduleIdleRun(room.id);
  return undefined;
}
