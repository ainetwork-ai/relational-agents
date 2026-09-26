/**
 * Korean DATA the agent code matches or writes — keyword lists it looks for in
 * chat, folder and file names in the family's drives, the column and stage
 * names of the databases it builds. Not UI text: these stay Korean whatever
 * the UI language, and code under src/lib/agent imports them from here so no
 * Korean literal lives in the code itself. Where a list is matched against
 * chat, it carries the English words too.
 *
 * Entries are regex SOURCE fragments (joined with `|` into one group) unless
 * named otherwise.
 */

/** `(a|b|c)` — a group of alternatives, case-insensitive. */
export const anyOf = (words: readonly string[], flags = "i") => new RegExp(`(${words.join("|")})`, flags);

// ── family skills (src/lib/agent/family-skills.ts) ─────────────────────────

/** A skill fires when the sentence has one `topic` word AND one `act` word. */
export const FAMILY_SKILL_WORDS = {
  allowance: {
    topic: ["용돈", "pocket money", "allowance"],
    act: ["영상", "열어", "열자", "보자", "보내", "줘", "주고", "주자", "video", "open", "give", "send", "watch"],
  },
  todos: {
    topic: ["녹음", "recording"],
    act: ["할 ?일", "todo", "to-do", "투두", "정리", "뽑", "목록", "task", "action item", "extract", "list"],
  },
  album: {
    topic: ["앨범", "album"],
    act: ["정리", "만들", "모아", "묶", "make", "create", "organi[sz]e", "put together", "build", "sort"],
  },
  shopping: {
    topic: ["장보기", "장 볼", "재료", "shopping list", "grocery", "ingredients"],
    act: ["목록", "리스트", "만들", "정리", "알려", "list", "make", "what"],
  },
  /** "4인분 만들어줘" — a number of servings and something to do with it */
  servingsAct: ["만들", "목록", "장보기", "알려", "make", "list", "shop", "cook"],
} as const;

/** The prompt skill (src/lib/agent/family-skills.ts → src/lib/prompt-export): turn a
 *  page into an AI-ready prompt, with notion2prompt's options said in the sentence.
 *  Regex fragments, matched case-insensitively. */
