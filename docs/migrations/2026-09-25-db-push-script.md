---
unit: db-push-script
date: 2026-09-25
commits: [57799d7]
scope:
  - app/scripts/db-push.mts
db-migration: none
depends-on: []
verify: npx tsx scripts/db-push.mts (prints a no-op when there are no statements to apply)
status: pending
---

# (Optional) guarded non-interactive drizzle schema push

## What

`drizzle-kit push` stops at TTY prompts (e.g. "truncate users?"), so it can't be
used from agents/CI. This script calls `pushSchema` from `drizzle-kit/api`
directly, prints every statement, and **refuses to execute if it contains
DROP TABLE / DROP COLUMN**. It is a dev tool, not runtime code — whether to port
it is up to the ainmem workflow.

## Why

When a teammate's PR moved the schema ahead and the dev DB fell behind, we needed
a way to push only the safe CREATE/ALTER statements without human intervention.

## Change details

- New `app/scripts/db-push.mts`, 23 lines. `pushSchema(schema, drizzle(pg))` from
  `drizzle-kit/api` → inspects `statementsToExecute`, then apply().
- **It must live inside app/scripts** — placed outside (e.g. a scratch dir),
  module resolution of drizzle-kit/api failed.

## Pitfalls

- If a unique constraint name differs from the drizzle convention
  (`<table>_<col>_unique`) (e.g. the pg default `_key`), pushSchema tries to raise
  a recreate prompt — renaming existing constraints to drizzle names keeps it quiet.
- Cases that still prompt (the truncate question) can occur even through this
  API — in that case apply just that DDL with psql first, then rerun.
