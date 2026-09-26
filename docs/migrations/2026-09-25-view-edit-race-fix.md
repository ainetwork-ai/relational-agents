---
unit: view-edit-race-fix
date: 2026-09-25
commits: [cfaa1ac]
scope:
  - app/src/components/database/database-block.tsx
db-migration: none
depends-on: []
verify: the repro steps below + repeated runs of dashboard-counter.check.mjs must show no flakes
status: pending
---

# Fix: SSE snapshot refetch reverting view settings being edited

## What

Fixes a bug where `refreshSnapshot()` overwrote the whole server copy with
`setViews(snap.views)` on every realtime event, silently rolling back view
setting edits (filters, sorts, widget settings) whose PATCH had not yet landed on
the server.

## Why

View PATCHes go through a 350ms debounce. If an SSE arrives within that window
(or before the server processes it) — e.g. because another client added a row —
the refetch pulls a stale config and overwrites the local optimistic state. To
the user it looks like "the setting I just changed reverted by itself".
**If ainmem has the same refreshSnapshot pattern, it has the same bug.**

## Change details

- New `dirtyViewConfigs` ref (`Map<viewId, ViewConfig>`).
- `patchViewConfig()`: marks dirty right after the optimistic `setViews`; in the
  PATCH fetch's `.finally()`, deletes **only if its own config is still the
  latest** (an old PATCH landing late must not lift the protection of a newer edit).
- `saveDraft()` marks/clears the same way.
- `refreshSnapshot()`: when applying `snap.views`, dirty views keep their local
  config.

## Verification

Repro (before the fix): in dashboard edit mode, change widget settings repeatedly
at 0.5s intervals + add a row from another session (or via the API) → earlier
changes revert.
After the fix: run `dashboard-counter.check.mjs` 3 times in a row and confirm no
flakes.

## Pitfalls

- Clearing dirty must always compare "identity with the latest write"
  (`get(vid) === config`). Deleting unconditionally reopens the race.
- Declare `dirtyViewConfigs` above `refreshSnapshot` (closure reference).
