# Notion's indentation (nesting) — measurements (2026-09-10)

Reference values for making our editor's Tab/Shift+Tab/Enter/Backspace nesting behavior match Notion.
All of it was measured by attaching the golden-set Chrome to `app.notion.com` and **pressing real keys**. Raw data is in
`scratchpad/nind-*.jsonl` (measurement scripts `scratchpad/nind-*.mjs`, helper `scratchpad/nindent-lib.mjs`).
The comparison is `node e2e/indent.check.mjs` — the tables in this document are that script's expected values.

Measurements were taken on **sub-pages I created myself**. The scratch page (`3c8d8655…`) is kept open by other
sessions too, so we don't type there. §9 below records the pitfalls hit along the way.

## 1. One-line summary — "once you indent, everything below stays indented"

| # | Situation | Notion | Ours before the fix |
|---|---|---|---|
| T1–T3 | Tab with the caret at the start, middle, or end — anywhere | The block moves in one level and **the caret stays on the same character** (no tab character) | It moved in, but the caret **jumped to the start** |
| T4 | Enter at the end of an indented block, repeatedly | New blocks keep appearing **at the same depth** | Same ✓ |
| T5 | Enter in an indented **empty paragraph** | It doesn't outdent. One more empty line at the same depth | Same ✓ |
| T5b | Enter in an indented **empty list item** | It **outdents one level and stays a list**. Enter again at depth 0 → paragraph | It turned into a paragraph at the same depth; you couldn't get out without Shift+Tab |
| T6 | Shift+Tab on a leaf | It comes out one level and sits **right after the former parent** | Same, but its position **collided** with the parent, so the order varied between runs |
| T6b | Shift+Tab on a middle child | **It takes the remaining following siblings as its own children** | The siblings stayed under the old parent and **the on-screen order was flipped** |
| T12 | Shift+Tab on a block with children | The children stay attached below and come out with it | Same (only the position problem) |
| T13 | **Enter at the end of a block with children** | The new block is created as the **immediately following sibling** and **the children move to the new block** | The new block was created **below** the subtree, at the parent's depth |
| T13b/c | Same situation in lists / nesting | Same rule | Same problem |
| T14/T14b | Enter in the middle of a block (split) | Both halves at the same depth. **Children go to the back half (the new block)** | The children stayed with the front half |
| T7/T7b | Backspace at the start of an indented **paragraph** | **It outdents one level** (one level at a time); at depth 0 it merges with the block above | It merged with the previous sibling (second child), or **nothing happened** (first child) |
| T7c | Backspace at the start of an indented **list item** | ① Only the bullet is dropped (depth kept) ② it outdents one level ③ it merges | Only ① was right; the rest didn't exist |
| T7d | Backspace at the start of an indented **heading** | ① It outdents one level (stays a heading) ② it merges with the block above | The heading turned into a paragraph first |
| T28 | Backspace at the start of a block with children (depth 0) | It merges with the block above and **the children move up to the top level, right after it** | The children were orphaned and **disappeared from the screen** (they were still saved) |
| T8/T26 | Tab on the first block, or on a first child | Nothing happens | Same ✓ |
| T15 | Tab/Shift+Tab with a **block (halo) selection** | **All** selected blocks move one level and **the selection is kept** | Nothing happened (Tab leaked to the browser and just moved focus) |
| T16/T16b | Tab with a **text selection spanning two blocks** | **All** spanned blocks move and **the selection stays as-is** | Only the block with the caret moved and the selection was lost |
| T23 | Tab **inside a code block** | A **tab character** is inserted (the block stays put) | The block was indented |
| T25 | Caret after Shift+Tab | Stays on the same character (offset 3 → 3) | Jumped to the start |

## 2. Which types can be indented / which accept children