export const PROMPT_WORDS = {
  /** the request itself — asked for as a prompt, not a word in passing ("what prompt did
   *  you use?" must not fire it): into / as a prompt, or a making verb before "prompt" */
  ask: [
    "프롬프트\\s*(?:으)?로",
    "프롬프트(?:를|을)?\\s*(?:만들|생성|뽑|추출|써|작성)",
    "(?:만들|바꿔|바꾸|변환|생성|뽑).{0,20}프롬프트",
    "\\b(?:make|turn|convert|create|generate|export|build|write|give me)\\b.{0,60}\\bprompts?\\b",
    "\\b(?:into|as) (?:an? )?(?:ai[- ])?prompt\\b",
    "\\bprompt from\\b",
    "page[- ]to[- ]prompt",
    "notion2prompt",
  ],
  /** "depth 2", "깊이 2", "단계 2" */
  depth: ["depth", "깊이", "단계"],
  /** "2단계", "2 levels" */
  depthAfter: ["단계(?:까지)?", "levels?(?: deep)?"],
  /** "limit 200", "최대 200" */
  limit: ["limit", "최대", "한도"],
  childPagesOn: [
    "하위\\s*페이지\\s*(?:까지|포함|도)",
    "with (?:its |the )?(?:child|sub)[- ]?pages",
    "including (?:its |the )?(?:child|sub)[- ]?pages",
    "include (?:its |the )?(?:child|sub)[- ]?pages",
  ],
  childPagesOff: [
    "하위\\s*페이지\\s*(?:없이|빼고|제외)",
    "이\\s*페이지만",
    "without (?:its |the )?(?:child|sub)[- ]?pages",
    "no (?:child|sub)[- ]?pages",
    "(?:this|the) page only",
    "only (?:this|the) page",
  ],
  /** each child page its own file */
  separate: ["따로", "각각", "페이지별로?", "separate(?:ly)?", "(?:one )?file per page"],
  /** child pages merged into one file */
  merged: ["합쳐", "하나로", "한\\s*파일", "\\bmerged?\\b", "single file", "one file", "\\binline\\b"],
  alwaysDatabases: ["데이터베이스\\s*(?:항상|모두|전부)", "DB\\s*(?:항상|모두|전부)", "always (?:fetch|include) (?:the )?databases", "all (?:the )?databases"],
  propertiesOn: ["속성\\s*(?:포함|까지|도)", "with (?:the )?properties", "include (?:the )?properties"],
  propertiesOff: ["속성\\s*(?:없이|빼고|제외)", "without (?:the )?properties", "no properties"],
  templateXml: ["\\bxml\\b", "\\bclaude\\b"],
  templateMarkdown: ["마크다운", "markdown"],
  templateDefault: ["기본\\s*템플릿", "default template", "\\bdefault\\b"],
  /** notion2prompt's own file names and flat tree, byte for byte */
  layoutUpstream: ["notion2prompt", "노션\\s*형식", "notion (?:layout|format)"],
  /** `지시: "…"`, `instruction: "…"` */
  instruction: ["지시\\s*사항", "지시", "요청\\s*사항", "instructions?"],
  thisPage: ["이\\s*페이지", "현재\\s*페이지", "지금\\s*페이지", "\\bthis page\\b", "\\bcurrent page\\b"],
  /** words taken out before the rest of the sentence is matched against page titles */
  noise: [
    "프롬프트\\s*(?:으로|로|를|을)?", "만들어\\s*(?:줘|주세요|줄래)", "바꿔\\s*(?:줘|주세요)", "변환해\\s*(?:줘|주세요)",
    "뽑아\\s*(?:줘|주세요)", "해\\s*(?:줘|주세요)", "만들어", "만들", "바꿔", "변환", "주세요", "줘",
    "페이지(?:를|을|로|의|에서|에)?", "데이터베이스(?:를|을|로|의)?", "템플릿(?:으로|로)?", "팀\\s*스페이스(?:를|을|로|의)?", "좀",
    "\\bai\\b", "\\bprompts?\\b", "\\bpages?\\b", "\\bdatabase\\b", "\\btemplate\\b", "\\bteamspace\\b",
    "\\bmake\\b", "\\bturn\\b", "\\bconvert\\b", "\\bcreate\\b", "\\bgenerate\\b", "\\bexport\\b", "\\bbuild\\b",
    "\\binto\\b", "\\bfrom\\b", "\\bfor\\b", "\\bof\\b", "\\bthe\\b", "\\ban?\\b", "\\bplease\\b", "\\bme\\b", "\\bcalled\\b",
  ],
  /** Korean title words as someone asking in English says them — "the Chuseok page"
   *  finds 「2026 우리 가족 추석」 (regex fragments, whole words) */
  titleAliases: {
    추석: ["chuseok"],
    생신: ["birthday"],
    앨범: ["album"],
    여행: ["trip", "travel"],
    제주: ["jeju"],
    가족: ["family"],
    할머니: ["grandma", "grandmother"],
    외할아버지: ["grandpa", "grandfather"],
    서연: ["seoyeon", "seo-yeon"],
    녹두전: ["nokdujeon", "mung bean pancakes?"],
    일정: ["schedule"],
    역할: ["roles?"],
    음식: ["food"],
    건강: ["health"],
    선물: ["gifts?", "presents?"],
    용돈: ["pocket money", "allowance"],
    장보기: ["shopping"],
    사진: ["photos?", "pictures?"],
    회의: ["meeting"],
    성묘: ["graves?", "grave visit"],
    귀성길: ["drive down", "trip home"],
    차례상: ["ancestral table", "memorial table"],
  } as Record<string, readonly string[]>,
  /** Korean particles glued to a word ("추석을", "추석의") — dropped before matching a title */
  particles: ["으로", "에서", "까지", "로", "을", "를", "은", "는", "이", "가", "의", "에", "와", "과", "도", "만"],
} as const;

