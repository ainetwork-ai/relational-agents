/**
 * Timestamps, written the way the original writes them.
 *
 * The Created time column prints `2026년 8월 4일 오후 3:56` — ko-KR, long month,
 * 12-hour with 오전/오후, no seconds, no leading zero on the hour. Measured off
 * app.notion.com, kept in `e2e/fixtures/notion-created-time.json`. The property
 * carries no date_format of its own, so this is Notion's default for
 * created_time/last_edited_time under a Korean UI.
 *
 * The table used to print `toLocaleString("en-US")` here ("8/6/2026, 1:24:00 AM")
 * while the row menu's "최종 편집" line was already writing it the Korean way —
 * two formats for the same instant, in the same table. One function now.
 */
const ROW_TIMESTAMP: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** `2026년 8월 4일 오후 3:56` — empty string for anything unparseable. */
export function formatRowTimestamp(at: string | number | Date | null | undefined): string {
  if (!at) return "";
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", ROW_TIMESTAMP);
}