- **Types that can be indented (T21)**: paragraph, heading 1/2/3, bulleted, numbered, to-do, toggle, quote — all of them.
  (A divider has no caret, so it can't be triggered by keys. In code, a tab character is inserted per T23.)
- **Types that accept children (T22)**: paragraph, bulleted, numbered, to-do, toggle, quote, callout.
  **Types that don't**: heading 1/2/3, code, divider — if the previous sibling is one of these, Tab does nothing.
  (Headings were confirmed twice: `heading1/enter_tab` in `cases-notion.json` on 2026-08-26, and T22 on 2026-09-10.)
- The rule is the same inside containers (T19 callout, T20 toggle): the block goes one more level in, under the previous sibling.

## 3. Geometry — how far each depth indents (applied)

Left x of the block box, measured per depth (1100px window, content width 566):

| Parent type | Per child level | Measured |
|---|---|---|
| Paragraph, heading, quote | **+30px** | 366 → 396 → 426 → … → 936 (constant up to depth 19, no cap) |
| Bulleted, numbered, to-do, toggle | **+32px** | 366 → 398 → 430 → 462 → 494 |
| Callout | The child's text is at **the same x** as the callout's text | Callout 366 (text 417) → child box 411 (text 417) |

- We used to draw a single **depth × 24px**. Now we branch on the parent type and use 30/32
  (`indentStep()` in `lib/editor/indent.ts`). The indent px flows into `BlockRow`'s `indentPx`,
  and the halo (`indentPx-4`) and gutter (`indentPx-58`) use the same value.
- A toggle's children sit **32px from the toggle box** (= the same x as the toggle's text). Previously, inside a box
  that already had padding, we added `(depth+1)*24` on top, so a toggle at depth 1 was off by 84px. Now the wrapper
  applies 32px and the children's indentation restarts from 0 relative to that wrapper (callouts work the same way).
- List **markers change with depth** — the cycle is 3, counted by **the number of list ancestors of the same kind**
  (a bullet indented under a paragraph was still `•` — T21):

| Depth | Bulleted | Numbered |
|---|---|---|
| 0 | `•` | `1.` `2.` |
| 1 | `◦` | `a.` `b.` |
| 2 | `▪` | `i.` `ii.` |
| 3 | `•` (3-level cycle) | `1.` (3-level cycle) |

  Implemented in `lib/editor/list-markers.ts` + `listLevel()`. We couldn't measure what the cycle counts in mixed
  nesting (numbered under bulleted, etc.), so we left it on the same-kind-only model.

## 4. What we verified in saving and sync

- Indentation changes two fields together: `parentBlockId` + `position`. Our SSE apply step dropped
  `position`, so **in other tabs only the parent changed and the order stayed stale** → fixed.
- The new position for an outdent was computed **after changing the parent**, yielding the same value as the parent →
  sibling order was left to `Array.sort`'s tie handling, and the same input was drawn in two different orders.
  Now we **renumber the moved sibling list as integers 1..n** (which also prevents floating-point collapse).
- Nobody reattached the children of a block deleted by a merge, so they became **orphans**. Roots are gathered only by
  `parentBlockId === null`, so orphans aren't rendered = they vanish from the screen but remain in storage
  → per T28, they are lifted into the deleted block's place.

## 5. The rules we applied and their code

| Rule | Code |
|---|---|
| Indent/outdent tree surgery, sibling adoption, renumbering | `app/src/lib/editor/indent.ts` |
| Tab/Shift+Tab (single, block selection, text selection) | `block-editor.tsx` `nest()` |
| Enter hands children over to the new block | `block-editor.tsx` `splitBlock` + `moveChildren` |
| Enter on an empty list item → outdent one level | `block-editor.tsx` `splitBlock` |
| Backspace-at-start order (list style → depth → merge) | `block-editor.tsx` `handleBackspaceAtStart` |
| Lift children on merge | `indent.ts` `liftChildren` |
| Tab in a code block = tab character | `block-editor.tsx` `onKeyDown` |
| Keep the caret after the depth changes | `block-row.tsx` text sync moved to `useLayoutEffect` + `block-editor.tsx` pendingFocus retry |
| Backspace-at-start policy (headings merge immediately, code does nothing, first block goes into the title) | `block-editor.tsx` `handleBackspaceAtStart` + `STYLE_DROP`, `page-view.tsx` `onMergeIntoTitle` |
| Reading Markdown indentation | `lib/memory-parse.ts` `parseMarkdown`·`parentIdsByDepth` |
| Writing Markdown indentation | `lib/memory-parse.ts` `blocksToMarkdown`·`treeOrder`, `lib/md-mirror.ts`, `lib/okf-store.ts` |

## 6. Backspace-at-start policy — measured per type (2026-09-10, round 2)

