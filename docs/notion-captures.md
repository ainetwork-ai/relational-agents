# Notion captures — what each screen is and what we read from it

DOM captures taken on 2026-08-05 while aligning the sidebar, teamspaces, and databases with Notion.
**Every file is the real Notion screen saved in that exact situation**, so "how does Notion do it" can be
checked against a file instead of memory or guesswork. A new session picking up the same work should start here.

> How to read them: the files are large (up to 1.4MB), so do not open them in a browser — search them as text.
> `aria-label`, `placeholder`, `role="treeitem"`, and the `notion-*-block` classes reveal the structure.
> Example: `grep -o 'notion-[a-z_]*-block' docs/target.html | sort | uniq -c`
>
> The captures were taken with the Notion account language set to Korean, so the UI strings inside them are
> Korean. Below, each string is written as its English UI name; the exact captured Korean is the corresponding
> entry in the ko dictionary (`app/src/i18n/ko.ts`). Expected Korean strings used by the e2e golden-set scripts
> are being moved into `app/src/i18n/content/` modules.

## Situation per file

| File | Situation | What we confirmed from it |
|---|---|---|
| `target.html` (1.4MB) | The **full-page database** `Projects` open (`collection_view_page`) | Width rule: there is **no** content cap (`width:100%`, 96px inset). The reason it differs from the 708px column of prose pages is the **block type**, not a toggle. The body has **0 blocks** — this block cannot hold paragraphs besides title, description, and cover. 7 view tabs. **The selected view is a table grouped by the person property `TL`**: 10 groups, 23 columns (`Project name`·`TL`·`Effort`·`Assignee`·`Status`…), widths `516/134/100/562`. Each group has **its own column header row** (10 `notion-table-view-header-row`s) and an add-row `New project`; the group header is a `Close` caret + avatar·name + `Show group options` + `Add new page to group` (the count slot is empty). The first column is frozen (`notion-table-view-frozen-column-repositioner`). Person cells hold multiple people and overflow into `Show 1 more`. There is **no** row cap/load-more |
| `sidebar1.html` (118KB) | **Private pages** sidebar, hovering a section header | Three section header buttons: `Open in library` · `Open menu` (⋯) · `Add page` (+). A page row has `Open` · `Delete, rename, and more...` · `Add a page inside` |
| `sidebar_team1.html` (705KB) | **Teamspace** sidebar | `+` appears **only on page rows**. The teamspace row (`General`) has only one button, `Teamspace settings and members`, and no `+`. The `Teamspaces` section header has no `+` either (only `Open in library`·`Open menu`) |
| `personal_hover_plus.html` (166KB) | **Right after a sub-page is created** by pressing `+` on a private page row | The new page's title placeholder is `New page` |
| `plus_page_personalpage_html` (28KB) | **Body only** of the same situation as above | What an empty page offers: `Get started with` → `Ask AI` · `AI Meeting Notes` · `Database` · `Templates`. Header has `Add icon` · `Add cover` · `Add comment` |
| `page_add_popup.html` (30KB) | `+` on a **teamspace sub-page** (`Teamspace Home`) → new page | The same `Get started with` row has **one more item, `Form`**. At the top, `Add to: 🏠 Teamspace Home` (parent indicator) and `Open as full page` — the new page opens as a **peek (side overlay)** |
| `plus_popup_full1_teamspace.html` (29KB) | `+` on a teamspace row → new page peek | Button set: `Share`·`Copy link`·`Favorite`·`Change view options`·`Actions` |
| `teamspace_add_popup.html` (12KB) | **Create teamspace, step 1** | Title/subtitle, `Icon & name` (placeholder `e.g. Engineering`), `Description` (`What is this teamspace for?`, rows=3), `Security` (default `Open / Anyone can see and join this teamspace`). The primary button is `aria-disabled` while the name is empty. Width 440px |
| `teamspace_add_popup_member_search_list.html` (22KB) | Step 1 with the **member picker list** expanded | `Select people` header, loading text `Loading...`, name + `Guest` badge |
| `teamspace_add_process_popup_1.html` (8KB) | **Create teamspace, step 2** (invite members) | `Invite to teamspace:` + icon + name, search placeholder `Search for people or groups`, role dropdown `Teamspace member`, footer `Copy invite link` · **`Skip`** |
| `after_teamspace_popup_body1.html` (633KB) | **Right after pressing `Skip`** in step 2 | The teamspace already exists (Skip does not cancel). The new teamspace appears in the sidebar with one page under it, **`🏠 Teamspace Home`**, and an **`Add new`** row at the end of the list |
| `database_tableview_newpage2.html` (2.1MB) | The side peek **right after creating a row with `New`** in a table view (2026-08-06) | Peek width **1141px**. Title placeholder **`New project`** (= "New" + item name). Below the title, a **`Show/Hide details`** toggle. Below that, **4 pinned properties** (`TL`·`Assignee`·`End date`·`Evaluation`) in a horizontally scrolling band (`data-pinned-row`, `min-width:max-content`, gap 8px), label above / value below; empty values read **`Empty`**. Then `Comments`, and the **default template body** (Objectives / KPIs ☐To-do / Action items ☐To-do). Only two values are auto-filled on creation — `Status = In progress` (inherited from the view filter) and `Created time` |
| `database_tableview_newpage_details.html` (2.1MB) | The peek above **with `Show details` pressed** | A **380px panel on the right, inside the peek** (`width:380px; flex-shrink:0; border-inline-start:1px`, 200ms transition). Header `Properties`, the remaining 18 properties all `Empty`, and **`Add a property`** at the bottom (not in the page body). The peek's own width is unchanged, so **the body column gets narrower**. ⚠️ The earlier `database_tableview_newpage.html` was saved before the properties rendered and contains no property names at all — it was once misread as "a new row has 0 properties" and implemented that way |
| `database_date_picker.html` (24KB) | **Date popover opened by clicking a `Start date` cell** in the table view (2026-08-06) | Panel **248x500**. Top to bottom: date input box (224x28, radius 6, bg `rgba(66,35,3,.03)`, 12px inset, fully selected on open) → calendar (react-day-picker: caption `August 2026` (Korean year-month format) 14px/500 + `Today` 12px `#8E8B86` + `‹ ›` `#A5A5A5`, weekdays 32x32 12px `#8B9898`, days are 28x28 buttons radius 6 inside 32x32 cells, this month `#2C2C2B`·other months `#8B9898`, selected `#2783DE` with white text, today is a `::after` circle `#E56458`) → divider (1px `rgba(42,28,0,.07)`, 12px inset left/right) → **`End date` (toggle 30x18) · `Date format` · `Include time` (toggle) · `Remind`** (240x28 rows, values `#7D7A75`) → `Clear` → `Learn about reminders`. Vertical rhythm: input 12–40, calendar 49–298, 4px above and below each divider, 28px rows with 1px gaps. **`Date format` is per property** (180x181 submenu: Full date / Short date / Month/Day/Year / Day/Month/Year / Year/Month/Day / Relative) — which is why, in the same table, `Start date` shows `08/04/2026` while `End date` shows `August 4, 2026` (Korean full-date format) at the same time |
| `new_database.html` (666KB) | Screen created by clicking **`Database`** on an empty page | **The page itself becomes the database** (block-id of the title `<h1>` = DB block id). Title placeholder `New database`, one view tab `Table`, one column `Name`, no rows, header has `Add cover`·`Add description`. The sidebar also shows it as `New database` |
| `notion-clip-flow-page/` (2026-08-09) | From a prose page (the "Consultation/monitoring screen FLOW and first UI sign-off" page), **the 4 clipboard flavors produced by Cmd+A×2, Cmd+C** (`paste.*.txt`) + a catalog of the original live DOM blocks (`original-catalog.json`) + the verified expected tree (`expected-tree.json`) | **The new Notion (app.notion.com) does not put live DOM on the clipboard** — `text/html` is the residue of a markdown round-trip (callouts as a literal `&lt;aside&gt;`, bold at whitespace boundaries as a literal `**`, toggles as plain `<li>`); the real payload is **`text/_notion-blocks-v3-production`** (block-record JSON containing type, bold runs, checks, icons, colors, and even children of collapsed toggles). Input to `e2e/notion-paste.check.mjs` |

