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
