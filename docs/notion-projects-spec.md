# The original `Projects` spec — what we have to match

2026-08-06. The reference document for reproducing Notion's ComCom `Projects` page (a full-page database) exactly.
The values are **not estimates**; they are the settings received from that page as-is: we attached to the user's
browser over CDP, called `POST /api/v3/loadPageChunk` (read-only), and received 1 `collection` and 8 `collection_view`
records (`chunk.json`, 76KB). What follows spells out that content.

> How to read this: Notion holds property ids as 4-character codes (`L[OY`) or UUIDs. Match them by the names in the tables below.

Note on UI strings: the original workspace runs in the Korean Notion UI. Where this document names a menu label,
button, aria-label, or tab, it gives the English UI name; the exact Korean string measured in the capture is the
corresponding entry in the ko dictionary (`app/src/i18n/ko.ts`).

## 23 properties

| Name | Type | Settings |
|---|---|---|
| Project name | `title` | |
| TL / Assignee / Evaluator / Sherpa | `person` | Holds multiple people |
| Start date / End date / Reg Date / Vulnerable Since / ` Sec.8 Deadline` | `date` | Keep even the leading space in the name |
| Effort | `number` | |
| Status | `status` | Options `Not started·In progress·Deprecated·Needs review·Hold·Done`, **groups `To-do·In progress·Complete`** |
| Team | `multi_select` | 33 options (`AINSpace`, `KKaebi`, `Ops`, `Hanyang Univ.` (a Korean option name in the original) …) |
| Created time | `created_time` | |
| Evaluation | `select` | `Superb·Strongly Exceeds Expectation·Exceeds Expectations·Meets Expectations·Need Improvement·NA` |
| Territory | `select` | `Japan·China·USA·EU·Singapore·Korea·Philippines·Malaysia` +2 |
| Law Firm | `select` | `KNK·ANK` |
| Action | `select` | `Re-file·Defend·Sec8 Filing·Counsel Review·None` |
| Status 1 | `select` | `Urgent·In Progress·Safe·Monitor` |
| Bonus paid (the original property name is "Bonus" + a Korean suffix meaning "paid or not") / Notes / Class / Reg Number | `text` | |

All 23 are types that exist in our schema. **The only thing missing is option groups for `status`.**

## 8 views

| Name | Type | Group | Sort | Filter | Visible columns |
|---|---|---|---|---|---|
| on-going projects | Table | `person` TL, manual order, **hide empty groups** | End date ↑ | — | 13 (TL 250 · Project name 565 · Assignee 469 · Status 136 · Start 113 · End 130 · Evaluation 121 · Team 179 · Sherpa 117 · Evaluator · Created time · Effort · Bonus) |
| My | Board | By `status` option, hide empty groups | TL↑ Sherpa↑ Assignee↑ End↑ | Assignee **or** TL **or** Sherpa is me | Cards show Project name · Team · Evaluation · TL |
| done projects | Table | — | End date ↓ | Status **is option** `Done` | 13, `Team` is the first column (266) |
| superb projects | Table | — | — | Evaluation is `Superb` | 13, `Team` first column (192) |
| All Projects | Table | **`multi_select` Team**, hide empty groups | End date ↑ | — | 8 (`Status` first column 136) |
| My Timeline | Timeline | — | End date ↑ | TL is me (+ an empty Assignee condition) | Timeline keyed on `End date`, **side table on** (Project name 340 · Status 141 · Evaluation 200), zoom `quarter` |
| TL | Table | `person` TL, hide empty groups | End date ↑ | — | 12 (Project name 516 · TL 134 · Effort 100 · Assignee 562 …) ← `docs/target.html` is this view |
| TL Chart | **Chart** | See below | — | Status **is group** `In progress` | — |

Column **order and width differ per view** (same DB, but the first column varies between TL, Team, and Status). That is,
the order is held by **the view**, not the database.

