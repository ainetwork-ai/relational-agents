# Attaching to the original (Notion) — copy-paste ready

The standard for Projects page work is **zero difference from the original**. So if you cannot see the original,
that is not "proceed anyway" — it is **stop work**. Below is the whole attach procedure, and every
command written here has actually been run (2026-08-06).

## 0. Do this first (on the server)

```bash
cd app && node e2e/golden.check.mjs
```

- **exit 0** → you can measure. Start working.
- **exit 1** → cannot attach. **Do not touch UI code**; ask a human to do steps 1 and 2 below.
  (The script prints the exact commands to ask for.)

This script checks not only the tunnel but also **whether the tab responds to JS execution**. It has really
happened that a tab looked fine while its renderer was frozen and `Runtime.evaluate` never returned
(in that case it prints a `✗` stalled marker).

## 1. Chrome on the Mac (terminal A, leave it running)

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9333 --user-data-dir=/tmp/cdp4
```

- `--user-data-dir` must be **a folder separate from your usual profile**. Otherwise it just attaches to the
  already-running Chrome and `--remote-debugging-port` is silently ignored.
- If you keep using the same folder, the Notion login persists. If the folder was deleted, you must log in to
  Notion once in that window (it is SSO, so a human has to do it).
- `bind() failed: Address already in use` → a Chrome using that port already exists. Use it, or
  launch on a different port and change the tunnel port below to match.
- **Do not hide the logs** (no `>/dev/null`). Success means `DevTools listening on ws://127.0.0.1:9333/...`
  appears, and failure causes are printed there too.

## 2. Reverse tunnel from the Mac (terminal B, leave it running)

```
ssh -R 9333:127.0.0.1:9333 comcom@192.168.1.194
```

It must be **a different window** from the terminal that launched Chrome, and the tunnel lives only while this
ssh session is open. If the Mac sleeps or the window is closed, it drops silently — which is why you run step 0 every time.

## 3. Rules when handling the original

The original is real company data. **Do not change it.**

- Allowed: scrolling, hovering, clicking a cell to open a menu, typing in a search box (it only filters),
  reading coordinates and computed styles, screenshots, switching view tabs.
- Not allowed: **selecting** an option/person, adding or deleting rows, dragging, editing values, closing a
  menu by clicking empty space (once this navigated the page — close with **Escape**).
- If you opened a menu, measure and then close it with **Escape**.

## 4. Code for attaching and measuring

- Connection helper: `scratchpad/cdp-lib.mjs` (`attach()` → `ev/rect/click/key/shot/dom`).
  Playwright's `connectOverCDP` fails with this Chrome (150) — use raw CDP.
- Pitfalls when measuring are in **"Things we got wrong while measuring"** in `docs/notion-projects-spec.md`.
  In particular: `scrollIntoView()` also scrolls horizontally · the Notion table keeps only the 5 visible cells in the DOM
  (changing only `scrollLeft` does not render them) · for hover, you must also read **the siblings that did not light up**.
