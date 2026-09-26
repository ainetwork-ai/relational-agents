# Notion's icon policy — investigation and our implementation

2026-08-06. A record of checking, against the original workspace, whether "the database icon follows the rows."
The conclusion up front: **it does not follow them; it is copied once when the row is created.**

The investigation method is the same as in `docs/notion-projects-spec.md` — we attached to the user's Chrome over CDP,
called the read-only APIs (`loadPageChunk`, `queryCollection`), and read the DOM. The original was not modified.

## 1. What you see

| Database | DB icon | Row title cell |
|---|---|---|
| `Projects` | `/icons/iterate_blue.svg` | **The DB icon is attached to every row** |
| `Master` (AIN Space QA) | `🎖` | Not 🎖. A **generic page glyph** (`svg.page`) |
| `Projects List`·`ComCom Tasks` (Modulabs maintenance) | `/images/app-packages/*.svg` | **Nothing at all** |

If the same rule applied, the rows of `Master` should also show 🎖, but they don't. So the explanation that
"the DB icon is inherited at render time" is wrong.

## 2. The actual rule

The row block (= the row's page) **carries its own `format.page_icon`.** Looking at 100 rows of `Projects`:

```
/icons/iterate_blue.svg   99 rows   ← the DB icon
/icons/anchor_blue.svg     1 row    ← that one row was changed individually
```

The single differing row is decisive. With live inheritance they would all be identical. So:

1. **When a row is created**, the database's icon is **copied** into that row's page
2. After that, **each row can be changed independently**
3. The copy happens only once, at row creation, so **it does not carry over to sub-documents created inside that row's document (depth 2)**
4. The rows of `Master` and Modulabs have no icon because no copy happened when those rows were created

And **whether it is shown is decided by the view** — `collection_view.format.show_page_icon`. The original `Projects`
turns row icons off in three views: `My`, `All Projects`, and `My Timeline` (the rest have no value = on).

## 3. Our implementation

| Rule | Ours |
|---|---|
| Copy the DB icon on row creation | ✅ `addRow` puts it in `values.__icon`. Template rows are excluded |
| Different icon per row | ✅ The value lives on the row, so it can differ per row (there is no UI to change it yet) |
| Does not carry over to sub-documents | ✅ Structurally true, since the copy happens once at creation |
| Per-view display toggle | ✅ `ViewConfig.showPageIcon` (on by default) |
| Display priority | ✅ The row's `__icon` → otherwise the database icon |

In a full-page database, **DB icon = that page's icon**, so the only place the icon is set is the icon in the page
header (we did not add a separate column).

**Still different**: there is no UI to change a row's icon after it is created. We can't do with our UI what was done
in the original, where a single row was changed. Once row↔page is wired up, that page's icon picker will serve that role as-is.

## 4. dev data

The seed (`scratchpad/gen-seed.mjs`) puts `__icon` on all 249 rows — matching the state in the original where rows
received a copy of the icon at creation. The dev Projects page icon is 🎯, so the rows are 🎯 too.
