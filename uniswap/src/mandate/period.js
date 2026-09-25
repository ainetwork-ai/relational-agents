/**
 * The idempotency key of a run. Derived from the mandate's cadence, never from the UTC day:
 * a weekly mandate keyed on days would buy every day (the dca-bot skill documents this bug).
 */
export function periodKey(period, date) {
  // A NaN date would key as "NaN-WNaN" and silently merge every run of that mandate.
  if (!(date instanceof Date) || Number.isNaN(date.getTime()))
    throw new TypeError("periodKey: date must be a valid Date");
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (period === "day") return d.toISOString().slice(0, 10);
  if (period === "month") return d.toISOString().slice(0, 7);
  if (period === "week") {
    const isoDay = d.getUTCDay() || 7;           // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - isoDay);   // the Thursday of this ISO week fixes the ISO year
    const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  throw new Error(`unknown period "${period}"`);
}
