/**
 * Korean content of the family demo — names, folder and file paths, ledger
 * columns — that is DATA (seeded into aindrive folders, matched in chat), not
 * UI text. Code outside src/i18n refers to it from here so no Korean literal
 * lives in the code itself.
 */

/** Family members as the demo names them, with English display names. */
export const FAMILY = {
  grandma: { ko: "할머니", en: "Grandma" },
  mom: { ko: "엄마", en: "Mom" },
  dad: { ko: "아빠", en: "Dad" },
  seoyeon: { ko: "서연", en: "Seoyeon" },
  doyun: { ko: "도윤", en: "Doyun" },
  everyone: { ko: "모두", en: "Everyone" },
} as const;

/** Korean name → English display name. */
export const FAMILY_NAME_EN: Record<string, string> = Object.fromEntries(Object.values(FAMILY).map((f) => [f.ko, f.en]));

/** The family workspace the demo account owns. */
export const FAMILY_WORKSPACE_NAME = "우리 가족";

/** The pocket-money ledger each person keeps in their own aindrive. */
export const LEDGER = {
  out: "지갑/용돈_장부.csv",
  in: "지갑/받은_용돈.csv",
  head: "날짜,내용,상대,금액(원),잔액(원),영수증",
  /** the "내용" column of a gift row: `용돈 · <title>` */
  entry: (title: string) => `용돈 · ${title}`,
} as const;
