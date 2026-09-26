# ainmem migration docs — index and format

When porting a feature added to the Notion app (`app/`) in this repo
(relational-agents) over to ainmem, write **one doc per feature = one migration
task**. Once ported, change the doc's frontmatter `status` to `ported` and record
the ainmem commit hash.

## Doc format (common to all docs)

```yaml
---
unit: <slug>                 # same as the doc file name
date: YYYY-MM-DD             # date it landed in this repo
commits: [<hash>, …]         # cherry-pick targets (drop the aqua/ hunks)
scope: [<file path>, …]      # changed files on the app/ side
db-migration: none | <description>
depends-on: [<unit>, …]      # docs that must be ported first
verify: <command or file>
status: pending | ported
ported-commit: <ainmem hash>  # only when ported
---
```

Body sections: **What** / **Why** / **Change details** / **Verification** / **Pitfalls**.

## List (recommended order)

| # | Doc | Commit | Status |
|---|---|---|---|
| 1 | [counter-formatting](2026-09-25-counter-formatting.md) | `154d1d9` | pending |
| 2 | [view-edit-race-fix](2026-09-25-view-edit-race-fix.md) | `cfaa1ac` | pending |
| 3 | [chart-widget](2026-09-25-chart-widget.md) | `07e6b6c` | pending |
| 4 | [depth-widget](2026-09-25-depth-widget.md) | `00d7fc1` | pending |
| 5 | [view-position-api](2026-09-25-view-position-api.md) | `97ef6c3` | pending |
| 6 | [db-push-script](2026-09-25-db-push-script.md) | `57799d7` | pending (optional) |

Common premise: these are all general-purpose product features, so there is no
trading code. `aqua/` (the 1inch pipeline, seeds, review agent) and the data
seeded into the dev DB are not ported.