/** "4인분" / "4 servings" — the unit after the number */
export const SERVINGS_UNITS = ["인분", "servings?", "people"] as const;

/** Names the family's data uses, as someone asking in English might say them. */
export const FAMILY_ALIASES: Record<string, string[]> = {
  녹두전: ["nokdujeon", "mung bean pancake", "mung-bean pancake", "bindaetteok"],
  송편: ["songpyeon", "rice cake"],
  토란국: ["toranguk", "taro soup"],
  식혜: ["sikhye", "rice punch"],
  된장찌개: ["doenjang", "soybean paste stew"],
  배추김치: ["kimchi"],
  제주: ["jeju"],
  서연: ["seoyeon", "seo-yeon"],
  할머니: ["grandma", "grandmother"],
  // the English demo's recipe files (recipes/<dish>.md), as someone might say them
  mung_bean_pancake: ["mung bean pancake", "mung-bean pancake", "nokdujeon", "bindaetteok"],
  songpyeon: ["songpyeon", "rice cake"],
  taro_soup: ["taro soup", "toranguk"],
  sikhye: ["sikhye", "rice punch"],
  doenjang_stew: ["doenjang", "soybean paste stew"],
  cabbage_kimchi: ["kimchi"],
};

/** Folder and file-name words in the family's shared drives — the Korean
 *  demo's and the English demo's (regex fragments, matched case-insensitively). */
export const FAMILY_FILES = {
  /** the recipe folder */
  recipeDir: ["레시피", "recipes?"],
  /** the household measure table ("한 줌" / "a handful" → grams) sits next to the recipes */
  measure: ["계량", "measure"],
  /** someone's review of a dish they cooked */
  review: ["후기", "review"],
  /** the trip folder */
  tripDir: ["여행", "trip"],
  /** trip documents worth linking from the album: plan, budget, briefing */
  tripDocs: ["계획", "경비", "브리핑", "plan", "budget", "briefing"],
  /** a photo passed along rather than taken: "sent", "received", "copy" */
  forwarded: ["보냄", "받음", "받은", "복사", "copy", "kakao", "forwarded", "received"],
} as const;

/** The household measure the recipe prompt gives as an example. */
export const HANDFUL = "한 줌";

/** The vocative ending on a child's name ("서연이") — dropped before matching. */
export const NAME_SUFFIX = "이";

/** Places the album can be named for, with their lat/lon box. */
export const ALBUM_REGIONS: Record<string, { box: [number, number, number, number]; en: string }> = {
  제주: { box: [33.0, 33.7, 126.0, 127.1], en: "Jeju" },
};

/** One-letter weekdays, Sunday first, for the album's day headings. */
export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** Column, option and view names of the to-do board built from a recording
 *  (the English board uses the English names in family-skills.ts). */
export const TODO_BOARD_KO = {
  task: "할 일",
  owner: "담당",
  due: "기한",
  state: "상태",
  note: "메모",
  todo: "할 일",
  doing: "진행 중",
  done: "완료",
  byOwner: "담당별",
  progress: "진행",
  table: "표",
  suffix: "할 일",
  meeting: "회의",
} as const;

// ── sales pipeline (src/lib/agent/sales-pipeline.ts) ───────────────────────