- **Dark theme** is measured without changing workspace settings (changing them turns other sessions' tabs dark too).
  Create **your own tab in a new window** with `Target.createTarget({newWindow:true})`, and in that CDP session run
  `Emulation.setEmulatedMedia({features:[{name:'prefers-color-scheme',value:'dark'}]})` — Notion
  follows the system setting, so only that tab goes dark (2026-09-09, `scratchpad/dark-colormenu.mjs`). Watch out:
  (1) the emulation is lost if the session disconnects — measure everything in one connection. (2) Notion caches the result in
  `localStorage.theme`, so when done, set it back to `light` and verify. (3) If your window is **completely covered by another window**,
  it becomes `visibilityState: hidden` and `Input.dispatchMouseEvent` never returns —
  use `Browser.setWindowBounds` to leave a strip that does not overlap the other window, and do not fully cover the other window either.
- Put measured values in `app/src/i18n/content/e2e-fixtures/*.json`, and alongside them an `app/e2e/*.check.mjs` that measures our side
  the same way and compares. The evidence for "fixed" is that script's exit 0.
- Expected Korean UI strings used by these scripts are being moved into `app/src/i18n/content/` modules; the
  Korean labels they compare against are the corresponding entries in the ko dictionary (`app/src/i18n/ko.ts`).

## 5. Comparison scripts that exist now

| Command | What it compares |
|---|---|
| `node e2e/golden.check.mjs` | Whether we can attach to the original (run before anything else) |
| `node e2e/person-picker.check.mjs` | Person picker box·bar·selected items·labels·candidate rows |
| `node e2e/status-dropdown.check.mjs` | Status cell menu box·bar·chips·groups·dividers·footer·both search variants |
| `node e2e/status-edit-property.check.mjs` | Edit-property sidebar (docking·header·groups·options·footer), option/group menus, Esc steps |
| `node e2e/chip-consistency.check.mjs` | Whether chips for the same value look the same in cells and menus |
| `node e2e/chip-dark.check.mjs` | In both light and dark themes, background·text·dot of the 10 chip colors, and the swatches·rings of the edit-property color menu, match the original values |
| `node e2e/indent.check.mjs` | All of indentation (nesting) — Tab/Shift+Tab (single·block selection·text selection), whether Enter inherits depth and takes children along, Enter on an empty list item, the steps of Backspace at the start (list formatting → depth → merge), promoting children, rejected Tab, Tab inside code = tab character, caret preservation, persistence after reload (expected values in `docs/notion-indent.md`) |
| `node e2e/indent.measure.mjs` | The same scenarios as above, **measure only** (records our app's current behavior) |
| `node e2e/view-columns.check.mjs` | Table column order and 13 widths |
| `node e2e/table-right-edge.check.mjs` | Trailing space after the table when scrolled all the way |
| `node e2e/view-bar.check.mjs` | View tab row and toolbar (pill tabs·28×28 icons·split button) |
| `node e2e/row-gutter.check.mjs` | Where row controls (checkbox·⠿) stick during horizontal scroll |
| `node e2e/title-open.check.mjs` | The `Open` button on title cell hover |
| `node e2e/db-hover-scope.check.mjs` | Whether only the one cell under the pointer lights up on hover |
| `node e2e/sidebar-row.check.mjs` | Sidebar row hover buttons and the ⋯ menu |
| `node e2e/db-page-header.check.mjs` | Full-page DB header: cover height (20vh)·control row·icon+title on one line·description position |
| `node e2e/rules-row.check.mjs` | Rules row under the tabs: whether the filter button collapses/expands it (pressed box)·24px chips·divider·+ Filter |
| `node e2e/sidebar-width.check.mjs` | Sidebar width with no saved width (270) and the body start x |
| `node e2e/row-comment-badge.check.mjs` | Badge on the title cell of rows with comments (height 20·icon 16·5 after the title·absent at 0) |
| `node e2e/row-comment-popover.check.mjs` | The 480px popover that badge opens — centered on the badge, avatar 24/name 15.5/body 38 |
| `ROW_PAGE_ID=… node e2e/page-comments-inline.check.mjs` | The `Comments` section inside a page — no inner scroll, one entry 64, mentions are not chips, no docked panel |
| `node e2e/mention.check.mjs` | Mentions (@) in comments — open/close conditions (only a space right after `@` cancels; spaces inside the query are kept), person search (name+email substring·case-insensitive·Korean initial consonants) and ordering (start > word start > middle, me first, guests last), modal 330×325/row 322×28/avatar 20@8/section head 12px·500, `Show N more results`, `No results` 330×65, picking inserts `@name ` + two Backspaces remove it whole, Enter does not send while the menu is open (expected values in `docs/notion-comment-mention.md`) |
| `ROW_PAGE_ID=… node e2e/comment-collapse.check.mjs` | The rule that comments collapse from 4 onward — only the first and last remain, plus `Show (total−2) more replies` |
| `node e2e/ime-enter.check.mjs` | Whether Enter during Korean IME composition does not send the comment (1 item after composition commits) |
| `ROW_PAGE_ID=… node e2e/comment-attachment.check.mjs` | Comment paperclip — multi-select file dialog with no extension limits, chips, sending with files only, storage·rendering |
| `node e2e/notion-paste.check.mjs` | Notion copy-all → paste (callouts·toggles·bold runs·checks·nesting·through to storage) |
| `node e2e/peek-inset.check.mjs` | Width rule of the row peek (side page) and the 76px content margin |
| `node e2e/table-block-menu.check.mjs` | The ⠿ (gutter handle) menu of a table block: the `Table` group that appears only on table blocks, whether the `Header row`/`Header column` switches (30×18) each toggle their own axis, whether our added `Sort` (whole table) is shown and persisted |
| `node e2e/table-grip.check.mjs` | Table row/column grips: rules for when the gray line (18×2) lights up (top-left cell of the selection + hovered cell), 6-dot button on hover (22×14 / 14×22), click selects the whole row/column + blue button + dropdown (265 wide·items 28), drag to move rows/columns (ghost 0.9 + 3px blue indicator line), dropdown UI (265×radius 10·3-layer shadow·search row·icon 20@8·label@36·header-row switch 30×18·⌘D·color arrow) and the `Color` submenu (220 wide·swatches 26·10 text + 10 background), header toggle (only on first-row·first-column grips; the column grip toggles the header **column**), and the sort item that is **not in the original** (§menu.ours — do not delete) |
| `node e2e/table-cellnav.check.mjs` | Caret movement inside a table block (arrow keys·Tab, line in cell → cell above/below → out of the table) and cell range selection (drag·Shift+arrows·Escape), blue border 2px/rgb(39,131,222)·right-edge handle 6×12, dragging inside a cell = text selection + formatting toolbar |
| `node e2e/block-spacing.check.mjs` | Vertical spacing of basic blocks (paragraph 6/6, H1·H2·H3 top 30/26/22), first-list-item rule, gutter (+ −52, 6-dot −28, centered on the first line), 6-dot click highlight (2px inset·lists 1px), divider·code·callout structure — creates its own page, 551 checks |
| `node e2e/plus-menu.check.mjs` | Gutter `+`: on a line with content, an empty line below; on an empty line, the type menu on that line — no "/", caret at start, filter placeholder pill, menu 324×396.8·gap 8·items 32·footer 42 |
| `node e2e/row-props.check.mjs` | The property block on row pages — both side peek and full page: title (32/38.4 · 40/48) → `Show details` (28, peek only on hover) → pinned property band (label 24 · value 30 · min 80/max 200 · gap 8 · 32px scroll arrows) → comments (24, divider) → body (8); the 300px menu when clicking a value (cell -1/-1, items 28); full-page details sidebar 385; in the peek, details adds a 280 panel and the peek widens left by that much (capped at window−400) |
| `node e2e/band-props.check.mjs` | **What appears** in the pinned property band — same set and order across rows (empty values keep their slot), multiple people show 1 chip + `+ N` (value height 31), whether item width clamp(max(label, value), 80, 200) is independent of window width and surface, arrows (only on overflow·clientW−200 per step), whether peek and full page follow the same rule |
| `node e2e/prop-label-menu.check.mjs` | The menu that appears **when clicking a property label** — the band version (220×168: Rename·Edit property·Comment ǀ Delete property ǀ Layout) and the panel version (220×197: Rename·Edit property ǀ Property visibility·Duplicate property·Delete property ǀ Layout) are different lists, the edit-property popover (290×253), the property-visibility submenu (180×94) |
| `node e2e/row-props-live.check.mjs` | Whether changing Evaluation on the full page reaches the peek·table cell in another window, and changing it in the peek reaches the full page in another window, without a refresh (changes one dev row and reverts it) |
| `pnpm check:dismiss` | Whether portal popovers hand-roll their own outside-click detection |
| `node e2e/save-protocol.check.mjs` | Save protocol phases 1·2 (`docs/save-protocol-target.md` §7): one character on a 227-block Korean-text page → request ≤2KB·1 in flight, on a 2-block page input→fetch ≤50ms, 500ms batching after a response, 5 keystrokes offline → 5 IndexedDB entries·`Offline` badge·5.0s retry with the same id·0 after coming back, `/api/saveTransactions` responds `{}`·the same request twice → 1 block, closing a tab (online/offline) → a surviving tab adopts and sends within ≤20 seconds, edits·deletes from another tab arrive as SSE transactions without a GET — creates and deletes its own pages. `ONLY6=1` runs only the fan-out part |

`e2e/*.check.mjs` uses the dev server (3110) and the dev DB, and attaches with a session cookie it forges itself.

The dev DB was reseeded before 2026-08-27 — old scripts' default `PAGE_ID`/`USER_ID`
(`af7fc488…`/`0be606ed…`) no longer exist, so they land on the login screen and time out waiting for
`[data-cellnav]`. What exists now: Projects page `5722f40d-c3f6-4664-9bdb-5a24abe655cf`,
user hyeonjj `8ccf17a7-24fb-4ae9-974c-94bf5db0cf85`. Pass them as environment variables:

```bash
PAGE_ID=5722f40d-c3f6-4664-9bdb-5a24abe655cf USER_ID=8ccf17a7-24fb-4ae9-974c-94bf5db0cf85 node e2e/peek-inset.check.mjs
```
