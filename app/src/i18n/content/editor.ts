/** Korean data the editor matches against — not UI text, so it does not go
 *  through t(). Kept here so no Hangul lives outside src/i18n. */

/** Korean slash-menu search words per item (`id ?? type` in SLASH_ITEMS).
 *  Includes the item's old Korean label so typing it in Korean still finds it. */
export const SLASH_KEYWORDS_KO: Record<string, string> = {
  aindrive: "aindrive에서 가져오기 에이아이드라이브 드라이브 가져오기",
  paragraph: "텍스트",
  heading1: "제목1",
  heading2: "제목2",
  heading3: "제목3",
  bulleted_list: "글머리 기호 목록",
  numbered_list: "번호 매기기 목록",
  todo: "할 일 목록",
  toggle: "토글 목록",
  quote: "인용",
  divider: "구분선",
  toc: "목차",
  link_to_page: "페이지 링크",
  file: "파일",
  ai_prompt: "AI에게 요청",
  equation: "블록 수식",
  button: "버튼",
  template_button: "템플릿 버튼",
  code: "코드",
  callout: "콜아웃",
  table: "표",
  database: "데이터베이스",
  image: "이미지",
  bookmark: "웹 북마크",
  video: "동영상",
  embed: "임베드",
  dashboard: "대시보드 보기",
  child_page: "페이지",
  column_list: "열",
};

/** Mention-menu date words, Korean side (read as a prefix of the query). */
export const DATE_WORDS_KO = { today: "오늘", tomorrow: "내일", yesterday: "어제" } as const;

/** A date mention pasted from Notion, as the Korean Notion shows it
 *  ("2026년 7월 16일"). Written into the pasted text, so it is data. */
export function notionDateTextKo(year: string, month: number, day: number): string {
  return `${year}년 ${month}월 ${day}일`;
}

/** The 19 Hangul initial consonants (choseong), in syllable-block order —
 *  index = floor((syllable - 0xAC00) / 588). Used for initial-jamo search. */
export const HANGUL_LEAD_JAMO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;
