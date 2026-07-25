import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRoomStates } from "@/lib/db/schema";
import { aiChat } from "@/lib/ai";
import { SECTIONS } from "./parse-edits";
import { okfDocTreeFromState, readOkfSectionTexts } from "./okf-docs";

/**
 * 발송 전 사실검증 게이트 (decline).
 *
 * 관계 문서(OKF 파일)를 근거로 "보내려는 초안이 기록과 어긋나는가"를 판정한다.
 * relation-agent 설계에서 가져온 개념 규칙 — 오탐이 이 기능을 죽이므로 엄격하다:
 *
 *   1. AND 조건        — [기록과 모순] AND [관계악화 위험] 둘 다일 때만 decline
 *   2. 기억에 없음 ≠ 거짓 — 기록에 없는 새 주제는 절대 막지 않는다
 *   3. 프리필터        — 관련 기억이 없으면 LLM을 아예 부르지 않는다 (checked:false)
 *   4. 근거 필수        — 문서에서 실제로 확인되는 인용이 없으면 decline로 올리지 않는다
 *                       (모델이 근거를 지어낸 경우를 걸러낸다)
 *
 * 최종 결정권은 사람에게 있다 — 호출자는 decline이어도 강제발송을 허용해야 한다.
 */

export interface GuardEvidence {
  /** 근거가 나온 섹션 제목 (예: "타임라인") */
  section: string;
  quote: string;
}

export interface GuardResult {
  verdict: "allow" | "decline";
  /** false = 참고할 기억이 없어 검증을 건너뜀 (UI는 배지를 띄우지 않는다) */
  checked: boolean;
  reason?: string;
  suggestion?: string;
  evidence?: GuardEvidence[];
}

/** 프롬프트에 넣는 문서 총량 상한 — 문서가 커져도 프롬프트가 터지지 않게. */
const MAX_DOC_CHARS = 6_000;

const ALLOW_UNCHECKED: GuardResult = { verdict: "allow", checked: false };

/** 한글에도 통하는 문자 bigram 집합 (형태소 분석 없이 관련성 추정). */
function bigrams(s: string): Set<string> {
  const t = s.replace(/[^0-9A-Za-z가-힣]/g, "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

/** 공백·기호를 지운 비교용 정규화 (인용 검증에 사용). */
function norm(s: string): string {
  return s.replace(/\s+/g, "").replace(/["'`“”‘’]/g, "");
}

interface LlmVerdict {
  contradicts?: boolean;
  harmful?: boolean;
  reason?: string;
  suggestion?: string;
  evidence?: { quote?: string }[];
}

function parseVerdict(raw: string): LlmVerdict | null {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const body = (fenced ? fenced[1] : raw).trim();
  try {
    const v = JSON.parse(body) as LlmVerdict;
    return typeof v === "object" && v !== null ? v : null;
  } catch {
    return null;
  }
}

/** 오프라인/테스트 경로 — 결정적. 초안에 [fake-decline]이 있으면 차단. */
function fakeCheck(draft: string, docText: string): GuardResult {
  if (!draft.includes("[fake-decline]")) return { verdict: "allow", checked: true };
  const firstLine = docText.split("\n").find((l) => l.trim()) ?? "";
  return {
    verdict: "decline",
    checked: true,
    reason: "[fake-guard] This conflicts with the record.",
    suggestion: "[fake-guard] Rewrite it to match the record.",
    evidence: firstLine ? [{ section: "Timeline", quote: firstLine.slice(0, 120) }] : [],
  };
}

/**
 * 초안 하나를 검증한다. 방에 관계 문서가 없거나 관련 기억이 없으면
 * `{verdict:"allow", checked:false}` — 조용히 통과시킨다.
 */
export async function checkDraft(roomId: string, draft: string): Promise<GuardResult> {
  const text = draft.trim();
  if (!text) return ALLOW_UNCHECKED;

  const [state] = await db
    .select()
    .from(agentRoomStates)
    .where(eq(agentRoomStates.roomId, roomId));
  const tree = okfDocTreeFromState(state);
  if (!tree) return ALLOW_UNCHECKED; // 아직 기억이 없는 방

  const sections = readOkfSectionTexts(tree);
  const bySection = SECTIONS.map((s) => ({ title: s.title, body: sections[s.key] ?? "" })).filter(
    (s) => s.body.trim()
  );
  const docText = bySection.map((s) => `### ${s.title}\n${s.body}`).join("\n\n");
  if (!docText.trim()) return ALLOW_UNCHECKED;

  // 프리필터: 초안과 문서가 **전혀** 겹치지 않을 때만 "관련 기억 없음"으로 통과.
  // 임계값을 올리면 핵심 명사 하나만 겹치는 초안(예: 문서의 "속초"를 언급하는 초안)이
  // 검증 없이 빠져나간다 — 실제로 그렇게 새는 것을 확인해 1로 낮췄다. 오탐은 여기서
  // 막지 않는다: AND 조건 + 근거 검증이 그 역할을 한다.
  if (overlap(bigrams(text), bigrams(docText)) === 0) return ALLOW_UNCHECKED;

  if (process.env.AGENT_FAKE_LLM === "1") return fakeCheck(text, docText);

  const doc = docText.length > MAX_DOC_CHARS ? docText.slice(0, MAX_DOC_CHARS) : docText;
  let raw: string;
  try {
    raw = await aiChat(
      [
        {
          role: "system",
          content:
            "You are a fact-checker guarding the shared record of a relationship. Decide whether the user's draft " +
            "contradicts that record.\n" +
            "Block (contradicts=true, harmful=true) **only when both are true**:\n" +
            "  contradicts = it directly contradicts a recorded fact (new content absent from the record is NOT a contradiction)\n" +
            "  harmful = sending it as-is could hurt the other person or damage the relationship\n" +
            "Important: **never block something just because it is not in the record.** New topics, plans and feelings always pass.\n" +
            "If you judge it a contradiction, put the exact sentence copied from the document into evidence (no summarizing or rewording).\n" +
            'Output JSON only: {"contradicts":bool,"harmful":bool,"reason":"...","suggestion":"...","evidence":[{"quote":"..."}]}',
        },
        {
          role: "user",
          content: `## Relationship record\n${doc}\n\n## Draft to send\n${text}`,
        },
      ],
      { maxTokens: 500, temperature: 0.1 }
    );
  } catch (e) {
    // 검증기 장애가 발송을 막아선 안 된다 — 통과시키고 로그만 남긴다
    console.error("guard: llm failed:", e);
    return ALLOW_UNCHECKED;
  }

  const v = parseVerdict(raw);
  if (!v) return { verdict: "allow", checked: true };
  if (!(v.contradicts === true && v.harmful === true)) return { verdict: "allow", checked: true };

  // 근거 검증: 문서에 실제로 있는 인용만 인정 (지어낸 근거 제거)
  const evidence: GuardEvidence[] = [];
  for (const e of v.evidence ?? []) {
    const q = (e?.quote ?? "").trim();
    if (!q) continue;
    const hit = bySection.find((s) => norm(s.body).includes(norm(q)));
    if (hit) evidence.push({ section: hit.title, quote: q });
  }
  // 규칙 4 — 확인 가능한 근거가 없으면 차단하지 않는다 (오탐 방지)
  if (!evidence.length) return { verdict: "allow", checked: true };

  return {
    verdict: "decline",
    checked: true,
    reason: v.reason?.trim() || "This conflicts with the record.",
    suggestion: v.suggestion?.trim() || undefined,
    evidence,
  };
}
