---
unit: chart-widget
date: 2026-09-25
commits: [07e6b6c]
scope:
  - app/src/lib/db/schema.ts
  - app/src/components/database/dashboard-view.tsx
  - app/src/i18n/en.ts
  - app/e2e/dashboard-chart.check.mjs
db-migration: none
depends-on: []
verify: BASE_URL=http://localhost:<port> node e2e/dashboard-chart.check.mjs
status: pending
---

# Chart widget — time-series line/candles + row markers

## What

A new widget kind `"chart"`. Any date property (x) × any number property (y):

- **Line mode**: a time series connecting rows as points in time order.
- **Candle mode**: groups rows into time buckets (hour/day/week) and derives the
  open/high/low/close (OHLC) of the values in each bucket — it works as a
  "distribution summary within a bucket" even when the data is not prices.
  Up is green, down is red.
- **Markers (optional)**: pick a select/status property and each row is drawn as
  a dot in its option color, with a legend attached (e.g. buy/sell, inquiry type).

Rendered directly as SVG; no chart library.

## Why

The dashboard had no time-axis widget (bar/donut only aggregate by category).
It is designed to be generic, so it attaches to any DB that has a date and a number.

## Change details

- `DashWidget`: adds `"chart"` to `kind`, plus fields `xPropertyId` `yPropertyId`
  `chartType?: "line"|"candles"` `bucket?: "hour"|"day"|"week"`
  `markerPropertyId` (inside jsonb, no DB migration).
- `dashboard-view.tsx`: `BUCKET_MS` constant, `renderChart()` (geometry, 3 grid
  lines, compact-format y labels, time labels as HH:MM when the range is < 2 days),
  and KINDS/BODY/widgetTitle/addWidget defaults (w2, line, first date and number
  property). Edit-mode selects:
  `db-dashw-charttype|x|y|bucket|marker-<id>` (bucket only for candles).
- svg element attributes: `data-chart-line` `data-chart-candle`
  `data-chart-marker` (+ `<title>` tooltip) — the check counts these.
- i18n keys (with ko dictionary entries): `Chart` `{name} chart` `Candles`
  `Hourly` `Daily` `Weekly` `No markers` `{name} markers`
  `Needs a date property and a number property.`
  (**`Line` already exists in en.ts — adding it again causes TS1117**).

## Verification

The check uses a temporary DB with 5 rows over 3 days: 1 line path + 5 markers →
3 candles (daily) (day 1 up green, day 2 down red) → count of marker colors →
0 after clearing markers → 5 hourly candles → x/y select options exist. Deleted
at the end.

## Pitfalls

- **The candle x-domain must snap to bucket boundaries** (`floor(t0/b)*b` to
  `(floor(t1/b)+1)*b`). If you take the raw fill-time range, bucket centers fall
  off the canvas for short bursts of data and the candles disappear — a bug we
  actually hit.
- The viewBox width scales with widget width (the `PLOT_W` map — introduced in the
  [depth-widget](2026-09-25-depth-widget.md) commit). Porting depth along with it
  resolves this automatically; if you port chart alone, a fixed W=560 still works.
- The y-label left margin L needs to be 62 (at 44, "2,500.15" gets clipped).
