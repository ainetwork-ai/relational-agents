/**
 * Korean content the e2e checks (app/e2e) type, seed or expect: demo file
 * names, people, page titles, IME test inputs, and Notion golden-set strings
 * that are not app UI text. It is DATA, not UI text; UI strings come from
 * ko.ts through `ko("English key")` in app/e2e/i18n.mjs.
 *
 * Plain node loads this file by stripping types, so keep it to erasable
 * TypeScript (no enums, namespaces or parameter properties) and no imports.
 * One exported object per check file, named after the file.
 */

/** block-spacing.check.mjs: text of the demo blocks the check creates (Korean, like the Notion page it was measured on) */
export const BLOCK_SPACING = {
  text: "텍스트",
  heading1: "제목1",
  heading2: "제목2",
  heading3: "제목3",
  bullet: "글머리",
  bullet1: "글머리1",
  bullet2: "글머리2",
  number: "번호",
  number1: "번호1",
  number2: "번호2",
  todo: "할일",
  todo1: "할일1",
  todo2: "할일2",
  toggle: "토글",
  quote: "인용",
  callout: "콜아웃",
  toggleChild: "안",
} as const;

/** plus-menu.check.mjs: text of the line with content */
export const PLUS_MENU = { contentText: "내용" } as const;

/** ime-enter.check.mjs: the comment typed through the IME composition */
export const IME_ENTER = { text: "댓글" } as const;

/** save-protocol.check.mjs: paragraph filler for the 65KB page, the small page's text, the text typed for the fan-out check */
export const SAVE_PROTOCOL = {
  filler: "가나다라마바사아자차카타파하 방문객 KPI 수치와 매출 집계, 부스 운영 메모. ",
  smallPage: "작은 페이지",
  fanout: "팬아웃",
} as const;

/** notion-paste.check.mjs: texts from the captured Notion page (the consultation/monitoring FLOW page) */
export const NOTION_PASTE = {
  toggleChild: "증권봇 시나리오 수집",
  scenarioHeading: "[시나리오 활용방법]",
  boldWord: "분리하여",
  timelineItem: "커뮤니케이션 타임라인",
} as const;

/** comment-delete.check.mjs: bodies of the comments the check posts (and later deletes) */
export const COMMENT_DELETE = {
  permission: "삭제 권한 검사용",
  root: "루트 — 답글 보존 검사",
  reply: "답글 — 남아 있어야 함",
  guestBait: "게스트가 보면 안 되는 댓글",
  exMember: "나간 사람이 남긴 댓글",
  edited: "고쳐버림",
  uiTarget: "UI 삭제 검사용 댓글",
  others: "남의 댓글 — 액션 없어야 함",
} as const;

/** page-comments-inline.check.mjs: fragments that pick entries out of the captured `inline.surfaces[].page` labels */
export const PAGE_COMMENTS_INLINE = {
  fullPageDb: "풀페이지",
  noComments: "댓글 없음",
} as const;

/** mention.check.mjs: a Korean-named test member, the initial consonant typed to find her, and Notion's "Group" section head (no app key: we have no group section) */
export const MENTION = {
  hangulName: "홍혜령",
  initial: "ㅎ",
  groupHead: "그룹",
} as const;

/** comment-collapse.check.mjs: prefix of the seeded comment bodies ("<prefix>1", "<prefix>2", …) */
export const COMMENT_COLLAPSE = { bodyPrefix: "댓글 " } as const;

/** page-delete.check.mjs: titles of the database, rows, and pages the check creates */
export const PAGE_DELETE = {
  dbTitle: "e2e 삭제 검사",
  rowA: "A 피크",
  rowB: "B 전체",
  rowE: "E 영구",
  pageC: "C 일반",
  pageD: "D 게스트 거절",
} as const;

/** upload-promotion.check.mjs: upload file names (a person's name must survive promotion) */
export const UPLOAD_PROMOTION = {
  report: "보고서.pdf",
  otherName: "완전히 다른 이름.pdf",
} as const;

/** file-range.check.mjs: body of the comment the attachments hang on */
export const FILE_RANGE = { commentBody: "range 검사용" } as const;

/** file-routes.check.mjs: body of the comment the test files hang on */
export const FILE_ROUTES = { commentBody: "첨부 라우트 검사" } as const;

/** created-time.check.mjs: the year suffix of a ko-KR long date ("2026년 …") */
export const CREATED_TIME = { yearSuffix: "년" } as const;

/** demo-caller.mjs: the demo account that places the call by default */
export const DEMO_CALLER = { caller: "할머니" } as const;

/** CHAT-fix-01-overflow.spec.ts: chat messages seeded to test overflow */
export const CHAT_FIX_01_OVERFLOW = {
  longPrefix: "초장문 ",
  longUnit: "가나다라마",
  showCode: "코드 보여줘",
} as const;

/** CHAT-fix-02-links.spec.ts: chat message seeded to get a reply with links */
export const CHAT_FIX_02_LINKS = { showLinks: "링크 보여줘" } as const;
