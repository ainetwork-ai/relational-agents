/**
 * The English family demo's seed (DEMO_CONTENT_LANG=en): what
 * scripts/seed-family-demo.mts writes — workspace and teamspace names, page
 * titles and text, the family's aindrive file paths, CSV-backed databases,
 * chat messages and ledgers. Same shape as the Korean ./family-seed; pick one
 * through ./demo-lang.
 *
 * Every path here is a file the English generators make
 * (~/.ainmem-demo-en/source/tools/gen_en.py, media_en.py).
 */
import { FAMILY_WORKSPACE_NAME, LEDGER } from "./family-demo.en";

/** a file in someone's drive, relative to the drive root */
type Rel = string;

export const SEED = {
  workspace: {
    name: "The Kim Family",
    description: "Grandma's, Mom's, Dad's and Seoyeon's aindrives, gathered into one family space",
  },
  teamspace: {
    name: FAMILY_WORKSPACE_NAME,
    description: "Chuseok 2026 — schedule, roles, the ancestral table, the graves, Grandma's medicines, the album",
  },
  /** grandma's birthday: the private teamspace, its page and its chat room */
  secret: {
    name: "Grandma's Birthday Plans",
    description: "Grandma's birthday on 5 December — a secret from Grandma",
  },
  /** folders seoyeon shares instead of her whole phone */
  seoyeonShares: {
    album: { name: "Seoyeon's Album", root: "album" },
    birthday: { name: "Seoyeon's Phone · Birthday Plans", root: "birthday_plans" },
  },
  /** the line under a section that came from someone's drive */
  from: (name: string, drive: string) => `— from ${name}'s aindrive “${drive}”`,
  /** view names of a database made from a CSV */
  views: { board: "Board", calendar: "Calendar", table: "Table" },

  csv: {
    calendar: { file: "family_calendar/2026_family_calendar.csv", title: "Family calendar", dateCol: "Date", selectCols: ["Who"] },
    roles: {
      file: "chuseok/roles.csv",
      title: "Chuseok roles",
      selectCols: ["Who", "Status"],
      boardCol: "Status",
      optionOrder: { Status: ["To do", "Doing", "Done"] } as Record<string, string[]>,
    },
    gifts: { file: "chuseok/gifts_and_pocket_money.csv", title: "Gifts · pocket money", selectCols: ["Prepared by", "Status"], numberCols: ["Amount"] },
    meds: { file: "health/medication_schedule.csv", title: "Grandma's medication schedule", selectCols: ["For"] },
  },

  dirs: {
    oldPhotos: "old_photos",
    holidayPhotos: "photos",
    health: "health",
    /** blood pressure / blood sugar files in grandma's health folder */
    vitals: /blood_pressure|blood_sugar/,
    seoyeonJeju: "album/2026-10_jeju",
  },

  pages: {
    schedule: {
      title: "Chuseok schedule · the drive down",
      callout: "Thu 9/24: leave Suwon at 7 am → Grandma's in Ganggyeong by 10. Uncle's family arrives at Nonsan Station by KTX at 18:41; Aunt joins on the afternoon of 9/25.",
      days: "The three days — Mom",
      daysFile: "chuseok/chuseok_schedule.md" as Rel,
      road: "There and back — Dad",
      roadFiles: ["holiday_travel/holiday_drive_plan.md", "car/maintenance_log.csv"] as Rel[],
      calendar: "Family calendar",
    },
    roles: {
      title: "Who does what",
      intro: "Mom's roles sheet from her aindrive. Change a status and everyone sees it here.",
    },
    table: {
      title: "The ancestral table and the food",
      callout: "Following Grandma's wishes, we set songpyeon and taro soup in place of rice and soup. The rite is Fri 9/25 at 8 am.",
      momHeading: "The table — Mom",
      momFiles: ["chuseok/table_setting.md", "chuseok/table_layout.png"] as Rel[],
      orderHeading: "How our family holds the rite — Grandma",
      orderFile: "chuseok/our_family_charye_order.md" as Rel,
      recipesHeading: "Grandma's recipes",
      recipes: ["recipes/songpyeon.md", "recipes/taro_soup.md", "recipes/mung_bean_pancake.md", "recipes/sikhye.md"] as Rel[],
      shoppingHeading: "Shopping",
      shoppingFile: "chuseok/chuseok_shopping.xlsx" as Rel,
    },
    grave: {
      title: "Tidying and visiting the graves",
      callout: "Dad and Uncle tidied the graves on 9/12. The visit is at 10:30 on Chuseok day; Grandma waits at home.",
      planFile: "ancestral_graves/beolcho_seongmyo_plan.md" as Rel,
      wayHeading: "The way to the family graves — Grandma",
      wayFile: "chuseok/way_to_the_family_graves.md" as Rel,
    },
    health: {
      title: "Grandma's health · holiday medicines",
      callout: "Mealtimes are all over the place at the holiday. On Chuseok morning Seoyeon makes sure Grandma takes her medicine at 7, before the rite.",
      holidayFile: "health/chuseok_holiday_meds.md" as Rel,
      medsHeading: "Medication schedule",
      vitalsHeading: "Blood pressure · blood sugar · clinic appointments",
      clinicFile: "health/clinic_appointments.md" as Rel,
    },
    gifts: { title: "Gifts · pocket money" },
    album: {
      title: "Chuseok album",
      intro: "Grandma's old photos and their stories, Mom's holiday photos — gathered from both their aindrives.",
      oldHeading: "Grandma's Chuseoks long ago",
      storyFile: "old_photos/photo_stories.md" as Rel,
      ourHeading: "Our family's holiday",
    },
    evening: {
      title: "Chuseok night · family meeting",
      yutHeading: "Yut nori — Dad",
      yutFile: "chuseok/yut_nori_bracket.md" as Rel,
      moonHeading: "Full-moon wishes — Mom",
      moonFile: "chuseok/full_moon_wishes.md" as Rel,
      meetingHeading: "Family meeting (Sun 9/27)",
      meetingFile: "notes/family_meeting_agenda.docx" as Rel,
    },
    cooking: {
      title: "Grandma's mung bean pancakes",
      callout: "After Chuseok, trying Grandma's mung bean pancakes at home in Suwon! The recipe, the handwritten card and the batter video come from Grandma's phone; how it went comes from Mom's.",
      recipeHeading: "Grandma's recipe",
      grandmaFiles: [
        "recipes/mung_bean_pancake.md",
        "recipes/mung_bean_pancake_handwritten.jpg",
        "recipes/mung_bean_pancake_batter.mp4",
        "recipes/grandmas_measures.md",
      ] as Rel[],
      reviewHeading: "How Mom's try went",
      reviewFile: "cooking/our_mung_bean_pancake_review.md" as Rel,
      hint: "In the family chat: “@agent make a shopping list for mung bean pancakes for 4” — a shopping checklist from Grandma's recipe and measures.",
    },
    trip: {
      title: "Jeju family trip",
      callout: "3–6 October. Grandma stayed home this time because of her knees. The photos are scattered across Dad's, Mom's and Seoyeon's phones.",
      planHeading: "Plan and budget — Dad",
      files: ["trip/jeju_family_trip_plan.md", "trip/jeju_trip_budget.xlsx", "trip/jeju_trip_briefing.pptx"] as Rel[],
      hint: "In the family chat: “@agent make an album of the Jeju photos” — the photos from three phones, gathered by when and where they were taken, each photo once.",
    },
    seoyeonAlbum: {
      title: "Seoyeon's album",
      albumFile: "album/2026_seoyeon_album.md" as Rel,
      jejuHeading: "From Jeju",
      giftHeading: "A present for Grandma 🎁",
      callout:
        "Open it with pocket money and the money goes to Seoyeon's wallet (an x402 payment). The video itself is only on Seoyeon's phone and isn't shared with anyone — this gift is the only way it opens. " +
        "You can also say “@agent give Seoyeon her pocket money and let's watch the video” in the family chat.",
    },
    birthday: {
      callout: "A secret from Grandma! Only Mom, Dad and Seoyeon see this teamspace. The recording on Seoyeon's phone is shared here and nowhere else.",
      recordingHeading: "The 11 October planning meeting, recorded — Seoyeon's phone",
      recordingFiles: [
        "birthday_plans/2026-10-11_grandma_birthday_planning.m4a",
        "birthday_plans/2026-10-11_grandma_birthday_planning.txt",
      ] as Rel[],
      hintsHeading: "Present ideas",
      diaryNote: "Grandma's diary (on her phone, shared with the family) mentions what's been bothering her lately.",
      diaryFile: "notes/grandmas_diary.md" as Rel,
      hint: "In the birthday chat: “@agent you know it's Grandma's birthday, right? What should we get her?”, “@agent pull the to-dos out of the recording”",
    },
    hub: {
      title: "Our Family's Chuseok 2026",
      callout:
        "The Chuseok holiday runs Thu 24 – Sat 26 September; Chuseok itself is the 25th. We're gathering at Grandma's in Ganggyeong again this year. " +
        "Grandma, Mom and Dad each picked folders from their own aindrive to share into this space — the files stay on each person's device, and we look at them together here.",
      prepare: "Getting ready",
      care: "Looking after",
      memories: "Memories",
      after: "After Chuseok",
      letterHeading: "Grandma to her grandchildren",
      letterFile: "letters/to_my_grandchildren.txt" as Rel,
    },
  },

  /** seoyeon's video for grandma, opened only through an x402 gift */
  gift: {
    // a toddler's sebae, "새해 복 많이 받으세요~ 28개월 아기 세배" by 강남연세언어치료연구소
    // (youtu.be/TvWPzv-nZl8, CC BY), trimmed — credited on the page (`credit`)
    video: "special_video/sebae_for_grandma.mp4" as Rel,
    title: "A New Year's bow for Grandma",
    preview: "album/sebae_preview.jpg" as Rel,
    credit: "Video: “새해 복 많이 받으세요~ 28개월 아기 세배” by 강남연세언어치료연구소 (youtu.be/TvWPzv-nZl8), CC BY — trimmed.",
  },

  /** the family chat room and its opening messages */
  familyRoom: {
    name: FAMILY_WORKSPACE_NAME,
    talk: [
      ["mom", "Chuseok is tomorrow! What time should we be at Grandma's?"],
      ["grandma", "Just come before lunch. I'll make plenty of sesame filling for the songpyeon."],
      ["dad", "I'll do the beef skewers. And I'll pick up Uncle's family at Nonsan Station 😄"],
      ["mom", "Grandma's blood-pressure pill is once after breakfast, right? I'll check the medication schedule."],
    ] as [string, string][],
  },
  /** the birthday room (everyone but grandma) and its opening messages */
  secretRoom: {
    talk: [
      ["seoyeon", "I put yesterday's meeting recording in the birthday_plans folder! It doesn't show in Grandma's teamspace 🤫"],
      ["mom", "Thanks, Seoyeon. Let's sort out the to-dos and split them up."],
    ] as [string, string][],
  },

  /** pocket-money ledgers: grandma and mom start with money to give */
  ledgers: {
    head: LEDGER.head as string,
    books: [
      ["grandma", LEDGER.out, ["2026-09-01,Pocket-money wallet topped up (pension),—,300000,300000,—"]],
      ["mom", LEDGER.out, ["2026-09-01,Pocket-money wallet topped up,—,200000,200000,—"]],
      ["seoyeon", LEDGER.in, []],
    ] as [string, string, string[]][],
  },
};

export type FamilySeed = typeof SEED;
