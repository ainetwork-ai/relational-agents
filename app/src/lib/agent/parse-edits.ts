/** 관계 SSOT 문서 골격 (스펙 §5) — read 챗봇과의 내용 계약. */
export const SECTIONS = [
  { key: "overview", title: "Overview" },
  { key: "timeline", title: "Timeline" },
  { key: "decisions", title: "Decisions" },
  { key: "people", title: "People notes" },
  { key: "open-topics", title: "Open topics" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

export interface DocEdit {
  section: SectionKey;
  markdown: string;
  sourceMessageIds: string[];
}

// LLM들이 key 대신 표시 제목("Overview")이나 다른 대소문자를 내는 일이 잦다 —
// key와 제목 모두 소문자로 정규화해 key로 받아준다 (모르는 값만 reject).
const KEY_BY_ALIAS = new Map<string, SectionKey>(
  SECTIONS.flatMap((s) => [
    [s.key.toLowerCase(), s.key],
    [s.title.toLowerCase(), s.key],
  ])
);

/** LLM 응답(JSON 배열, ```json 펜스 허용) → 검증된 DocEdit[]. 불량 입력은 throw. */
export function parseEdits(raw: string): DocEdit[] {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const body = (fenced ? fenced[1] : raw).trim();
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`agent: LLM output is not JSON: ${body.slice(0, 120)}`);
  }
  if (!Array.isArray(data)) throw new Error("agent: LLM output is not an array");
  const edits: DocEdit[] = [];
  for (const item of data) {
    const e = item as Record<string, unknown>;
    const section =
      typeof e?.section === "string" ? KEY_BY_ALIAS.get(e.section.trim().toLowerCase()) : undefined;
    if (!section) throw new Error(`agent: unknown section ${String(e?.section)}`);
    if (typeof e.markdown !== "string") throw new Error("agent: markdown must be string");
    if (!e.markdown.trim()) continue; // 빈 편집은 무시
    const ids = Array.isArray(e.sourceMessageIds)
      ? e.sourceMessageIds.filter((x): x is string => typeof x === "string")
      : [];
    edits.push({ section, markdown: e.markdown, sourceMessageIds: ids });
  }
  return edits;
}
