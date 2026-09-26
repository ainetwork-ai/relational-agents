/**
 * Timestamps, written the way the original writes them.
 *
 * The Created time column prints the ko-KR long form (Korean for `August 4, 2026, 3:56 PM`) — long month,
 * 12-hour with the Korean AM/PM marker, no seconds, no leading zero on the hour. Measured off
 * app.notion.com, kept in `src/i18n/content/e2e-fixtures/notion-created-time.json`. The property
 * carries no date_format of its own, so this is Notion's default for
 * created_time/last_edited_time under a Korean UI.
 *
 * The table used to print `toLocaleString("en-US")` here ("8/6/2026, 1:24:00 AM")
 * while the row menu's "Last edited" line was already writing it the Korean way —
 * two formats for the same instant, in the same table. One function now.
 */
const ROW_TIMESTAMP: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** Long date + 12-hour time in `locale` (`August 4, 2026 at 3:56 PM` in en-US) — empty string for anything unparseable.
 *  `locale` is the user's Intl locale (`useIntlLocale()`); ko-KR when absent. */
export function formatRowTimestamp(at: string | number | Date | null | undefined, locale = "ko-KR"): string {
  if (!at) return "";
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, ROW_TIMESTAMP);
}