## What these captures fixed (2026-08-05)

- The `+` on sidebar section headers (`Private`·`Teamspaces`) now **appears on hover**, and a `⋯` menu was added (sort, collapse all). Also fixed the bug where the `Private` label was rendered twice
- Teamspace creation became a **2-step modal** (the inline name input was dropped). Added `description`·`visibility` and `teamspace_members` to the schema; on creation, the **`🏠 Teamspace Home`** page is created in the same transaction, and an **`Add new`** row sits at the end of the teamspace list
- Member search opens the list **only when there is input**; matching is name-word prefix + email local-part prefix (everyone is `@comcom.ai`, so substring matching let a single `m` match everyone)
- A **`Get started with`** row on empty pages. Only implemented items are enabled (`Database`·`Templates`); the rest are disabled with a tooltip explaining why
- The `Database` button **turns the page itself into a full-page DB** and provisions the minimal form with only `Name`·`Table`. The title is stored on both the page and the DB
- Full-page DB pages show **`New database`** + a table icon in the sidebar, breadcrumbs, and title (`GET /api/pages` computes `isDatabase`)
- Fixed the bug where teamspace pages were also listed under `Private`, and breadcrumbs failing to show the teamspace
- **The table view now matches the captured grouped table**: person and checkbox properties can also be grouping keys, each group has a column header row and
  an add-row (a row created from that add-row gets the group's value), and the header has collapse·`Show group options`
  ·`Add new page to group`. Collapse state is stored on the view and survives a refresh. First-column freezing too
- **Person properties hold multiple people.** The cell stays on one line and shows as many as fit the column width; the rest become
  `Show N more`. Filters `is`/`is me` pass if anyone in the cell matches, and a row with two people shows up in both
  groups. List, gallery, and dashboard use the same group builder

## Still different from Notion

- **No peek (side overlay).** In Notion, a page created with `+` opens as an overlay with an `Open as full page` button. We navigate immediately (`page_add_popup.html`, `plus_popup_full1_teamspace.html`)
- **The teamspace row button** is `+` for us and `Teamspace settings and members` in Notion. Changing it first needs a settings screen (name, description, security, members) (`sidebar_team1.html`)
- We have no screen corresponding to **`Open in library`** (`sidebar1.html`)
- **Whole-row click in the sidebar**: in Notion, clicking anywhere on the row navigates; for us only the title text is a link
- The full-page width **cap** (ours 1500px vs Notion unlimited) and **side insets** (64px vs 96px) (`target.html`)
- The group add-row label in Notion is **`New project`** — meaning each database can set an "item name".
  Ours is fixed to `New page`, so it will differ until that setting exists (`target.html`)
- **The group header name is a button in Notion** (`aria-haspopup="dialog"`) that changes the group value when clicked.
  Ours is plain text (`target.html`)
- We lack the row-hover **`Open comments`**. Row comments attach to the row's page, so this has to go together with
  the row↔page work (`target.html`)

| `settings_my_settings.html` (74KB) | **Settings & members** modal, `Preferences` tab (2026-08-26, personal workspace) | Entry: workspace switcher at the top left → `Settings`. There is no `Settings` row in the sidebar. Modal `.notion-dialog` 90vw·max 1512·height calc(100%-100px)·r12, left nav 240px (`role=tablist`, section labels `Account`/`Workspace`/…, tabs 28px). `Language & Time` section (title 16/24 500) → `Language` row (label 14/20 500, description 13/18 `rgb(125,122,117)`), dropdown button at the far right showing `Korean` (the language's own name, ko dictionary) 69×28 r6 border `rgba(28,19,1,.11)` 14px. Dropdown 216px wide, items 43px, 22 languages as two lines `native name | name in Korean` |

## English captures — `docs/en/` (2026-08-26, account language English (US))

The vocabulary reference for `en.ts`. Text summary in `docs/en/_texts.json` (innerText per screen), HTML as one file per screen.
Settings modal, 3 tabs (`settings_*`), the language list, the switcher menu, the page `⋯` (`page_more_menu`), sidebar row/section menus,
the share popup, search, page hover controls (`Add icon / Add cover / Add comment`), the Projects table (`projects_table.html`)
property header menus (`header_menu_*`), Status/date/person cell pickers (`cell_*`), property editing (`edit_property_*`), the type list
(`change_type_submenu`), the template menu (`new_more_options`), group options, and the selection toolbar (`bulk_toolbar`).
The filter/sort/view settings panels open inside the frame rather than as overlays, so they were only partly captured through text diffs.
