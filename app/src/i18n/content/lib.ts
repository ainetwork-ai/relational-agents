/**
 * Korean content used by src/lib — data, not UI text: folder-name keywords the
 * family share screen matches against people's own (often Korean) folder
 * names, and the demo storefront's catalogue. Kept here so no Korean literal
 * lives in src/lib itself.
 */

/** Folder-name keywords per share category, Korean and English, matched
 *  case-insensitively against a top-level folder name. */
export const FOLDER_KEYWORDS = {
  photos: ["사진", "앨범", "영상", "photo", "camera", "dcim", "album", "video"],
  notes: ["레시피", "메모", "요리", "편지", "일기", "recipe", "note", "memo", "cooking", "letter", "diary"],
  voice: ["녹음", "voice", "record"],
  plans: ["일정", "계획", "여행", "추석", "귀성", "달력", "벌초", "plan", "trip", "travel", "chuseok", "calendar", "schedule", "graves"],
  health: ["건강", "병원", "약", "health"],
  money: ["지갑", "가계부", "관리비", "wallet", "money", "budget"],
} as const;

/** The demo storefront (lib/seller.ts): a Korean rice-cake shop. */
export const SELLER = {
  name: "달빛떡집",
  item: "송편 한 상자 (1kg)",
  message: "실제 가족이 뒤에 있는 에이전트 — 추석 잘 보내세요 🌕",
} as const;
