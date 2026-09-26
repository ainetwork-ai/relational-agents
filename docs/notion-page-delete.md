# Page deletion — top-right `⋯` menu (Notion measurements, 2026-09-10)

comcom: "I want to delete the test page I made, but there's no delete button. When you open a document
from the table on the Projects page, there's no delete under the ... at the top right. Measure it in
Notion and add the delete feature too."

The original was only read — the menu was opened, its items and values measured, and closed with
Escape. Nothing was deleted. Measurement scripts `mp0*.mjs`, raw data `n-pagemenu*.jsonl`.

## 0. Pitfall when measuring (for the next person)

Clicking near the title cell in the Projects table to open a row **puts the cell into edit mode.** The
coordinates of the hover `Open` button shift with the window width, so it is hard to press reproducibly.
The caret actually landed in a title cell of company data twice (the text was not changed). **Do not click
inside the table**; it is safer to measure the menu itself on a regular page — all three views share the same menu anyway.

## 1. Where it is

A **28 × 28** button at the top right, `aria-label` = the `Actions` string (ko dictionary). Next to it,
side by side: `Copy link`, `Favorite`, `Share`.

## 2. The menu and the delete item

| Part | Value |
|---|---|
| Card | **256 wide**, radius **10px**, white background, card padding 0, `overflow-y: hidden` |
| Shadow | `rgba(25,25,25,.05) 0 20px 24px`, `rgba(25,25,25,.027) 0 5px 8px`, `rgba(42,28,0,.07) 0 0 0 1px` (**the same 3 layers** as the mention menu and the video popover) |
| Delete item | **`Move to Trash`** |
| Text | 14px / 400 / **rgb(44,44,43)** |
| Icon | Left 12, label **40** from the card's left |

**It is not red.** Same as the comment `Delete` (`docs/notion-comment-delete.md` §3) — the original does
not paint destructive items red. Delete in our sidebar is `danger` red, so the conventions differ.

## 3. Its position in the menu — right after `Move to`

Regular page:

```
Ag Default · Serif · Mono
Copy link ⌘⌥L · Copy page contents · Duplicate ⌘D · Move to ⌘⇧P · Move to Trash
Presentation mode · Small text · Full width · Customize page · Lock page
Use with AI · Suggest edits · Translate · Import · Export · Turn into wiki
Updates & analytics · Version history
```

Database page:

```
Copy link ⌘⌥L · Duplicate · Move to ⌘⇧P · Move to Trash
Customize layout · Lock database
Import · Merge with CSV · Export
Updates & analytics · Version history · Notifications · Mentions · Connections
Open in Mac app
—— Last edited by <name> / <time>
```

In both, **`Move to Trash` comes right after `Move to`**, followed by a divider.

## 4. Our state (before implementation)

- There is **only one** page `⋯` menu in the whole app — `PageOptionsMenu` in
  `components/page/page-options.tsx`. Full width · Lock page · Duplicate · Move to · Export Markdown ·
  Export PDF · Page history. **No delete.** It does not even import `Trash2`.
- **All three views use this component**: the full page (`page-view.tsx`), the center peek
  (`page-peek.tsx`), and the one comcom mentioned, **the side peek of a row opened from a table** (`row-peek.tsx`).
  So fixing one place fixes all three.
- Deletion itself already exists: sidebar row `⋯` → `Delete` (red) → `archivePage` + the "Moved to trash"
  toast + undo, plus restore / permanent delete in the `Trash` modal.
- Server `DELETE /api/pages/[pageId]` is a **soft delete** (`isArchived`) and folds in the whole subtree.
  With `?permanent=1` it is a real delete.

## 5. What must happen together when deleting a row page

In a database, **a row is a page** (the row's `__page` value is the page id). But right now the two
deletions do not know about each other:

- `DELETE /api/pages/<id>` does not touch `db_rows` → only the page goes to the trash and **the row stays
  in the table** (with `__page` pointing at a dead page).
- Row deletion (`DELETE /api/databases/<db>/rows/<row>`) does not touch `pages` → the body page remains.
- Page DELETE **emits no SSE at all** — `usePageSync(databaseId)` in other tabs never wakes up, so the
  table is not refreshed (the row-deletion side does emit).
- On the full page (`/p/<id>`), the `deleteRow` of the `DbApi` built by `RowPropertiesPanel` is an
  **empty function**, so deleting via `useDb()` there silently does nothing.

## 6. Permissions

`DELETE` currently checks **only workspace membership** (`loadOwnedPage`). `PATCH` in the same file goes
through `requirePagePermission(..., "edit")`, but DELETE goes through nothing. While exposing delete in the
menu, tighten this too.
