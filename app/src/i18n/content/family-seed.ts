/**
 * Korean content that scripts/seed-family-demo.mts writes into the family demo:
 * workspace and teamspace names, page titles and text, the family's aindrive
 * file paths, CSV-backed databases, chat messages and ledgers. It is DATA the
 * demo shows as-is, not UI text, so it lives here and not in the script.
 */
import { FAMILY_WORKSPACE_NAME, LEDGER } from "./family-demo";

/** a file in someone's drive, relative to the drive root */
type Rel = string;

export const SEED = {
  workspace: {
    name: "김씨네 가족",
    description: "할머니·엄마·아빠·서연의 aindrive를 모은 우리 가족 공간",
  },
  teamspace: {
    name: FAMILY_WORKSPACE_NAME,
    description: "2026 추석 — 일정, 역할, 차례상, 성묘, 할머니 약, 앨범",
  },
  /** grandma's birthday: the private teamspace, its page and its chat room */
  secret: {
    name: "할머니 생신 준비",
    description: "12월 5일 할머니 생신 — 할머니께는 비밀",
  },
  /** folders seoyeon shares instead of her whole phone */
  seoyeonShares: {
    album: { name: "서연 앨범", root: "앨범" },
    birthday: { name: "서연 폰 · 생신 준비", root: "생신준비" },
  },
  /** the line under a section that came from someone's drive */
  from: (name: string, drive: string) => `— ${name}의 aindrive 「${drive}」에서`,
  /** view names of a database made from a CSV */
  views: { board: "보드", calendar: "달력", table: "표" },

  csv: {
    calendar: { file: "가족일정/2026_가족달력.csv", title: "가족 일정", dateCol: "날짜", selectCols: ["누구"] },
    roles: {
      file: "추석/역할분담.csv",
      title: "추석 역할 분담",
      selectCols: ["담당", "상태"],
      boardCol: "상태",
      optionOrder: { 상태: ["할 일", "진행 중", "완료"] },
    },
    gifts: { file: "추석/선물_용돈.csv", title: "선물 · 용돈", selectCols: ["누가 준비", "상태"], numberCols: ["금액"] },
    meds: { file: "건강/복약일정.csv", title: "할머니 복약 일정", selectCols: ["용도"] },
  },

  dirs: {
    oldPhotos: "옛날사진",
    holidayPhotos: "사진",
    health: "건강",
    /** blood pressure / blood sugar files in grandma's health folder */
    vitals: /혈압|혈당/,
    seoyeonJeju: "앨범/2026-10_제주",
  },

  pages: {
    schedule: {
      title: "추석 일정 · 귀성길",
      callout: "9/24(목) 아침 7시 수원 출발 → 10시 강경 할머니 댁. 작은아버지네는 KTX로 18:41 논산역, 고모는 9/25 오후 합류.",
      days: "사흘 일정 — 엄마",
      daysFile: "추석/추석_일정.md" as Rel,
      road: "귀성 · 귀경 — 아빠",
      roadFiles: ["귀성/귀성길_계획.md", "자동차/정비기록.csv"] as Rel[],
      calendar: "가족 달력",
    },
    roles: {
      title: "역할 분담",
      intro: "엄마가 aindrive에 올린 역할 분담표예요. 상태를 바꾸면 여기서 모두에게 보입니다.",
    },
    table: {
      title: "차례상과 음식",
      callout: "우리 집은 할머니 뜻에 따라 밥·국 대신 송편과 토란국을 올려요. 차례는 9/25(금) 오전 8시.",
      momHeading: "차례상 — 엄마",
      momFiles: ["추석/차례상_차림표.md", "추석/차례상_배치도.png"] as Rel[],
      orderHeading: "우리 집 차례 순서 — 할머니",
      orderFile: "추석/우리집_차례_순서.md" as Rel,
      recipesHeading: "할머니 레시피",
      recipes: ["레시피/송편.md", "레시피/토란국.md", "레시피/녹두전.md", "레시피/식혜.md"] as Rel[],
      shoppingHeading: "장보기",
      shoppingFile: "추석/추석_장보기.xlsx" as Rel,
    },
    grave: {
      title: "벌초 · 성묘",
      callout: "벌초는 9/12에 아빠·작은아버지가 마쳤어요. 성묘는 추석 당일 10:30, 할머니는 댁에서 기다리세요.",
      planFile: "벌초성묘/벌초_성묘_계획.md" as Rel,
      wayHeading: "선산 가는 길 — 할머니",
      wayFile: "추석/선산_가는길.md" as Rel,
    },
    health: {
      title: "할머니 건강 · 연휴 약",
      callout: "명절엔 식사 시간이 들쭉날쭉해요. 추석 당일 아침 약은 차례 전 7시에 서연이가 챙겨요.",
      holidayFile: "건강/추석연휴_약챙기기.md" as Rel,
      medsHeading: "복약 일정",
      vitalsHeading: "혈압·혈당 · 병원 예약",
      clinicFile: "건강/병원예약.md" as Rel,
    },
    gifts: { title: "선물 · 용돈" },
    album: {
      title: "추석 앨범",
      intro: "할머니의 옛날 사진과 이야기, 엄마의 명절 사진 — 두 사람의 aindrive에서 모았어요.",
      oldHeading: "할머니의 옛날 추석",
      storyFile: "옛날사진/사진_이야기.md" as Rel,
      ourHeading: "우리 집 명절",
    },
    evening: {
      title: "추석 밤 · 가족회의",
      yutHeading: "윷놀이 — 아빠",
      yutFile: "추석/윷놀이_대진표.md" as Rel,
      moonHeading: "보름달 소원 — 엄마",
      moonFile: "추석/보름달_소원.md" as Rel,
      meetingHeading: "가족회의 (9/27 일)",
      meetingFile: "메모/가족회의_안건.docx" as Rel,
    },
    cooking: {
      title: "할머니 녹두전",
      callout: "추석 끝나고 수원 집에서 할머니 녹두전 도전! 레시피·손글씨·반죽 영상은 할머니 폰에서, 해 본 후기는 엄마 폰에서 왔어요.",
      recipeHeading: "할머니 레시피",
      grandmaFiles: ["레시피/녹두전.md", "레시피/손글씨_녹두전.jpg", "레시피/녹두전_반죽농도.mp4", "레시피/할머니_계량법.md"] as Rel[],
      reviewHeading: "엄마가 해 본 후기",
      reviewFile: "요리/우리집_녹두전_후기.md" as Rel,
      hint: "가족방에서 「@agent 녹두전 4인분 장보기 목록 만들어줘」 — 할머니 레시피와 계량법으로 장보기 체크리스트를 만들어요.",
    },
    trip: {
      title: "제주 가족여행",
      callout: "10월 3일~6일, 할머니는 무릎 때문에 이번엔 집에서 기다리셨어요. 사진은 아빠·엄마·서연의 폰에 흩어져 있어요.",
      planHeading: "계획과 경비 — 아빠",
      files: ["여행/제주_가족여행_계획.md", "여행/제주_여행경비.xlsx", "여행/제주_여행_브리핑.pptx"] as Rel[],
      hint: "가족방에서 「@agent 제주 앨범 정리해줘」 — 세 폰의 사진을 찍은 날짜·위치로 모아, 같은 사진은 한 번만 넣어 앨범을 만들어요.",
    },
    seoyeonAlbum: {
      title: "서연이 앨범",
      albumFile: "앨범/2026_서연_앨범.md" as Rel,
      jejuHeading: "제주에서",
      giftHeading: "할머니께 드리는 선물 🎁",
      callout:
        "용돈으로 열면 그 돈이 서연이 지갑으로 가요 (x402 결제). 영상 원본은 서연이 폰에만 있고, 가족 누구에게도 공유되지 않아요 — 이 선물로만 열려요. " +
        "가족방에서 「@agent 서연이 용돈 주고 영상 보자」라고 해도 돼요.",
    },
    birthday: {
      callout: "할머니께는 비밀! 이 팀스페이스는 엄마·아빠·서연만 봐요. 서연 폰의 녹음은 여기에만 공유돼 있어요.",
      recordingHeading: "10월 11일 준비 회의 녹음 — 서연 폰",
      recordingFiles: ["생신준비/2026-10-11_할머니생신_준비회의.m4a", "생신준비/2026-10-11_할머니생신_준비회의.txt"] as Rel[],
      hintsHeading: "선물 힌트",
      diaryNote: "할머니 일기(할머니 폰, 가족에게 공유된 것)에 요즘 불편하신 것들이 적혀 있어요.",
      diaryFile: "메모/할머니_일기.md" as Rel,
      hint: "생신 준비방에서 「@agent 할머니 생신인 거 알지? 선물 뭐 할까?」, 「@agent 녹음에서 할 일 뽑아줘」",
    },
    hub: {
      title: "2026 우리 가족 추석",
      callout:
        "추석 연휴는 9월 24일(목)~26일(토), 추석 당일은 9월 25일. 올해도 강경 할머니 댁에 모여요. " +
        "할머니·엄마·아빠가 각자 aindrive에서 고른 폴더가 이 공간에 공유돼 있어요 — 파일은 각자의 기기에 그대로 있고, 여기서 함께 봅니다.",
      prepare: "준비",
      care: "챙길 것",
      memories: "추억",
      after: "추석 다음 이야기",
      letterHeading: "할머니가 손주에게",
      letterFile: "편지/손주에게.txt" as Rel,
    },
  },

  /** seoyeon's video for grandma, opened only through an x402 gift */
  gift: {
    // 아기 세배 영상, "새해 복 많이 받으세요~ 28개월 아기 세배" — 강남연세언어치료연구소
    // (youtu.be/TvWPzv-nZl8, CC BY), 앞 32초 — 페이지에 출처 표시 (`credit`)
    video: "특별영상/할머니께_세배.mp4" as Rel,
    title: "할머니께 드리는 세배",
    preview: "앨범/세배_미리보기.jpg" as Rel,
    credit: "영상: “새해 복 많이 받으세요~ 28개월 아기 세배” — 강남연세언어치료연구소 (youtu.be/TvWPzv-nZl8), CC BY · 편집함",
  },

  /** the family chat room and its opening messages */
  familyRoom: {
    name: FAMILY_WORKSPACE_NAME,
    talk: [
      ["mom", "내일 추석이에요! 할머니 댁에 몇 시까지 가면 될까요?"],
      ["grandma", "점심 전에만 오너라. 송편 소는 깨로 넉넉히 해 두마."],
      ["dad", "저는 산적 맡을게요. 작은아버지네 논산역 픽업도 제가 갑니다 😄"],
      ["mom", "할머니 혈압약은 아침 식후 한 번이죠? 복약 일정 확인해 둘게요."],
    ] as [string, string][],
  },
  /** the birthday room (everyone but grandma) and its opening messages */
  secretRoom: {
    talk: [
      ["seoyeon", "어제 회의 녹음 생신준비 폴더에 올렸어요! 할머니 팀스페이스엔 안 보여요 🤫"],
      ["mom", "고마워 서연아. 할 일 정리해서 나눠 보자."],
    ] as [string, string][],
  },

  /** pocket-money ledgers: grandma and mom start with money to give */
  ledgers: {
    head: LEDGER.head,
    books: [
      ["grandma", LEDGER.out, ["2026-09-01,용돈 지갑 채움 (연금),—,300000,300000,—"]],
      ["mom", LEDGER.out, ["2026-09-01,용돈 지갑 채움,—,200000,200000,—"]],
      ["seoyeon", LEDGER.in, []],
    ] as [string, string, string[]][],
  },
};
