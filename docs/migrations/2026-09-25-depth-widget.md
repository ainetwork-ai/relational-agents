---
unit: depth-widget
date: 2026-09-25
commits: [00d7fc1]
scope:
  - app/src/lib/db/schema.ts
  - app/src/components/database/dashboard-view.tsx
  - app/src/i18n/en.ts
  - app/e2e/dashboard-depth.check.mjs
db-migration: none
depends-on: [chart-widget]
verify: BASE_URL=http://localhost:<port> node e2e/dashboard-depth.check.mjs
status: pending
---

# Depth widget — two-sided cumulative step areas

## What

A new widget kind `"depth"`. It splits rows by the **first two options** of a
select/status property and draws two cumulative step areas facing each other
along a number property (the level axis) — the left side runs outward from its
highest level, the right side outward from its lowest level (read like an order
book). Size is either the sum of another number property or the row count.
Multiple rows at the same level are summed. At its core it is "comparing the
per-level cumulative distributions of two groups", so it is not only for order
book data (e.g. salary axis × applicants/job postings).

## Why

There was no widget showing at which level two groups meet.

## Change details

- Adds `"depth"` to `DashWidget.kind`. No new fields — reuses `xPropertyId`
  (level axis, introduced in the chart commit), `groupByPropertyId` (sides), and
  `aggregatePropertyId` (size). Inside jsonb, so no DB migration.
- `dashboard-view.tsx`: `renderDepth()` (sum per level → sort and accumulate per
  side → step path, option color at 22% fill + 2px outline, `<title>` = cumulative
  sum, totals in the bottom legend), reflected in KINDS/BODY. Edit mode: depth
  added to the visibility condition of the existing groupBy/agg selects, plus a
  level-axis select (`db-dashw-x-<id>`, list of number properties — branched
  because chart's x is a list of date properties).
- Introduces the `PLOT_W` map: svg viewBox width is 260/420/560/700 for widget
  widths 1–4 — so axis text stays readable even at w1. **The chart renderer was
  changed in this commit to use it too** (the reason for depends-on).
- svg attribute: `data-depth-side="<optionId>"`.
- i18n keys (with ko dictionary entries): `Depth` `{name} axis`
  `Needs a number property and a select property with at least two options.`

## Verification

The check uses a temporary DB with a bid/ask ladder (including two rows at the
same level): 2 side polygons, cumulative sums (confirming per-level summing:
bid 60 / ask 70), colors (green/red), switching size → count, switching the level
axis. Deleted at the end.

## Pitfalls

- The sides are "the first two options" — even with 3 or more options, the third
  onward is ignored.
- Color verification compares the stroke attribute (#4ade80/#f87171) directly — if
  the OPTION_HEX palette constant differs in ainmem, adjust the check's expected
  values.
