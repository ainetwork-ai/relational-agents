---
unit: view-position-api
date: 2026-09-25
commits: [97ef6c3]
scope:
  - app/src/app/api/databases/[databaseId]/views/[viewId]/route.ts
db-migration: none
depends-on: []
verify: after PATCH, check the views order in GET /api/databases/:id + the landing tab when the page is freshly opened
status: pending
---

# position support in view PATCH — controlling the landing tab

## What

Allows `position?: number` in the body of
`PATCH /api/databases/:databaseId/views/:viewId`. The view list is returned in
ascending position order, and the client treats `views[0]` as the default active
view, so **the view with the lowest position = the landing tab when the page is
freshly opened**.

## Why

There was no API to reorder views (POST always uses max+1), so there was no way
to make a later-created view (e.g. a dashboard) the default screen. It is an
API-only extension with no UI change — MCP and seed scripts are the consumers.

## Change details

- One line of body validation: included in the patch only when
  `typeof body?.position === "number" && Number.isFinite(...)`.
  `dbViews.position` is doublePrecision, so inserting in-between values (e.g.
  min - 1, the average of two views) works as-is.
- `okfPatchView` on the OKF (file-based) DB path does not accept position — it is
  ignored (tsc passes thanks to structural typing). If file DB view ordering is
  needed too, that's separate work.

## Verification

```bash
curl -X PATCH .../views/<viewId> -d '{"position": 0}' # lower than the current minimum
# GET /api/databases/:id → is views[0] that view?
# open the page fresh in the browser and check the landing tab
```

## Pitfalls

- Promotion works by lowering, so repeating it drifts into negatives — that's
  fine (double), but when adding a UI reorder feature, consider normalizing
  (reassigning 1..n).