Values common to all table views: **`table_frozen_column_index: -1` — no frozen column**
(verified: scrolling the original 500px horizontally moves the first column `TL`'s x from 270 → −126 along with it.
For a while we misread this value as "default = first column frozen" and had pinned the first column),
`table_subitem_toggle_column: "title"` (the sub-item toggle lives inside the title cell), `table_wrap: false`,
`subitem_filter_scope: "parents_and_subitems"`.

### TL Chart settings

```
type: column                      // vertical bars
dataConfig: groups_reducer
  groupBy:     person TL, manual order, hideEmptyGroups: false
  aggregation: sum(Effort)
  stackOptions: stack by title (ascending)
chartFormat:
  height: medium, mainSort: manual
  caption: "[ Only items in in-progress status are shown ]"  (display on; original caption is in Korean)
  axisShowDataLabels: true, axisHideEmptyGroups: false
filter: Status is group "In progress"
```

## What we need to build

All of items 1–7 below were implemented on 2026-08-06. See the commit at the end of each item.

1. ~~**Per-view column order**~~ ✅ `ff28c0d` — `ViewConfig.propertyOrder`. Dragging a column changes only that view's order
2. ~~**`multi_select` grouping**~~ ✅ `afd75f3` — rows with multiple values appear in every matching group
3. ~~**Hide empty groups**~~ ✅ `afd75f3` — per-view flag, on by default, toggled from the group menu
4. ~~**`status` option groups**~~ ✅ `b605902`, `017541f` — `optionGroups`, `group:<name>` filter, band labels on board columns
5. ~~**Chart view**~~ ✅ `72b0a74` — vertical bar, horizontal bar, line, donut; count/sum; stacking; data labels; caption; height
6. ~~**Timeline side table**~~ ✅ `7a20cd7` — month/quarter/year zoom, bars spanning the window, side table
7. ~~**Add-row wording**~~ ✅ `f368b85` — `databases.item_name` ("project"); every add button uses this name

Other things that surfaced along the way were fixed too:

- **Full-page database description** ✅ `ddef3b8` — 800 characters of prose under the title. The column and API existed but there was no rendering
- **Row height** ✅ `f368b85` — the original is 37px no matter what the value is (`table_wrap: false`). Ours grew up to 61px
- **Removed the leading empty cell** ✅ `5804c85` — the checkbox hangs in the margin outside the table (`-36px`)
- **Frozen column follows the view setting** ✅ — `frozenColumnIndex` (default -1 = none frozen). Only a zero-width
  anchor holding the checkbox remains on the left (the original does the same)
