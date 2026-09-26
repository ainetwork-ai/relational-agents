/**
 * Korean content the database components match against — DATA, not UI text.
 * Code outside src/i18n refers to it from here so no Korean literal lives in
 * the code itself.
 */

/** Separators a Korean date is typed with (`2026년 8월 4일`); the date picker's
 *  typed box accepts them alongside `/ . -`. */
export const KO_DATE_SEP = { year: "년", month: "월" } as const;

/** The "new" prefix a Korean item name may already carry (`새 프로젝트`), which
 *  the peek's title placeholder strips before writing its own. */
export const KO_ITEM_NAME_NEW_PREFIX = "새";
