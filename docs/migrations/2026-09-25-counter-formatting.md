---
unit: counter-formatting
date: 2026-09-25
commits: [154d1d9]
scope:
  - app/src/lib/db/schema.ts
  - app/src/components/database/dashboard-view.tsx
  - app/src/i18n/en.ts
  - app/e2e/dashboard-counter.check.mjs
db-migration: none
depends-on: []
verify: BASE_URL=http://localhost:<port> node e2e/dashboard-counter.check.mjs
status: pending
---

# Counter widget number formatting

## What

The dashboard counter widget can format its value: decimal places (auto/0–4),
a literal prefix/suffix ("$", " ETH", etc. — not a currency enum), and ± sign
color (positive green with a leading `+`, negative red, sign placed before the
prefix: `-$120.50`). Thousands separators are always applied.

## Why

The counter squashed values like `0.0005` into `0.0`, and there was no way to
express units or currency. For PnL-style metrics the sign *is* the state, so it
needs color.

## Change details

- Adds `decimals?: number` `prefix?: string` `suffix?: string`
  `colorBySign?: boolean` to `DashWidget` — widget settings live inside
  `db_views.config` (jsonb), so only the type grows and there is no DB migration.
- `dashboard-view.tsx`: a `formatCounter(value, w)` helper + sign-color classes
  in renderCounter. Four selects/inputs added to edit mode
  (testid `db-dashw-decimals|prefix|suffix|sign-<id>`); prefix/suffix commit
  onBlur.
- i18n keys (with ko dictionary entries): `Auto decimals` `{n} decimals`
  `Prefix` `Suffix` `± color`.

## Verification

The check creates a temporary DB, exercises all four controls, confirms the
rendering and colors, then cleans up.
Required APIs: demo-login, `POST /api/databases {shape:"minimal"}`,
properties/rows/views/fullpage.

## Pitfalls

- Tailwind v4 reports computed colors as `lab()` — verify color by the sign of
  the lab a-axis (green negative / red positive), not with an rgb regex.
- Verifying consecutive edits is flaky without
  [view-edit-race-fix](2026-09-25-view-edit-race-fix.md) — this check is what
  found that bug.