A block of each type placed under a paragraph named `PREV`, with Backspace pressed **at the very start**
(`scratchpad/nind-M1.jsonl` A_*), and the same block when it is **the first block on the page** (B_*).

| Block | 1st Backspace | 2nd | Ours (after the fix) |
|---|---|---|---|
| Paragraph | Merges with the block above | Deletes a character | Same |
| Heading 1/2/3 | **Merges with the block above** (does not drop the style) | Deletes a character | Same — previously it turned into a paragraph and needed one more press |
| Quote | Only drops the style (paragraph, in place) | Merges | Same |
| Bulleted, numbered, to-do, toggle | Only drops the style | Merges | Same |
| Code | **Nothing happens** | Nothing happens | Same — previously the code content was merged into the block above |
| (any type) when indented | Outdents one level (a heading stays a heading) | Per the rules above | Same |
| **First block on the page** (nothing above) | The text goes into the **page title** and the block disappears | — | Same — previously nothing happened |

First block → title was also confirmed via the URL: the measurement page's address changed to `…/YYYYYYYYYYYYYYY-3d7d8655…`
(the title was filled with that text). Surfaces without a title (row peek, shared view) don't get this behavior —
if `onMergeIntoTitle` isn't passed, it does nothing, as before.

## 7. Markdown indentation — coming in and going out (2026-09-10, round 2)

### Coming in (paste) — one level is "the parent marker's width"

| What was pasted | Notion | Ours (after the fix) |
|---|---|---|
| `- a` / `  - b` (2 spaces) | b one level below | Same |
| `- a` / `\t- b` (tab) | One level below | Same (tab = 4 spaces) |
| `1. a` / `  1. b` (2 spaces) | **Not nested** (the content of `1. ` starts at column 3) | Same |
| `1. a` / `   1. b` (3 spaces) | One level below | Same |
| `- [ ] a` / `  - [ ] b` (2 spaces) | One level below | Same |
| A **plain line** indented deeper than the list | A **child block** of that item | Same |
| Indented paragraphs with no list (no blank lines) | Merged into one block with line breaks | Same |
| A line indented 4 spaces **after a blank line** | **Indented code block** | Same |

The reading rules live in `parseMarkdown` (`lib/memory-parse.ts`), and the single place that converts depth to a
parent id is `parentIdsByDepth` — paste, AI insertion, MCP, and OKF files all use it.

### Going out (export) — 4 spaces only under lists

**Children of a non-list parent are not indented.** Notion does the same (measured in M6): copying a child paragraph
indented under a paragraph gives `PA⏎⏎PB` — the hierarchy simply disappears in Markdown. Exporting it indented would
instead turn it into a **code block** (M5: Notion reads a line indented 4 spaces after a blank line as indented code).
Notion puts a quote's children inside `> ` — we write them flat (the hierarchy is lost but the type doesn't change).

### Under lists — 4 spaces per level

The `text/plain` Notion produces when copying nesting (`scratchpad/nind-M3-clipboard.json`):

```
- b1
    - b2
        - b3

        pchild

- [ ]  t1
    - [ ]  t2
- T

    tkid
```

**4 spaces** per level, to-dos as `- [ ]  ` (**two spaces** after the box), and toggles are exported as **bullets**.
Blank lines are **not placed between list items**; one goes before and after each non-list block — carrying that
position's indentation (the 8-space and 4-space blank lines above). We write it **identically, down to the character**:
if we build the structure above out of our blocks and export it, it matches the string Notion copied exactly
(the check in `e2e/markdown-nesting.check.mjs` asserting that the exported Markdown is identical to the original down
to the character). So the **round trip** holds too — whether we read what Notion wrote or read what we wrote,
we get the same tree.

The three paths we fixed:
- `.md` download (`api/pages/[pageId]/export`) — it sorted by `position` alone, so children got mixed in among
  top-level blocks; now it uses `treeOrder()` for document order.
- md-mirror — the only branch that descended into children was for toggles, so children of paragraphs and bullets
  were **missing from the file**. Now every block recurses and gets 4 spaces per level. Toggles are written as bullets
  instead of `<details>`.
- OKF file store — the two functions that flattened everything to `parentBlockId: null` (`parsedToBlocks`,
  `blocksToParsed`) now translate depth ↔ parent id in both directions.

