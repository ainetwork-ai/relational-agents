/**
 * Korean DATA used by app/scripts/*.mts — typed Hangul, demo account and drive
 * names, Korean chat commands a parser must understand. Not UI text; kept here
 * so no Korean literal lives in the scripts themselves.
 */

/** text-crdt.check.mts: plain text with a newline, round-tripped through items */
export const TEXT_CRDT_CHECK = { twoLines: "한 줄\n둘" } as const;

/** text-edit.check.mts: typing a Hangul syllable in the middle of Hangul text */
export const TEXT_EDIT_CHECK = { hangulBefore: "가나", hangulAfter: "가다나" } as const;

/** family-demo-accounts.mts: the demo family — workspace name and aindrive drive name */
export const FAMILY_DEMO_ACCOUNTS = [
  { key: "grandma", name: "할머니", drive: "할머니의 부엌과 앨범" },
  { key: "mom", name: "엄마", drive: "엄마의 살림" },
  { key: "dad", name: "아빠", drive: "아빠의 기록" },
  { key: "seoyeon", name: "서연", drive: "서연이 폰" },
  // not in the family workspace at first — the demo invites him (Family folder → Invite)
  { key: "grandpa", name: "외할아버지", drive: "외할아버지 폰" },
] as const;

/** treasury-selftest.mts: Korean money commands the treasury matcher must parse */
export const TREASURY_SELFTEST = {
  expense: "@agent 호텔 예약금 180달러 보내줘",
  expenseMemo: "호텔 예약금",
  withdrawal: "@agent 700달러 내 지갑으로 보내줘",
  status: "@agent 잔액 알려줘",
  pastTense: "@agent 어제 호텔에 180달러 냈어",
} as const;

/** check-emoji-data.mts: a name that starts with a flag emoji */
export const CHECK_EMOJI_DATA = { flagName: "🇰🇷 팀" } as const;

/** prompt-export.check.mts: Korean requests the prompt skill must read, and a long Hangul title */
export const PROMPT_EXPORT_CHECK = {
  thisPage: "@agent 이 페이지 프롬프트로 만들어줘",
  chuseok: "@agent 추석 페이지를 AI 프롬프트로",
  chuseokWord: "추석",
  options: '@agent 추석 페이지 프롬프트로 만들어줘 깊이 2 하위 페이지 포함 따로 xml 템플릿 지시: "요약해줘"',
  optionsInstruction: "요약해줘",
  merged: "@agent 할 일 페이지를 한 파일로 합쳐서 마크다운 프롬프트로 바꿔줘",
  noChild: "@agent 이 페이지만 프롬프트로 만들어줘",
  hubTitle: "우리 가족 추석 2026",
  albumTitle: "추석 앨범",
  scheduleTitle: "추석 일정 · 내려가는 길",
  longTitle: "가".repeat(40),
} as const;

/** prompt-export-chat.check.mts: Korean chat the prompt skill must read — or leave alone */
export const PROMPT_EXPORT_CHAT_CHECK = {
  /** questions and chat about prompts: never the skill */
  notRequests: [
    "@agent 이 앨범 만들 때 쓴 프롬프트 뭐야?",
    "@agent 앨범 만들 때 어떤 프롬프트 썼어?",
    "@agent 프롬프트가 뭐야?",
    "@agent 무슨 프롬프트로 그렸어?",
  ],
  /** requests with the page named, and the title words left over */
  requests: [
    ["@agent 추석 페이지를 프롬프트로 바꿔줄래?", "추석"],
    ["@agent 추석 페이지 좀 프롬프트로 만들어 줄 수 있어?", "추석"],
    ["@agent 추석 페이지 가지고 프롬프트 만들어줘", "추석"],
    ["@agent 추석 페이지를 프롬프트로 만들어 주라", "추석"],
    ["@agent 서연이 페이지 프롬프트로 만들어줘", "서연이"],
    ["@agent 가족 나들이 페이지를 프롬프트로 만들어줘", "가족 나들이"],
  ],
  /** the open page: "이거", "여기", "이 문서", or nothing but the request */
  openPage: ["@agent 이거 프롬프트로 만들어줘", "여기 프롬프트로 바꿔줘", "@agent 이 문서 프롬프트로 만들어줘", "프롬프트로 만들어줘요"],
  /** a title with no page word: a maybe, taken only if it names a page */
  maybeTitle: ["@agent 추석 앨범을 프롬프트로 만들어줘", "추석 앨범"],
  /** options: depth said with a particle, "at most" before it, and a limit */
  depthMax: "@agent 추석 페이지 프롬프트로 만들어줘 깊이 최대 3",
  depthParticle: "@agent 추석 페이지 프롬프트로 만들어줘 깊이는 2로",
  depthLevels: "@agent 추석 페이지 프롬프트로 최대 3단계",
  limitCount: "@agent 추석 페이지 프롬프트로 최대 200개",
  oneFilePerPage: "@agent 추석 페이지 프롬프트로 페이지마다 파일 하나씩",
  oneFile: "@agent 추석 페이지 프롬프트로 한 파일로",
  chuseokWord: "추석",
  /** answers to "Which one?" */
  answers: [
    ["2번", 1],
    ["2번이요", 1],
    ["두 번째", 1],
    ["첫 번째 거요", 0],
    ["세 번째로 해줘", 2],
  ],
  yes: ["응", "네 맞아요", "그거요"],
  /** titles offered back: the album, the meeting, the hub */
  choices: ["추석 앨범", "추석 밤 · 가족회의", "2026 우리 가족 추석"],
  albumWord: "앨범",
  hubTitle: "2026 우리 가족 추석",
  promptPage: "AI 프롬프트 — 2026 우리 가족 추석",
  /** a family skill's own request, right after "which one?" */
  albumRequest: "@agent 제주 앨범 만들어줘",
} as const;
