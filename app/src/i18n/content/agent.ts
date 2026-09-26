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

/** Not glued to a Korean word on the left / right — `\b` does not work on Hangul. */
const NB = "(?<![가-힣])";
const NA = "(?![가-힣])";
/** "a prompt", "an AI prompt", "an AI-ready prompt" */
const A_PROMPT = "(?:an?\\s+)?(?:ai[- ]?(?:ready[- ])?)?prompts?\\b";
/** "프롬프트로", "프롬프트 형태로", "프롬프트 형식으로" */
const KO_INTO = "프롬프트\\s*(?:형태|형식)?\\s*(?:으)?로";
/** what a page is called: the words a prompt's source may be named by */
const EN_SOURCE = "(?:page|doc(?:ument)?|database|db|teamspace|wiki)s?";
const KO_SOURCE = "(?:페이지|문서|데이터\\s*베이스|DB|팀\\s*스페이스|위키)";

/** The prompt skill (src/lib/agent/family-skills.ts → src/lib/prompt-export): turn a
 *  page into an AI-ready prompt, with notion2prompt's options said in the sentence.
 *  Regex fragments, matched case-insensitively. */
export const PROMPT_WORDS = {
  /**
   * The request itself. It must ask to TURN something into a prompt — chat ABOUT
   * prompts ("what prompt did you use?", "write me a prompt for a birthday card",
   * "make the prompt shorter") belongs to the model, so each shape below says what
   * else the sentence needs (input.ts promptAsk).
   */
  ask: {
    /** a request by itself: the tool's name, or "(AI) 프롬프트로 만들어줘" with the object left unsaid */
    always: [
      "\\bnotion2prompt\\b",
      "\\bpages?[- ]to[- ]prompts?\\b",
      `^\\s*(?:@\\S+\\s+)*(?:ai\\s*)?(?:좀\\s*)?${KO_INTO}\\s*(?:좀\\s*)?(?:만들|바꿔|바꾸|변환|뽑|생성|추출|해|줘)`,
      "^\\s*(?:@\\S+\\s+)*(?:ai\\s*)?프롬프트화",
    ],
    /** convert / export — something that exists is turned into a prompt */
    convert: [
      `\\b(?:convert|export|transform)\\w*\\b.{0,80}?\\b(?:in)?to\\s+${A_PROMPT}`,
      `\\bexport\\w*\\b.{0,80}?\\bas\\s+${A_PROMPT}`,
      `${KO_INTO}\\s*(?:좀\\s*)?(?:변환|내보내|추출)`,
    ],
    /** a prompt FROM / OUT OF something */
    from: [
      `\\b(?:make|create|generate|build|produce|extract|pull|get|give)\\b.{0,40}?\\bprompts?\\s+(?:from|out of|off|of)\\b`,
      `^\\s*(?:@\\S+\\s+)*${A_PROMPT}\\s+(?:from|out of|of)\\b`,
      "(?:에서|가지고|갖고|바탕으로|기반으로)\\s*(?:좀\\s*)?(?:ai\\s*)?프롬프트\\s*(?:를|을)?\\s*(?:좀\\s*|하나\\s*)?(?:만들|생성|뽑|추출)",
    ],
    /** into / as a prompt — only when what is turned is a page word, a link, or "this" */
    into: [
      `\\binto\\s+${A_PROMPT}`,
      `\\b(?:turn|make|change|put|save|copy|get)\\w*\\b.{0,80}?\\b(?:to|as)\\s+${A_PROMPT}`,
      // "make this a prompt", "turn the Chuseok hub a prompt" — not "make me a prompt"
      "\\b(?:make|turn)\\s+(?!(?:me|us|him|her|them)\\b)(?:(?!prompt)\\S+\\s+){1,8}(?:an?\\s+)(?:ai[- ]?(?:ready[- ])?)?prompt\\b",
      `${KO_INTO}\\s*(?:좀\\s*|다시\\s*|한\\s*번\\s*)?(?:만들|바꿔|바꾸|바꿀|옮겨|옮기|저장|정리|뽑|생성|추출|변환|내보내|해\\s*줘|해\\s*주|해\\s*줄|해\\s*봐|줘|주세요|부탁)`,
      // "…프롬프트로." — and, with the options said after it taken out, "…프롬프트로, 깊이 3"
      `${KO_INTO}\\s*[,，.!?~]*\\s*$`,
      "프롬프트화\\s*(?:좀\\s*)?(?:해|시켜|하자|부탁)",
      "프롬프트화\\s*[,，.!?~]*\\s*$",
    ],
    /** a making verb + prompt — a maybe by itself ("make me a prompt for a card" is one to WRITE) */
    make: [
      "\\b(?:make|create|generate|build|produce|extract|get|give)\\s+(?:me\\s+|us\\s+)?(?:an?\\s+|the\\s+)?(?:ai[- ]?(?:ready[- ])?)?prompts?\\b",
      "프롬프트\\s*(?:를|을)?\\s*(?:좀\\s*|하나\\s*)?(?:만들|생성|뽑|추출)",
    ],
    /**
     * …made OF a page: the page word right at the prompt word — "a prompt for the Chuseok
     * page", "추석 페이지 프롬프트 만들어줘", "이 페이지로 프롬프트 만들어줘". A page word
     * anywhere else is not the source ("show me the page I should use to make a prompt",
     * "프롬프트 만들 때 참고할 페이지 알려줘", "a prompt for midjourney from the photos on this page").
     */
    madeOf: [
      // up to three title words, none of them a preposition ("the photos ON this page" is not a title)
      `\\bprompts?\\s+(?:for|of|from|on|with|using|based on)\\s+(?:(?:the|this|that|my|our|your)\\s+)?(?:(?!(?:prompt|on|in|at|from|with|of|for|about)\\b)\\S+\\s+){0,3}?${EN_SOURCE}\\b`,
      `${KO_SOURCE}\\s*(?:를|을|로|으로|의|에서|가지고|갖고)?\\s*(?:좀\\s*)?(?:ai\\s*)?프롬프트\\s*(?:를|을)?\\s*(?:좀\\s*|하나\\s*)?(?:만들|생성|뽑|추출)`,
    ],
    /**
     * A polite or indirect way into a request, taken off before the sentence is read —
     * "is it possible to …", "do you mind …", "when you get a chance, …", "why don't you …"
     * start like questions but ask for the thing itself.
     */
    polite: [
      "is it possible (?:for you )?to",
      "is there (?:a|any) way (?:for you )?to",
      "(?:do|would) you (?:think|suppose|reckon) you (?:could|can|would|might)",
      "(?:are|were) you able to",
      "(?:do|would) you mind(?: if you)?",
      "(?:do|would) you (?:want|like) to",
      "is it (?:ok(?:ay)?|alright|all right) (?:if you|to)",
      "when you (?:get|have) (?:a|the) (?:chance|minute|moment|sec(?:ond)?)",
      "why don'?t you",
      "i (?:was )?wonder(?:ing)? if you (?:could|can|would)",
    ],
    /** a question about a prompt, never a request */
    question: [
      "^\\s*(?:@\\S+\\s+)*(?:(?:what|which|why|who|when|where)\\b|how\\b(?!\\s+about)|(?:did|do|does|is|was|were|are|have|has|had)\\s+(?:you|we|i|they|he|she|it|there|this|that)\\b)",
      "(?:쓴|썼|사용한|사용했|쓰던|넣은|넣었)[가-힣]*\\s*(?:ai\\s*)?프롬프트",
      "프롬프트화?\\s*(?:가|는|은|이)?\\s*(?:뭐|뭘|무엇|무슨|어떤|어땠|어디|어때)",
      "(?:어떤|무슨|어느)\\s*(?:ai\\s*)?프롬프트",
    ],
  },
  /** the word itself — a question with it is about a prompt ("what prompt did you use?") */
  promptWord: ["\\bprompts?\\b", "프롬프트"],
  /** what a prompt is made from: a page word or a link / id */
  source: [
    "\\bpages?\\b", "\\bdatabases?\\b", "\\bdbs?\\b", "\\bdoc(?:ument)?s?\\b", "\\bteamspaces?\\b", "\\bwiki\\b",
    "/p/[A-Za-z0-9_-]{8,}", "notion\\.(?:so|site)/", "\\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\\b",
    "페이지", "문서", "데이터\\s*베이스", "팀\\s*스페이스", "위키",
  ],
  /** "depth 2", "깊이 2", "단계 2" */
  depth: ["depth", "깊이", "단계"],
  /** between the keyword and its number: "depth of 2", "깊이는 2", "깊이 최대 3" */
  depthJoin: ["[:=]", "of", "to", "is", "은", "는", "을", "를", "이", "가", "최대", "up to", "max(?:imum)?", "at most"],
  /** before the keyword: "max depth 3", "최대 깊이 3" */
  depthKeyLead: ["max(?:imum)?", "최대"],
  /** a number of levels: "2단계", "3 levels" */
  depthUnit: ["단계", "levels?"],
  /** said before a number of levels, which makes it a depth: "최대 3단계", "up to 3 levels",
   *  "going 3 levels deep", "하위 페이지 2단계까지" */
  depthLead: ["최대", "up to", "max(?:imum)?", "at most", "going", "go", "하위\\s*페이지(?:를|는|도)?", "(?:child|sub)[- ]?pages?"],
  /** said right after it, which makes it a depth too: "3단계 깊이로", "3 levels deep", "2단계까지"
   *  — a bare "1단계" before a word is a title ("1단계 준비물") */
  depthTail: ["\\s*깊이(?:까지|로|으로)?", "\\s*deep", "\\s*down", "까지", "으로", "로"],
  /** "limit 200", "최대 200", "limit to 200" */
  limit: ["limit", "최대", "한도", "max(?:imum)? items", "at most"],
  limitJoin: ["[:=]", "of", "to", "is", "은", "는", "을", "를", "이", "가"],
  /** "maximum 100 items", "up to 200 blocks" — a bare "max 3" is not a limit */
  limitLead: ["max(?:imum)?", "up to"],
  limitUnit: ["items?", "blocks?"],
  /** after a number: "2로", "200개까지", "200 items" */
  numberAfter: ["개(?:까지|로|으로)?", "items?", "blocks?", "으로", "로", "까지"],
  childPagesOn: [
    "하위\\s*페이지\\s*(?:까지|포함|도)",
    "with (?:its |the )?(?:child|sub)[- ]?pages",
    "including (?:its |the )?(?:child|sub)[- ]?pages",
    "include (?:its |the )?(?:child|sub)[- ]?pages",
  ],
  childPagesOff: [
    "하위\\s*페이지\\s*(?:없이|빼고|제외)",
    `${NB}이\\s*페이지만`,
    "without (?:its |the )?(?:child|sub)[- ]?pages",
    "no (?:child|sub)[- ]?pages",
    "(?:this|the) page only",
    "only (?:this|the) page",
  ],
  /** each child page its own file (tested before `merged`: "one file per page" is this) */
  separate: [
    "따로",
    "각각",
    "페이지\\s*마다\\s*(?:파일\\s*(?:하나|한\\s*개)씩?|따로)?",
    "페이지\\s*별로?",
    "separate(?:ly)?",
    "(?:one )?file per (?:child )?page",
    "(?:one|a) file (?:for )?each",
    "each (?:child )?page (?:in )?its own file",
  ],
  /** child pages merged into one file */
  merged: ["합쳐", "하나로", "한\\s*파일(?:로|으로)?(?!\\s*씩)", "\\bmerged?\\b", "single file", "\\bone file\\b(?!\\s*(?:per|for each|each))", "\\binline\\b"],
  alwaysDatabases: ["데이터베이스\\s*(?:항상|모두|전부)", "DB\\s*(?:항상|모두|전부)", "always (?:fetch|include) (?:the )?databases", "all (?:the )?databases"],
  propertiesOn: ["속성\\s*(?:포함|까지|도)", "with (?:the )?properties", "include (?:the )?properties"],
  propertiesOff: ["속성\\s*(?:없이|빼고|제외)", "without (?:the )?properties", "no properties"],
  templateXml: ["\\bxml\\b(?:으로|로)?", "\\bclaude\\b(?:으로|로)?"],
  templateMarkdown: ["마크다운(?:으로|로)?", "markdown\\b(?:으로|로)?"],
  templateDefault: ["기본\\s*템플릿(?:으로|로)?", "default template", "\\bdefault\\b"],
  /** notion2prompt's own file names and flat tree (render.ts: where it is upstream's bytes) */
  layoutUpstream: ["notion2prompt", "노션\\s*형식", "notion (?:layout|format)"],
  /** `지시: "…"`, `instruction: "…"` */
  instruction: ["지시\\s*사항", "지시", "요청\\s*사항", "instructions?"],
  /** the page open where it was asked: "this page", "이 페이지", "이 문서", "지금 보고 있는
   *  페이지", "이 내용", "the page I'm looking at", "what I'm looking at" */
  thisPage: [
    `${NB}(?:이|현재|지금)\\s*(?:보는\\s*|보고\\s*있는\\s*|열린\\s*|열려\\s*있는\\s*|띄운\\s*|띄워\\s*(?:둔|놓은)\\s*)?(?:페이지|문서|데이터\\s*베이스|DB|내용|글|노트|메모|표|화면)(?:를|을|로|으로|의|에서|에|는|은|가|이|만|도)?${NA}`,
    `${NB}(?:(?:내가|제가)\\s*)?(?:지금\\s*)?(?:열려\\s*있는|보고\\s*있는|보는\\s*중인|열어\\s*(?:둔|놓은)|띄워\\s*(?:둔|놓은))\\s*(?:페이지|문서|거|것|걸|내용|글|화면)(?:를|을|로|으로|의)?${NA}`,
    "\\b(?:this|current|open|opened)\\s+(?:whole\\s+|entire\\s+)?(?:page|doc(?:ument)?|database|db|one|note|table|thing)\\b",
    "\\b(?:the\\s+)?(?:page|doc(?:ument)?|one|thing)\\s+(?:that\\s+)?(?:i'?m|i am|i have)\\s+(?:on|in|open|looking at|reading|viewing|seeing)\\b",
    "\\bwhat (?:i'?m|i am) (?:looking at|reading|viewing|seeing)\\b",
  ],
  /** "this", "it", "here", "이거", "여기" — the open page when nothing else is named */
  deictic: ["\\bthis\\b", "\\bit\\b", "\\bhere\\b", `${NB}(?:이거|이것|이걸|이건|여기|얘)[가-힣]*`],
  /** words taken out before the rest of the sentence is matched against page titles */
  noise: [
    "프롬프트화?\\s*(?:(?:형태|형식)\\s*)?(?:으로|로|를|을)?",
    `${NB}(?:만들|바꾸|바꿔|바꿀|변환|뽑|추출|생성|내보내|옮겨)[가-힣]*`,
    `${NB}(?:줘요?|주세요|줄래요?|주라|주겠니|주실래요?|주시겠어요?|해|해줘요?|해\\s*줘요?|해요|할래요?|좀|요|가지고|갖고|다시|한\\s*번|하나|부탁해요?|부탁드려요|줄\\s*수\\s*있[가-힣]*|주실\\s*수\\s*있[가-힣]*)${NA}`,
    "페이지(?:를|을|로|으로|의|에서|에|는|은|가|이|도|만)?", "문서(?:를|을|로|의|에서)?", "데이터\\s*베이스(?:를|을|로|의)?",
    "템플릿(?:으로|로)?", "팀\\s*스페이스(?:를|을|로|의)?",
    "\\bai(?:[- ]ready)?\\b", "\\bprompts?\\b", "\\bpages?\\b", "\\bdatabases?\\b", "\\bdocs?\\b", "\\bdocuments?\\b", "\\btemplate\\b", "\\bteamspace\\b",
    "\\b(?:make|turn|convert|create|generate|export|build|transform|change|put|save|copy|get|give|produce|extract|pull)(?:s|ed|ing)?\\b", "\\bmade\\b",
    "\\binto\\b", "\\bfrom\\b", "\\bbased on\\b", "\\busing\\b", "\\bfor\\b", "\\bof\\b", "\\bto\\b", "\\bwith\\b", "\\bout\\b", "\\boff\\b", "\\bas\\b",
    "\\bthe\\b", "\\ban?\\b", "\\bplease\\b", "\\bme\\b", "\\bus\\b", "\\bmy\\b", "\\bour\\b", "\\bi\\b", "\\byou\\b",
    "\\bcan\\b", "\\bcould\\b", "\\bwould\\b", "\\bwill\\b", "\\bwant\\b", "\\bneed\\b", "\\bjust\\b", "\\bthat\\b", "\\bnow\\b",
    "\\bcalled\\b", "\\bnamed\\b", "\\bthanks?\\b", "\\bhey\\b", "\\bkindly\\b",
  ],
  /** answering the skill's "which one?" — with a number, an ordinal, a link, or yes (one candidate) */
  choice: {
    numberBefore: ["no\\.?", "number", "#", "option"],
    numberAfter: ["번째", "번", "st", "nd", "rd", "th"],
    /** a number said as a word — "number three", "three", "셋" (index 0 first; "one" only
     *  after "number", as "the album one" is not a number) */
    cardinals: [
      ["(?<=(?:number|no\\.?|option|#)\\s*)one"],
      ["two", "둘"],
      ["three", "셋"],
      ["four", "넷"],
      ["five", "다섯"],
      ["six", "여섯"],
      ["seven", "일곱"],
      ["eight", "여덟"],
    ],
    /** "the last one", "마지막 거" */
    last: ["last", "마지막", "맨\\s*(?:끝|마지막|아래)", "끝"],
    /** "the first one", "첫 번째" — index 0 first */
    ordinals: [
      ["first", "첫\\s*번째", "첫째"],
      ["second", "두\\s*번째", "둘째"],
      ["third", "세\\s*번째", "셋째"],
      ["fourth", "네\\s*번째", "넷째"],
      ["fifth", "다섯\\s*번째", "다섯째"],
      ["sixth", "여섯\\s*번째", "여섯째"],
      ["seventh", "일곱\\s*번째", "일곱째"],
      ["eighth", "여덟\\s*번째", "여덟째"],
    ],
    /** "yes" to "did you mean …?", in the words people use (lower case, apostrophes dropped) */
    yes: [
      "yes", "yeah", "yea", "yep", "yup", "ya", "sure(?: thing)?", "right", "correct", "exactly", "absolutely", "definitely",
      "of course", "ok(?:ay)?", "k", "please(?: do)?", "do it", "go ahead", "go for it", "(?:thats|that is) (?:it|right|correct|the one)", "that one", "the one",
      "sounds good", "perfect", "great",
      "응+", "웅+", "엉", "어+", "ㅇ+", "ㅇㅋ+", "ㄱㄱ+", "네+", "넵+", "넹+", "예+", "옙", "오케이", "고고",
      "맞아(?:요)?", "맞습니다", "맞음", "맞네(?:요)?", "그래(?:요)?", "그거(?:요)?", "그걸로(?:요)?", "그거로(?:요)?", "그것(?:으로|요)?",
      "좋아(?:요)?", "좋습니다", "해(?:\\s*줘(?:요)?|\\s*주세요)?", "만들어\\s*(?:줘(?:요)?|주세요)", "부탁(?:해(?:요)?|드려요|합니다)?",
    ],
    /** said around the answer: "the second one", "2번으로 해줘", "추석 앨범이요", "no, the first" */
    filler: [
      "\\bone\\b", "\\bi mean\\b", "\\bgo with\\b", "\\bpick\\b", "\\bplease\\b", "\\bthat\\b",
      "\\bno\\b(?!\\.?\\s*\\d)", "\\bnope\\b", "\\bactually\\b", "\\bsorry\\b",
      `${NB}(?:으로|로|요|이요|걸로|거|것|꺼|할게요?|해줘요?|해\\s*줘요?|해\\s*주세요|해|부탁해요?|아니(?:요|야)?|아뇨|아냐)${NA}`,
    ],
    /**
     * An answer said as a pick — "the album one", "make it from the Chuseok album", "앨범
     * 걸로 만들어줘", "추석 앨범으로 해줘" — is the prompt skill's even with another skill's
     * words in it; without one, "make a Jeju album" right after the question is the album's.
     */
    pickMarkers: [
      "\\bone\\b", "\\bit\\b", "\\bthat\\b", "\\bgo with\\b", "\\bpick\\b", "\\buse\\b", "\\bfrom\\b", "\\bi mean\\b",
      "(?:걸로|거로|것으로|꺼로|거요|걸요|것요)",
      "[가-힣A-Za-z0-9](?:으로|로)\\s*(?:좀\\s*)?(?:만들|해|할|하|골라|선택|부탁|가자|갈게|줘)",
    ],
    /** glued to the end of an answer: "2번으로", "첫 번째요" */
    trailing: ["으로", "로", "이요", "요", "\\s*(?:거|것|꺼)(?:요|로)?"],
  },
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