export const SALES = {
  /** the page and database title — also how a rebuild finds the page it made before */
  title: "통합 Sales Pipeline",
  stages: {
    lead: "리드",
    discovery: "니즈 파악",
    proposal: "제안",
    negotiation: "협상",
    won: "계약 완료",
    onHold: "보류",
  },
  /** words in the model's stage answer that mean won / on hold */
  wonWords: ["계약", "성사", "won"],
  onHoldWords: ["보류", "연기", "실패", "lost"],
  /** "파이프라인 만들어줘" */
  askTopic: ["파이프\\s*라인", "pipeline"],
  askAct: ["만들", "생성", "정리", "업데이트", "갱신", "새로", "build", "create", "make", "update", "refresh"],
  /** a call record's path names it */
  callWords: ["통화", "call"],
  /** front-matter keys of a call record */
  fm: { started: "시작", company: "소속", contact: "상대" },
  /** company-form noise stripped before two company names are compared */
  companyForms: ["\\(주\\)", "㈜", "주식회사"],
  /** examples in the extraction prompt */
  examples: {
    relativeDates: ["다음 주 화요일", "10월 2일"],
    company: "대한물산",
    amount: "1억 800만 원",
  },
  props: {
    company: "거래처",
    stage: "단계",
    amount: "예상 금액",
    owner: "담당",
    contact: "고객 담당자",
    product: "제품",
    nextAction: "다음 액션",
    due: "기한",
    lastCall: "마지막 통화",
    calls: "통화 수",
    summary: "요약",
  },
  views: {
    board: "단계별 보드",
    table: "전체 표",
    calendar: "기한 달력",
    dashboard: "대시보드",
  },
  widgets: {
    companies: "거래처",
    amountSum: "예상 금액 합계",
    companiesByStage: "단계별 거래처",
    amountByStage: "단계별 금액",
    board: "보드",
  },
} as const;

/** The skill's example request, shown in the agent's skill list. */
export const SALES_PIPELINE_EXAMPLE = "통합 sales pipeline 만들어줘";

// ── treasury (src/lib/agent/treasury/match.ts) ─────────────────────────────

/** Korean money sentences the treasury matcher reads. */
export const TREASURY_KO = {
  /** words that ask for money to move (mentionsMoney) */
  moneyVerbs: ["보내", "송금", "결제", "지불", "출금", "투자", "예약", "구매"],
  /** "dollars" after a number */
  dollar: "달러",
  /** "to my wallet / account / me" */
  toSelf: ["내\\s?지갑", "내\\s?계좌", "나한테", "나에게"],
  /** a request ending: "…해 줘 / 주세요" */
  requestEndings: ["줘", "주세요", "줄래", "주라", "주겠니"],
  /** conditional, negated, scheduled or narrated */
  hedge: ["말고", "하지\\s?마", "취소", "나중에", "내일", "어제", "이미", "했어", "했다", "냈어", "보냈어", "하면", "이면"],
  /** balance / status */
  status: ["잔액", "잔고"],
  withdraw: "출금",
  invest: "투자",
  expense: ["보내", "송금", "결제", "지불", "내\\s?줘", "예약", "사\\s?줘", "구매", "계산"],
  /** "from the shared pot / account / wallet" — cut from the memo */
  source: "(?:공금|모임\\s?통장|통장|지갑)(?:에서|으로|로)?",
  /** particles cut from the end of each memo word */
  particles: "(?:에게|한테|으로|에|을|를)",
} as const;

// ── spend demo (src/lib/agent/spend.ts) ────────────────────────────────────

/** The rice-cake shop the agent buys songpyeon from. */
export const SONGPYEON_SHOP = "달빛떡집";

/** The room sentences that mean "buy the songpyeon" (lower-cased, spaces collapsed). */
export const BUY_SONGPYEON_COMMANDS = ["@agent buy songpyeon", "@agent 송편 주문해", "@agent 송편 주문해줘"];

// ── assistant room (src/lib/agent/assistant-room.ts) ───────────────────────

/** Name of each person's private room with their assistant agent. */
export const ASSISTANT_ROOM_NAME = "에이전트";

// ── prompt examples (src/lib/agent/pipeline.ts) ────────────────────────────

/** "grandma's songpyeon" said casually — not a person or a brand. */
export const CASUAL_DISH_EXAMPLE = "할머니표 송편";
