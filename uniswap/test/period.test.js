import { test } from "node:test";
import assert from "node:assert/strict";
import { periodKey } from "../src/mandate/period.js";

const d = (s) => new Date(s + "T12:00:00Z");

test("week: ISO week, Monday-first", () => {
  assert.equal(periodKey("week", d("2026-09-25")), "2026-W39"); // Friday
  assert.equal(periodKey("week", d("2026-09-27")), "2026-W39"); // Sunday, same week
  assert.equal(periodKey("week", d("2026-09-28")), "2026-W40"); // Monday, next week
  assert.equal(periodKey("week", d("2025-12-29")), "2026-W01"); // ISO year rolls early
  assert.equal(periodKey("week", d("2027-01-01")), "2026-W53"); // 53-week year; rolls back
});

test("day and month keys", () => {
  assert.equal(periodKey("day", d("2026-09-25")), "2026-09-25");
  assert.equal(periodKey("month", d("2026-09-25")), "2026-09");
  // Late enough that Asia/Tokyo is already on the 28th: the key follows UTC, not the local day.
  assert.equal(periodKey("day", new Date("2026-09-27T23:30:00Z")), "2026-09-27");
});

test("unknown period throws", () => {
  assert.throws(() => periodKey("fortnight", d("2026-09-25")), /unknown period/);
});

test("an invalid date throws instead of keying NaN", () => {
  assert.throws(() => periodKey("week", new Date("garbage")), /valid Date/);
});
