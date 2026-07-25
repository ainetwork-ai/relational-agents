import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, type ChatRoom } from "@/lib/db/schema";
import { runPipeline, type RunResult } from "@/lib/agent/pipeline";

const BATCH_SIZE = Number(process.env.AGENT_BATCH_SIZE ?? 10);
const IDLE_MS = Number(process.env.AGENT_IDLE_MS ?? 120_000);

// 유휴 트리거 (스펙 §4-2): 방별 디바운스 — 마지막 메시지 후 IDLE_MS 지나면 실행.
// 서버 프로세스 메모리 기반(데모 규모). 재시작으로 소실돼도 다음 메시지/수동
// 트리거가 미처리분을 회수한다(파이프라인이 멱등이므로 안전).
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
 * 메시지 저장 직후 호출 — 미수집 누적이 K건이면 즉시 파이프라인 실행,
 * 아니면 유휴 실행 예약. agent 방과 dm 방이 같은 수확 경로를 공유한다.
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
  if (pending.length >= BATCH_SIZE) {
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