### 7-1. Things that corrupted content on a round trip (2026-09-10, round 3)

Markdown round-trip defects found in the audit. On OKF pages, where the file is the storage, each of these was a path
where **content changed after a single save → read**. Checks for all of them were added to
`e2e/markdown-nesting.check.mjs`.

| What | What used to happen | Now |
|---|---|---|
| A plain-text line directly under a list item | Became a separate paragraph | Folded into that item — Notion does the same (M2c: `1. num-B` + `para-A` + `para-B` are one item) |
| Line breaks inside an item | Were placed in that item's **marker column**, flattening all nesting below | Placed in the **content column**; lines that look like markers are escaped with `\` |
| Paragraphs that look like markers (`- x`, `# y`, `---`, `1. z`, lines starting with a pipe) | Came back as bullets, headings, dividers, numbered items, or tables | Written with a backslash like `\-` and stripped on read (CommonMark) |
| Line breaks inside a table cell | The row was cut there | Written as `<br>` and restored on read |
| Escaped pipes inside a table cell | The cell was split in two on read | Backslash-pipe is recognized and read as one cell |
| An entirely empty table row | Mistaken for the delimiter row and dropped | A delimiter row requires at least one dash |
| A paragraph with only one pipe | Read as a table and dropped | A table requires two or more pipes |
| Table column alignment | Dropped when exported to `.md` | Written as `:---:` / `---:` (the mirror already did this) |
| ``` inside a code body | The block closed there and the rest was lost | Opened with a fence one longer than the longest backtick run in the body |
| Code and equation bodies | Inline Markdown conversion ran and backticks became `<code>` | Those two types are left as-is |
| Mirror: children of a `100. ` item | At 4 spaces they came back as siblings | Indented by the marker width (5 spaces) |
| Mirror: callout icon | Always overwritten with 💡 | The block's own icon |
| Mirror: equations | Exported without `$$`, becoming paragraphs | Wrapped in `$$` |
| Mirror: sub-page links and files | Omitted entirely | Written as `[page](/p/…)` · `[name](url)` |

Left as-is: **empty paragraphs have no place in Markdown** (Notion also exports them as blank lines, and they vanish
when read back). On OKF pages, where the file is the storage, one empty line disappears per save/read cycle —
we chose to match Notion.

## 8. Other things uncovered in round 2 (fixed via review + measurement)

Defects that surfaced on the same code paths while fixing indentation. All were reproduced on dev and fixed.

| What | Symptom | Where it was fixed |
|---|---|---|
| **Paste lost the first line** | Pasting `A⏎⏎B` into an empty paragraph **made A disappear** (both on screen and in storage). Cases where the block type changed (heading, bullet) looked fine | Paste absorption in `block-editor.tsx` — in this codebase, when a program inserts text it must **also set `content.html`** (`block-diff.ts:190` builds character operations from the html). Setting only text was computed as "delete everything" |
| OKF file saves were flattened | Nesting was read from the file and shown as a staircase on screen, but saving erased the file's indentation | `transactions/apply.ts` wasn't passing `parentBlockId` |
| Nested code and equations grew 4 spaces per round trip | Indented on write but not stripped on read | `dedent` on fenced/`$$` bodies in `memory-parse.ts` |
| Line breaks within a block broke the hierarchy | The second line made with Shift+Enter was written at column 0, undoing all nesting after it | The writer indents continuation lines by the same amount |
| The mirror dropped blocks without a parent | If the parent row was gone or there was a cycle, the block was dropped from the file entirely (the .md route keeps them) | `md-mirror.ts` appends whatever it couldn't reach at the end |
| PDFs of file pages were flat | The `.md` and the editor for the same page showed a staircase, but only the PDF was flat | `export-pdf` translates depth → `parentBlockId` |
| Position collapse on long pastes | Each line took the midpoint, and the order broke down around line 54 | Renumber siblings as integers after pasting |
| Workspace export (zip) returned 500 | Overlapping mirror runs swapped out the whole directory, and at that moment the zip couldn't read files | Serialize `md-mirror` runs per workspace + clean up leftover `.tmp-*`; the zip skips files that have disappeared |
| Markdown starting with `---` | Mistaken for front matter, swallowing everything up to the next `---` | Front matter is not considered on paste (`noTitle`) |
| Empty bullet (`- `) | Read back as a paragraph containing `-` | Empty items are also lists |
| Screens without a title (row peek, shared) | With no title to merge into, Backspace became a dead key | On those screens it drops the style, as before |

## 8-1. Remaining differences (known and left)

- **Children of a non-list parent lose their hierarchy in Markdown** — Notion does the same (M6). On OKF pages, where
  the file is the storage, a paragraph's children become siblings after one save/read cycle.
- **Backspace on a callout's first child**: Notion merges it with the block before the callout and removes the callout.
  Our callout is a model that holds its own text, so the path differs — we drop the style.
- **Toggles become bullets when exported to Markdown** (Notion does the same). On OKF pages, where the file is the
  storage, a toggle turns into a bullet on every save/read cycle.
- When **merging the first block into the title**, the block deletion goes through the transaction queue (retries,
  offline guarantees), but the title goes out as a single page PATCH (that's how title editing already works). If that
  PATCH fails, the title stays on screen but the text disappears on reload — this is a property of title saving in
  general, so we didn't build a separate mechanism for it this time.

## 8-2. Folded toggles and "types that don't accept children" — round 3 measurements (2026-09-10)

Four items from the audit were re-measured against the original (scripts `scratchpad/nind-41-M7.mjs`,
`nind-49-M8.mjs`, `nind-54-M10.mjs`, raw data `scratchpad/nind-M7·M8·M9·M10.jsonl`).
Measurements were taken on **my own private page** created with the sidebar's `New page` button.

| # | Situation | Notion | Ours before the fix |
|---|---|---|---|
| M7 S2 | Tab when the previous sibling is a **folded toggle** | The toggle **unfolds** and the block becomes its last child | It went inside the folded toggle, **disappeared from the screen**, and the caret died (all typing afterwards was discarded) |
| M7 S1 | Enter at the **end** of a **folded toggle**'s title | A **sibling toggle** is created right below, and the hidden children stay inside the toggle | The hidden children moved to the new block, **spilling out the folded subtree** |
| M10 D1 | Enter in the **middle** of a **folded toggle**'s title | The toggle splits in two and the children stay with the **front** half | Same problem |
| M7 S3 | Shift+Tab on a type that doesn't accept children (heading) | It does **not adopt** following siblings — they stay under the old parent and the heading sits **after** that subtree | The heading adopted the siblings as children, producing a tree that Tab could never create |
| M8 S5 | Shift+Tab on a **folded toggle** | It **adopts** the following siblings (they're folded, so they aren't visible on screen) | — |

Applied: `unfold()` in `lib/editor/indent.ts` (Tab unfolds the receiving toggle) and the `NO_CHILDREN` adoption ban,
and `foldedToggle` in `block-editor.tsx` `splitBlock` (sibling toggle + children kept). The comparisons are
`tab_into_folded_toggle` · `enter_on_folded_toggle` · `shift_tab_heading_no_adopt` ·
`shift_tab_folded_toggle_adopts` in `node e2e/indent.check.mjs`.

One more thing: when counting the tree, Notion leaves behind an **empty shell
`<div class="notion-bulleted_list-block">` with an empty `innerHTML`** where a block moved out. It survives a reload,
so at first we misread it as "Shift+Tab creates an empty bullet" — nodes with `innerHTML === ""` must be filtered out
when reading the tree (a concrete instance of the rule also noted in §9).

## 8-3. The rest on the editor side (2026-09-10, round 3)

Things on the same code paths as indentation. These aren't things to measure in Notion but **defects on our side**,
so we reproduced and fixed them; the checks are in `e2e/indent.check.mjs` and `e2e/markdown-nesting.check.mjs`.

- **Enter positions stuck together around the 53rd press.** A new line takes the midpoint of the gap to the next
  sibling, and if that gap keeps getting halved, double-precision floats run out of room to divide further. At that
  point the midpoint is **rounded to one end of the gap** — sometimes to the block itself, and **sometimes to the next
  sibling**. Either way, two lines end up with the same position and the order is left to `Array.sort`'s tie handling.
  Now we check both ends and, on a hit, renumber that sibling list as integers 1..n.
  (Check `enter_many_positions_stay_distinct` — after 60 Enters, the last line is still last and all 62 positions are
  distinct. The first fix, which only checked the low end, was caught by this check: the 53rd Enter **landed exactly
  on top of the next block**.)
- **When Backspace deleted a preceding block that holds no text (divider, image, `column_list`)**, nobody reattached
  its children, so the entire subtree vanished from the screen (it remained in storage — the same shape as the orphans
  in §4). Now they are lifted into the deleted block's place.
- **Characters typed right after Enter were in the same undo group as the Enter**, so a single ⌘Z removed both the
  new line and what was typed on it. Typing is now grouped **only with other typing** (structural operations break the group).
- **Pasting into the middle of a block lost the formatting of the back half.** That was because we split at the caret
  as plain text. Now both halves are cloned as DOM ranges, so bold, italic, code, and links survive on both sides.
  (It's a clone — cutting it out as before would leave the block empty when the caret was at the start.)
- **Pasting at the start of a block with text** left an empty block above. Now the pasted content goes **above** that
  block, and the block keeps its text and its **id** (comments and links pointing to that id must stay alive).
- **Pasting into an empty bullet or empty heading** left that empty line above. The condition that only absorbed
  paragraphs was changed to be type-independent.
- **`mailto:`, `tel:`, and `#anchor` links kept only their label and lost their address on paste.** They were added
  to the list of addresses the app can follow (relative `.md` paths for workspace export are still collapsed).