- **Horizontal scrollbar** ✅ — pinned to the bottom of the screen, with a custom-drawn track and thumb (this browser's
  overlay scrollbar only appears while scrolling, so you couldn't tell the table extended further sideways)
- **Row icons** ✅ — digging into the original, the rule is not "the DB icon follows live."
  **Each row's own page carries `format.page_icon`**: of 100 rows in Projects, 99 are
  `/icons/iterate_blue.svg` (= the DB icon), and 1 was individually changed to `/icons/anchor_blue.svg`.
  So **the DB icon is copied when a row is created and can be changed per row afterwards** — which is why it doesn't
  carry over to sub-documents created inside that document. Checked against other DBs: rows of `Master` (🎖) show the
  generic page glyph, and rows of `Modulabs maintenance` have no icon. There is also a **per-view `show_page_icon`
  toggle**, which the original turns off in `My`, `All Projects`, and `My Timeline`.
  We mirrored the view toggle (`showPageIcon`) as-is, and since rows can't yet hold their own icon, we use the
  DB (= full-page page) icon instead. Once row↔page is wired up, switch to row-icon-first
- **Multiple people** ✅ `fc6bd1d` — `Assignee` holds multiple people and truncates when it overflows
- **View tab ids** ✅ `b605902` — keys were based on type, so the 4 table views collided. The overflow label is now `N more` too

### Cell hover actions (measured on the original, 2026-08-06)

Hovering a row always shows **`Open` in the title cell** (aria-label `Open in side peek`, 51×20), and **the cell in the
column currently under the pointer** gets that type's actions. 7px from the right edge, buttons 24×20.
**Nothing appears on cells with no value.**

| Property type | On hover |
|---|---|
| `title` | `Open` + page icon (22×22) + comment count badge (34×20, always shown) |
| `person`·`status`·`select`·`multi_select` | `Comment` |
| `date` | `Comment` + `Copy to clipboard` |
| `number` | `Comment` + `Copy to clipboard` |
| `created_time` (read-only) | **Only `Copy to clipboard`** — no comment |
| Empty cell | (none) |

Our implementation: the layout above is applied **only to the measured types**. `Copy to clipboard` really works;
`Comment` is disabled because there are no cell comments (the reason is in the tooltip).

**Types not yet measured — not implemented** (nothing appears on hover):
`text` · `url` · `email` · `phone` · `checkbox` · `files` · `relation` · `rollup` · `formula` ·
`last_edited_time` · `created_by` · `last_edited_by`.
In the original Projects these types had no values in the visible rows (they are trailing columns, so horizontal
scrolling was also needed), and we couldn't find cells with values. We don't add them by guesswork — we did that once
and created buttons that don't exist on the cell.

**How to re-measure**: Notion tables keep **only the 5 visible cells** per row in the DOM. Changing only `scrollLeft`
doesn't trigger virtualization, so trailing columns aren't drawn — after changing `scrollLeft`, dispatch
`new Event('scroll', { bubbles: true })` on that scroller to get them rendered. Then hover a row with a value and one
without, and read the visible buttons (`[role=button]`) inside the cell.

### Still remaining

- The **comment count badge** (`💬 3`) in the title cell — the original puts the `commentFilledSmall` svg and the
  count together inside the title cell. It overlaps with the row↔page work, so we left it alone
- **`Open comments`** on row hover
- Group header names are **buttons** in Notion (click to change the group value); ours are text
- Person avatar photos — our seed users have no photos, so initials are shown
- The **empty cell** state of the Status dropdown — all 249 rows in this view have values, so we couldn't open one
- ~~The Status dropdown's **dark theme**, and chip color values for colors other than gray/blue/red/yellow/green~~ — measured 2026-09-09.
  The 10 dark colors (background, text, swatch, ring) are in `src/i18n/content/e2e-fixtures/notion-chips.json` §colorsDark, the tokens
  are `--chip-*` in `globals.css`, and the comparison is `node e2e/chip-dark.check.mjs`. The dot is the same in both themes.
- **Original measurements for select / multi_select cell chips** — only status chips were measured. Cell chips were
  unified to the same shape as dropdown chips (below), but that unification is an *instruction*, not a measurement.
  In the original captures select chips have no dot, so the dot is only applied to status

## Loading the same data into dev

Comparison requires the same values, so the original was loaded as-is into dev's `ComCom > Projects`
(`cc027bcc-…`). The generator is `scratchpad/gen-seed.mjs`, with three input files:
`chunk.json` (schema, 8 views), `rows-normalized.json` (249 rows — fetched with `queryCollection`, with Notion rich
text normalized to values), and `notion-users.json` (24 people).

- 23 properties, 249 rows, 8 views, 24 users. Ids are sha1 hashes of names/Notion ids, so **re-running yields the same ids**
- Of Notion's 24 people, the 21 who weren't in dev were **created as dev-only users** (no `email`/`google_sub` →
  can't log in). The purpose is to make names visible; they exist only in the dev DB
- To reload: `node gen-seed.mjs && psql -f seed.sql`, and for the description, `desc.sql`

## Status dropdown — compared against the original (2026-08-06)

These are values actually measured by opening a Status cell with a value; the same numbers are in
`app/src/i18n/content/e2e-fixtures/notion-status-dropdown.json`.
`node app/e2e/status-dropdown.check.mjs` re-measures ours and compares it against this file
(on mismatch it prints everything as `ours x / notion y` and exits 1).

- Box: 240×376, radius 6, white background, **covers the cell** (−1,−1 relative to the cell's top-left). Ours was a
  176px box attached below the cell
- Top bar: 240×39, `rgba(242,241,238,.6)`, selected-value chip + search input (14px)
- Groups: label 12px/500 `rgb(125,122,117)` x=12, a 1px divider between groups (x=12 w=216
  `rgba(42,28,0,.07)`); since the UI is Korean, the names are the ko-dictionary labels for **To-do / In progress / Complete**
- Option rows: 232×28 x=4 radius 6; chip is a pill at x=12 (radius 10, height 20, 8px dot, 14px label)
- Bottom: divider + a 36px row with a sliders icon (20px, x=12) + `Edit property` (x=40, 14px)
- While searching, **group labels disappear** and only results appear, 4px lower. If nothing matches, only the bar and
  `Edit property` remain — **it does not offer to create an option**
- Things the original **doesn't have**: a `Clear` row (hovering a chip shows no ✕), and a per-option group `<select>`
  (we invented it). Both were removed
- The highlight (hover/keyboard) background is `rgba(33,27,23,.051)`, and **no row is highlighted before searching**

## Edit property (Status) — compared against the original (2026-08-10)

What the `Edit property` footer of the Status menu opens is **a sidebar, not a popover**: it docks below the view
toolbar (`top = toolbar bottom`), the right edge of its 290px menu column aligns with the right edge of the toolbar
control (New), and only the white background bleeds to the right/bottom edges of the window.
(The original raw value is −387, but Notion's toolbar node includes the page's 96px right margin — the sidebar
bleeds via `inset -96 / padding 96`. Our `db-view-bar` ends at the button, so the same rule gives −291 = 290 + 1px
border. We first copied −387 verbatim, which left ~100px of dead space to the right of the column.) White background,
no shadow, 1px left border (the top 12px fades into the background), 200ms slide-in.
Original values are in `app/src/i18n/content/e2e-fixtures/notion-status-edit-property.json`, the comparison is
`node app/e2e/status-edit-property.check.mjs`, and the implementation is
`components/database/property-edit-panel.tsx`.

- Header 50px: ← / `Edit property` (14px/600, x=43) / ✕ (20px circle, bg `rgba(42,28,0,.07)`)
- Name row: type icon 28×28 (1px border) + input box 215×28 (bg `rgba(66,35,3,.03)`,
  ring `rgba(28,19,1,.11)`, radius 6, ⓘ)
- `Type · Status ›` row — **display only** (there is no type-change menu yet)
- Group label (12px/500 `rgb(125,122,117)`, x=21) + `+` on the right (20px). `+` creates an inline input under the
  label (placeholder `Type a new option`, blue ring) and Enter adds it **at the top of the group**
- Option rows 259×28 x=9: ⠿ (16px, drag to reorder within/between groups) · chip (x=43) · on the default option,
  `Default` (12px/500, right edge 238) · › (x=244). The label→row gap is 9px for the first group only, 8px for the rest
  (original 166/232/298 — not evenly spaced)
- Fixed footer at the bottom: 1px divider (x=17, w=258) + 4 rows (274×28) — Wrap content (30×18 switch, only saved to
  `config.wrapContent`) · Show as: Select › (no menu yet) · Duplicate property · Delete property
- **Option menu** (click a row): 220px, radius 10, anchored at the clicked x−1; if there's no room below, it opens
  **upward** with its bottom aligned to the row top. Name input (select-all) / Delete / Set as default /
  Group → 250px group list (current group ✓, aligned to the row's bottom and right edge) / `Color`: **Default + 9 colors**
  swatches (18×18, radius 4) + a ✓ on the current color (x=192)
- **Beware of color names**: Notion **stores `default` and `gray` as different colors** (Team in the fixture has both).
  Today the chips are painted identically (the measurements match), but the color menu has two rows, Default and Gray,
  and the ✓ follows the stored name — so we promoted `default` to a palette key and migrated the dev DB
  (`scratchpad/migrate-default-color.mjs`). It is also a measured fact that only the `Default` swatch
  (`rgba(42,28,0,.07)`) differs from the chip background
- The status `defaultOptionId` (default option) is filled in automatically when a new row is created
- Escape closes one layer at a time: group list → option menu → (inline input) → panel

## Chips are a single component

Only `OptionChip` in `components/database/option-chip.tsx` is used. Cells, the Status menu,
board column headers, filter chips, and list/gallery/calendar values all call it.

The shape is **the chip measured in the Status dropdown** — height 20, radius 10 (pill), padding 7/9,
14px label, and for status an 8px dot before the label (5px gap). Colors use the five measured ones
(gray/blue/red/yellow/green); the remaining four haven't been measured yet and fall back to the existing
`OPTION_COLORS` classes.

At one point there was a separate cell chip (12px rectangle) and menu chip (20px pill), so the same value looked two
different ways on screen. `node app/e2e/chip-consistency.check.mjs` **measures the same value once in a cell and once
in the menu and compares them** (height, radius, background, padding, dot size/color/gap, label size/color/line height),
and as a bonus checks that the shape matches the Notion fixture. If they diverge it prints `cell x / menu y` and exits 1.

## Person picker — compared against the original (2026-08-06)

Measured by opening three: TL (250px cell) · Sherpa (117px **empty** cell) · Assignee (469px cell).
The same numbers are in `app/src/i18n/content/e2e-fixtures/notion-person-picker.json`; the comparison is
`node app/e2e/person-picker.check.mjs`.

- Width is **not** the cell width: `max(240, cell width)`. Even a 117px cell gives 240 (ours was 220)
- Height is **always 333**, with the list scrolling inside. Covers the cell (−1,−1), radius 6
- Top bar: `rgba(242,241,238,.6)`, radius 6, grows up to 240 and then scrolls.
  Height **39** for an empty cell, **63** for one line
- Selected people in the bar: **no chip background**. Avatar 20 → 6px → name **14px** → 2px →
  `Remove item` button 20×20 (icon 12). Line spacing 24, first line y=9, bottom padding 10.
  The input takes the remaining space (height 20, 14px)
- Label `Select as many as you like`: x=12, 12px/500, 10px below the bar
- Candidate rows: x=4, height 28, spacing **29**, avatar 20@x12, name 14px@x40, 9px below the label
- For yourself, `(me)` directly after the name

What we had wrong: minimum width 220, position +1/+4, radius 8, no gray bar, selected people as gray chips with 12px
text, the search box on a separate line below the chips, the label at 11px with x=1.

## Row controls and horizontal scrolling (2026-08-06)

Measured by hovering a row at scroll positions 0 / 400 / 1250
(`app/src/i18n/content/e2e-fixtures/notion-row-gutter.json`, comparison `node app/e2e/row-gutter.check.mjs`).

- Before scrolling: the controls sit in the table's left margin — ⠿ at **−62** from the row start, the checkbox at **−26**
  (the original order from the left is `+`, `⠿`, `☐`. We don't have `+`)
- After scrolling: the controls stick to the scroller's left edge. **Only the checkbox stays at scroller+11**
  (slightly overlapping the cell — the original does too), and **⠿ moves outside the scroller** and is not visible
- What we had wrong: with `sticky left-0`, the controls were **pinned to the table's left edge**, and when scrolling
  the cell contents flowed underneath, putting the checkbox on top of the name
- The original's aria-labels (we use them as-is, via the ko dictionary): ⠿ is `Drag to move, click to open menu`,
  `+` is `Click to add a block below, Option + click to add above.`,
  and the checkbox has **no label** (we keep `Select row` for accessibility)
- How it was fixed: a sticky child sticks to the scrollport's **content box** (= inset by the full-bleed padding).
  So giving the anchor `left` = `37px − the table's left inset` (`--db-inset`, written by `useFullBleed`) makes it
  follow the row when not stuck, and stand at scroller+37 when stuck, reproducing the values above exactly

## View tab row and toolbar (2026-08-06)

The single row above the table. The left side is view tabs, the right side is the toolbar (measured in a 1200×870
window, `app/src/i18n/content/e2e-fixtures/notion-view-bar.json`, comparison `node app/e2e/view-bar.check.mjs`).

- Active tab: a **pill**, height 32, radius 20, background `rgba(33,27,23,.05)`, inner padding 12,
  icon 20, gap 6, label **14px/500** `rgb(44,44,43)`. There is **no** `⋯` inside the tab
- Inactive tab: no background, same size, label color `rgb(125,122,117)`
- Overflow: `N more` pill, height 32, 14px/400, **no caret**
- Toolbar: **six 28×28 icon buttons** (radius 6, icon 16, 28px spacing) —
  Filter · Sort · Automations · AI autofill · Search · Settings. **No count badges**;
  the active state is shown not by a background but by **the icon turning blue** (`rgb(39,131,222)`)
- Primary button: the `New` **split button** 80×28 + caret 24×28, radius 6,
  background `rgb(39,131,222)`. (The group's add-row is `New project` — don't confuse the two)

Behavior observed by clicking:

- **Filter/Sort** → a chip bar **toggles** below the tab row: `↑ End date ⌄` ·
  `Status: In progress,Needs… ⌄` · `+ Filter`, and the button keeps a pressed state.
  Ours shows this bar **always** (not fixed yet)
- **Automations** / **AI autofill** → a 483×642 panel
- **Clicking the active tab** → that view's menu
- Not measured: the **Search** and **Settings** panels (clicking didn't let us capture the panel), tab menu items, hover states

What we still lack: of the six toolbar buttons, Automations, AI autofill, and Search (we have 3 + `⋯`),
and the caret menu (templates).

## The table's right edge (2026-08-06)

Scrolling the original all the way to the right leaves a `+` column (56px) and **the page margin** after the last column
(with a 1443 window, the last column's right edge is 1617 and the scroller content's right edge is 1713 → **96px**).
Our table had no right margin at all and ended flush against the window edge, which is why it felt like "you can't
scroll to the end" — there was no end.

`useFullBleed` now applies the inset it used to put only on the left **on the right as well** (currently 104px).
The comparison is `node app/e2e/table-right-edge.check.mjs` — it checks that you can scroll to the end, that the last
column isn't clipped, and that the page margin after the table is 96±16. We didn't chase the 8px difference between the
original's 96 and our 104 (the left inset is also 104).

## Title cell — hover · click · open (2026-08-06)

`app/src/i18n/content/e2e-fixtures/notion-title-cell.json`, comparison `node app/e2e/title-open.check.mjs`.

- On hover, a **white pad 55×24** appears 5px in from the cell's right edge (radius 6, padding 2,
  3-layer shadow `rgba(25,25,25,.027) 0 8px 12px` + `0 2px 6px` + `rgba(42,28,0,.07) 0 0 0 1px`),
  containing a **51×20 button** (radius 4, padding 0 4, gap 6). Icon 15px
  `rgb(142,139,134)`, label `Open` **12px/500** `rgb(125,122,117)`,
  aria-label `Open in side peek`
- **Clicking the title text edits it right in the cell** (contenteditable). The page does not open
- **Clicking Open** shows the right-docked side peek (in that window x=1128 w=600, full height)
- The cell itself: padding `7.5px 8px`, icon 20px, title 14px

What we had wrong: it was an 11px bordered chip, and above all **it didn't appear on hover at all** —
the button watched `group-hover/dbcell`, but the title cell declares `group/titlecell`.
Moreover, `Open` is a button belonging to the **row**, not the cell (in the original it appears wherever you hover on the row).
Also noting why `db-hover-scope.check.mjs` didn't catch this: it read the opacity of the button's parent (the cell)
rather than the button — the cell is always 1.

## Sidebar page rows (2026-08-06)

`app/src/i18n/content/e2e-fixtures/notion-sidebar-row.json`, comparison `node app/e2e/sidebar-row.check.mjs`.

- On hover there are only **three** buttons (each 20×20, radius 4): `Open` (expand arrow, icon 12 —
  normally in the page icon's spot) · `Delete, duplicate, and more…` (⋯, icon 16) · `Add a page inside` (+, icon 16)
- **There is no six-dot handle.** Reordering is done by dragging the row itself → we also removed the handle and
  attached dragging to the row (drags starting on a button/input inside the row don't count)
- Our bug: the actions were only shown via `group-hover:flex`, so the moment the pointer moved to the ⋯ menu,
  the trigger became `display:none`, **the CSS anchor vanished and the menu collapsed** — you couldn't click any item.
  While the menu is open, the actions stay laid out

## Things we measured wrong — written down so we don't repeat them

Every one of these was actually gotten wrong once, and each comes with "how to check it."

1. **`scrollIntoView()` also scrolls horizontally.** After calling it to bring the table on screen, we read coordinates
   and mistook the table's left edge as being 104px further left, then changed the layout based on that value and
   broke the start position.
   → Reset with `scroller.scrollLeft = 0` before measuring, and move only vertically.
2. **Notion tables keep only the 5 visible cells per row in the DOM.** Worse, changing only `scrollLeft` doesn't
   trigger virtualization, so trailing columns never get drawn. → After changing `scrollLeft`, call
   `dispatchEvent(new Event('scroll', { bubbles: true }))` on that scroller.
3. **In the DOM ≠ visible on screen.** We concluded "every cell has buttons attached" from
   `cell.querySelectorAll('button')`, but they were actually drawn at the row's right end (2,900px away). → Measure
   **coordinates**, not attachment: `cellRect.right - buttonRect.right`.
4. **`absolute` looks for a positioned ancestor.** If the cell has no `relative`, the row becomes the reference. Only the
   title cell was `relative`, so only `Open` appeared correctly.
5. **Portals are outside the ref.** After moving the popover with `createPortal`, the outside-click detection still
   only checked `ref`, so pressing inside the popover closed it on mousedown and the click never arrived (the reason
   person selection didn't work). → Check the portal node's ref too.
6. **"No change on hover" was a conclusion from looking only at the background color.** Notion doesn't paint the row;
   instead it shows **buttons**. → Count the `[role=button]` elements visible at that moment, not just background/border.
7. **Geometry varies with width.** When the page is centered with `max-width + mx-auto`, the start position shifts as
   the window widens. We checked only in a narrow window and said "fixed" three times. → Measure at at least 3 widths
   (1200/1600/2400).
8. **Cells with values and empty cells have different UI.** Hovering an empty cell shows nothing. → Look at both cases.
9. **Hover affordances have a "scope," and the scope is only visible by looking at what is *not* lit up, not what is.**
   Comments belong to **the single cell** under the pointer, Open to **the whole row**, but both were hung on the row's
   hover group (`group-hover/dbrow`), so hovering any cell showed comment buttons on every cell in that row.
   The cell I checked was always correct (the button was there, in the right position), so it passed no matter how
   many times I measured.
   → When measuring hover states, read **the hovered element and its non-hovered siblings together at the same moment**.
   `e2e/db-hover-scope.check.mjs` checks this automatically (hover each cell → is the list of lit cells just itself,
   and does Open stay lit). Commit e94e05f hit the same kind of leak (`group-hover/block` lighting up ancestors too) —
   remember that group hover applies to **all ancestors**.

## Rules for not touching the original

- Operations are limited to **read-only API calls**, hover, and switching view tabs. No cell clicks, row additions,
  column drags, or settings changes
- **"Click an empty area to close a menu" is forbidden.** We did that once and the user's tab navigated to the library.
  Close menus only with `Escape`
- The connection path is `scratchpad/cdp-lib.mjs` — it attaches to Chrome on the user's Mac (port 9333) via an ssh reverse tunnel
