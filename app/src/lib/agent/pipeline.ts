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

/** 채팅 라우트 확정 시 여기만 교체 (스펙 §6 — 출처 딥링크 프리픽스). */
export const CHAT_ROUTE_PREFIX = "/agent-lab";

export interface RunResult {
  processed: number;
  edits: number;
  rootPageId: string | null;
  skipped?: string;
}

/** 방별 실행 뮤텍스 — 수동/누적/유휴 트리거가 겹쳐도 동시 이중 적용 방지.
 *  단일 next-server 프로세스 전제(데모 규모). */
const running = new Map<string, Promise<RunResult>>();

/** 관계 문서는 전역 OKF 파일 루트에 쓰므로 워크스페이스 인자가 필요 없다. */
export function runPipeline(roomId: string): Promise<RunResult> {
  const prev = running.get(roomId) ?? Promise.resolve(undefined as unknown as RunResult);
  const next = prev.catch(() => undefined).then(() => runOnce(roomId));
  running.set(roomId, next);
  // cleanup은 파생 promise를 만들되 reject를 삼켜 unhandledRejection을 막는다
  next.catch(() => {}).finally(() => {
    if (running.get(roomId) === next) running.delete(roomId);
  });
  return next;
}

/** 오프라인/테스트 경로(AGENT_FAKE_LLM=1): 배치를 결정적으로 반영. */
function fakeEdits(batch: ChatMessage[]): DocEdit[] {
  const ids = batch.map((m) => m.id);
  return [
    {
      section: "timeline",
      markdown: batch.map((m) => `- ${m.text}`).join("\n"),
      sourceMessageIds: ids,
    },
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

/** 스펙 §4: 수집→문서 보장→편집 생성→적용(+출처)→체크포인트. 적용과 처리
 *  마킹은 한 트랜잭션(부분 적용→중복 재수집 방지). 멱등. */
async function runOnce(roomId: string): Promise<RunResult> {
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId));
  if (!room) throw new Error(`agent: room ${roomId} not found`);
  const [state0] = await db.select().from(agentRoomStates).where(eq(agentRoomStates.roomId, roomId));
  if (!room.consentAt)
    return { processed: 0, edits: 0, rootPageId: docPageIdOf(state0), skipped: "no consent yet" };

  // 미처리(processedAt IS NULL) + 동의 이후 메시지만 (스펙 §2·§4-1)
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
    .limit(200); // LLM 프롬프트 폭주 방지 — 초과분은 다음 실행에서 처리(멱등)
  if (!batch.length)
    return { processed: 0, edits: 0, rootPageId: docPageIdOf(state0), skipped: "no new messages" };

  // 참여자 = 방 멤버 + 생성자. OKF 파일 트리엔 권한이 없으므로 okf_acl이
  // 이 목록으로 문서(폴더 이하 전체)를 참여자 전용으로 만든다.
  const memberIds = (
    await db
      .select({ userId: chatRoomMembers.userId })
      .from(chatRoomMembers)
      .where(eq(chatRoomMembers.roomId, roomId))
  ).map((m) => m.userId);
  const participants = [...new Set([room.createdBy, ...memberIds])];

  // 관계 문서는 OKF 파일이 원본이다 (CLAUDE.md: 폴더=콘텐츠 DB).
  const tree = ensureOkfDocTree(roomId, room.name, {
    rootPath: state0?.rootOkfPath,
    sectionPaths: state0?.sectionOkfPaths,
  });
  await setOkfAcl(tree.rootPath, roomId, participants);

  const current = readOkfSectionTexts(tree);
  const rawEdits =
    process.env.AGENT_FAKE_LLM === "1" ? fakeEdits(batch) : await llmEdits(batch, current, room.name);
  // 출처 위조 방지: sourceMessageIds는 이번 배치에 실존하는 id만 인정
  const batchIds = new Set(batch.map((m) => m.id));
  const edits = rawEdits.map((e) => ({
    ...e,
    sourceMessageIds: e.sourceMessageIds.filter((id) => batchIds.has(id)),
  }));

  // 파일에 적용 — 섹션 .md 끝에 덧붙인다(통째 덮어쓰기 금지, 기존 정리 보존).
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

  // 파일 쓰기가 끝난 뒤에만 체크포인트를 전진시킨다. 파일은 DB 트랜잭션에
  // 참여할 수 없으므로, 쓰기 성공 후 DB가 실패하면 다음 실행이 같은 배치를
  // 다시 반영한다(중복 라인) — 파일-원본 모델의 알려진 트레이드오프.
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

/** 방 상태 → 문서 루트를 열 수 있는 페이지 id. OKF(현행)를 우선하고,
 *  Postgres에 문서를 두던 시절의 방은 레거시 uuid를 그대로 돌려준다. */
export function docPageIdOf(
  state: { rootOkfPath?: string | null; rootPageId?: string | null } | undefined
): string | null {
  if (state?.rootOkfPath) return okfDocPageId(state.rootOkfPath);
  return state?.rootPageId ?? null;
}