- **We also fixed two sources of flakiness in the checks.** (1) If the caret is placed before the block's text reaches
  the DOM, `end` becomes offset 0 (there are no child nodes) — Enter splits at the start and the scenario measures the
  wrong thing. `caretReady()` now waits until the text is visible. (2) Saves go out in 500ms batches, so while the
  transaction for the key just pressed is still queued, **the previous state reads the same twice in a row** —
  `persisted()` returned that as "the saved truth," and `halo_tab` saw the pre-Shift+Tab tree and failed.
  Now the first two identical reads are not trusted.

## 9. Pitfalls hit while measuring (for the next person)

- The scratch page is **kept open by other sessions too.** Trying to empty it by repeatedly pressing `Backspace`,
  I **deleted even the chip of the sub-page I had created and sent it to the trash** (a red banner appears and that page
  becomes read-only → zero `contenteditable="true"` elements). Create a separate page for measurements, and only delete that one page.
- **Create measurement pages with the sidebar's `New page`** (the method settled on in round 3). Typing `/page` on the
  scratch page leaves a line there. Procedure: create your own window with `Target.createTarget({newWindow:true})` →
  click the sidebar's `aria-label` "New page" button (top left; in the Korean UI this is the `New page` label from the
  ko dictionary) → click `Page` in the menu that appears → type the title. ⌘N doesn't work in the web app (the browser takes it).
