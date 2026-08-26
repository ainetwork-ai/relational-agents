/** English over the Korean source keys. A key that is missing here falls back
 *  to the Korean text, so the UI never shows a blank — fill this from the
 *  English Notion captures (docs/i18n-plan.md §5 Q1). */
export const en: Record<string, string> = {
  한국어: "Korean",
  "English (US)": "English (US)",
  // editor — placeholders and the type menu (the original's English strings)
  // no AI feature here, so the original's "space for AI" half is dropped (comcom, 2026-08-26)
  "명령어는 '/'를 입력하세요.": "Press '/' for commands",
  "필터링 기준을 입력하세요.": "Type to filter…",
  "빈 토글입니다. 클릭하거나 블록을 내부로 드래그하세요.": "Empty toggle. Click or drop blocks inside.",
  "기본 블록": "Basic blocks",
  미디어: "Media",
  데이터베이스: "Database",
  "고급 블록": "Advanced blocks",
  "메뉴 닫기": "Close menu",
};