- **A freshly created empty page has no body block** — there are zero `.notion-page-content [contenteditable="true"]`.
  Enter from the title doesn't reliably create one; **clicking near the top of the body area (content box top+30)**
  creates the first block. Until then, typing goes nowhere (the markers don't get entered and the scenario dies).
- Pages sent to the trash are **read-only** and show a red banner at the top. I got stuck here trying to reuse an old
  measurement page — a person may have cleaned it up, so don't restore it; create a new one.
- Searching for text with `[contenteditable]` first matches **markers and placeholders with `contenteditable="false"`**.
  Search with `[contenteditable="true"]` to get list item text correctly.
- Notion draws **one extra empty block element, like a child container**, for each list item. When counting the tree,
  filter out items that have neither a marker nor text.
- Markdown shortcuts (`1. `, `- `, `# `) only trigger when typed as **real key events**. With `Input.insertText` or a
  wrong `code`/`keyCode` (e.g. sending `.` without `Period`/190 drops the period), they are not converted.
- **To measure paste**, the real clipboard (`execCommand('copy')` + ⌘V) doesn't get into Notion's body.
  Dispatching `new ClipboardEvent('paste', { clipboardData })` directly on the focused editable area runs Notion's
  Markdown parser as-is (confirmed in M2c on 2026-09-10).
- When a window is **completely covered** by another window, `Input.*` stops responding (`visibilityState: hidden`).
  Give it a non-overlapping position with `Browser.setWindowBounds`, and if it stalls, reactivate and retry.
