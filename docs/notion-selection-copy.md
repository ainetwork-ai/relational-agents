# Notion drag selection · copy — measurements (2026-09-09)

Report from comcom: "On prod, dragging and pressing ⌘C doesn't copy anything, and the selected-state indication while dragging
also differs from Notion." Measured on the original using **real mouse drags** via CDP. Read-only (drag, Escape, ⌘C, and reading
the clipboard by ⌘V into an injected `<textarea>` — nothing was pasted into Notion content). Pages measured:
`Uncommon Gallery` (has images), and a Korean-titled "Notion Project Page development docs" page (single-column list). Scripts:
session scratchpad `m9-select.mjs`, `m11-select.mjs`, `m12-A.mjs`; raw data `notion-selection-measure-*.json(l)`.

## 1. Selection model — two states and the transition conditions

| start | dragged to | resulting state | indication |
|---|---|---|---|
| A inside text | within the same block | **text selection** (native) | `::selection` `rgba(35,131,226,0.28)` |
| B·C inside text | another text block (2–3 blocks) | **text selection continues across blocks** — does not switch to block selection | same blue text highlight, no halo |
| H inside text | past the last block into the bottom margin | still text selection | same as above |
| D inside text | **touches an image (non-text block)** | **switches to block selection** — the block containing the image (the parent bullet) is selected as a whole | halo |
| E margin (outside the content column) | sweep over blocks (both top→bottom and bottom→top) | **block selection**; the halo grows live during the drag. There is **no** rubber-band rectangle element | halo |
| F click on image | — | block selection | halo |
| G caret in text → Escape | — | 0 halos. Copying yields **the whole page** (the page block appears to be selected) — not conclusive | — |

- **Key point**: a drag that starts in text remains a **text selection to the end** as long as it only passes over text blocks.
  It switches to block selection only (1) when it touches a non-text block, (2) when it starts in the margin, (3) on clicking a
  non-text block.
- Our app **switches to block selection the moment a text drag enters another block** (`block-editor.tsx`
  `onEditorMouseDown`) — differs from Notion in B·C·H.

## 2. Block selection indication (halo) — computed styles

`.notion-selectable-halo` (an overlay absolutely positioned inside each selected block):

| property | value |
|---|---|
| background | `rgba(35, 131, 226, 0.14)` |
| border-radius | `4px` |
| border / box-shadow | none |
| inset | top 1–2px · left/right 2px · bottom 1–2px (by block type: image `2px`, bullet `1px 2px 2px`, numbered list `2px 2px 1px`) |

Our app: `bg-blue-100/80 ring-1 ring-inset ring-blue-300/70` — both color and ring differ.

Text selection color `::selection`: `rgba(35, 131, 226, 0.28)` (our app: browser default).

## 3. What ⌘C puts on the clipboard

| state | `text/plain` | `text/html` | internal format |
|---|---|---|---|
| A partial text within one block | the selected characters as is | the characters as is (no tags) + `<!-- notionvc -->` | `text/_notion-text-production` `{blockType, editing, selection:{startIndex,endIndex}, action:"copy"}` |
| B·C·H text spanning blocks | **Markdown**: `### Heading`, `- bullet`, `1. number`, children expressed by 4-space indentation, blank line between blocks | semantic HTML: `<h3>`, `<ul><li>`, `<ol start="2">`, links kept as `<a href>`, nested `<ul>` | `text/_notion-multi-text-production` `{blockSelection:{blocks:[{blockId, blockSubtree…}]}}` (reflects partial text) |
| D·E·F block selection | Markdown, **including child blocks** (indented), images as `!filename` | semantic HTML, images `<p><img src alt></p>`, nested lists | `text/_notion-blocks-v3-production` `{blocks:[{blockId, blockSubtree:{__version__:3, block:{…}}}]}` (including child subtrees) |

Always included: `text/_notion-page-source-production` `{id, table:"block", spaceId}`.

Our app: **does not handle** ⌘C in block-selection state (selection-mode key handling covers only arrows, Delete, ⌘D and Escape,
`block-editor.tsx` ~1834-1865). Selection blurs the caret, so the browser's default copy is empty too → exactly as reported.
The paste side already accepts `text/_notion-blocks-*` and HTML as a block tree (`onPaste`).

## 4. Applied (2026-09-09, verified per scenario with `e2e/selection-copy.check.mjs`)

| scenario | Notion (measured) | our app — before | after |
|---|---|---|---|
| A text drag within a block | text selection, `::selection` 0.28 | text selection, browser default color | text selection, **0.28** |
| B·C·H text drag across blocks | stays text selection, copy = Markdown + semantic HTML | **switches to block selection**, ⌘C does nothing | **stays text selection** (not trapped in the first block), copy = `1. …`/`<ol><li>` + internal tree |
| D text → image | block selection (halo) | block selection, then the click from mouseup clears it | block selection kept, copy includes the image |
| E margin marquee | block selection, live halo | the margin is outside the editor, so **text selection** | block selection, halo |
| F image click | block selection | nothing happens | block selection, copy = `![](url)`/`<img>` |
| halo | `rgba(35,131,226,0.14)` r4, no ring | `bg-blue-100/80` + ring | **identical** |
| ⌘C in block selection | md + html + `_notion-blocks-v3` | does nothing | md + html + `text/_ainmem-blocks-v1` (read first by paste), ⌘X = copy + delete |
| Backspace/typing on a cross-block selection | delete both ends, then merge first and last blocks | browser edits only the focused block | merge (children of the last block are kept), ⌘Z restores |

Implementation notes:
- **Chrome restricts a drag selection to the editing host where it started.** Notion makes a single editing root with a
  `contenteditable` that wraps the whole page (`div.whenContentEditable`). We set `contenteditable=true` on the editor root only
  during a press that starts in text, revert it on release, and return focus to the leaf (the selection belongs to the document,
  so it survives).
- `Selection.containsNode`/`toString` are clipped to the focused host — cross-block selections are handled via `Range`.
- When press and release are on different rows, the browser fires `click` on the common ancestor and the row's onClick used to
  clear the selection; that click is now swallowed.
- Not measured (and therefore not asserted): the pixel threshold for starting a drag, the exact meaning of Escape (G
  inconclusive), a rubber-band visual element (none observed). A's `text/html` is the browser default (Notion's is untagged
  text) — left as is.

## 5. Deselection rules (measured 2026-09-09, after selecting 2–3 top-level text blocks with a margin marquee)

comcom: "After dragging, clicking the margin should deselect, but it doesn't. Defining the deselection scope matters, and after
selecting several, clicking one might select only that one." We built a rule matrix and measured each on the Notion original
(`m14-deselect.mjs`, `m15-halo-deselect.mjs`, raw data `notion-deselect.jsonl`, `notion-halo-deselect.jsonl`).

| # | action | Notion | our app — before | after |
|---|---|---|---|---|
| S1 | click left margin | **deselect**, caret in that line's block | kept (as reported) | deselect + caret at the start of that line's block |
| S2 | click right margin | deselect, caret in that line's block (after ≈1 second) | kept | deselect + caret at the end of that line's block |
| S3 | click text of an unselected block | deselect, caret there | same | same |
| S4 | click text of a **selected** block | deselect, caret there (not "select only that one") | same | same |
| S5 | click empty space right of a selected row's text | deselect, caret in that block | same | same |
| S6 | Shift+click (text of another block) | deselect, caret (no range extension) | extends range | on text: deselect + caret. On padding: extend range |
| S7 | ⌘+click (text of another block) | deselect, caret (no toggle) | deselect | same |
| S8 | Escape | deselect (no caret) | same | same |
| S9 | ⌘+click (text of a selected block) | deselect, caret | same | same |
| S10 | click a block's **non-text padding** (top edge of the block) | **select only that block** | deselect | select only that block |
| S11 | click empty space below the last block | deselect, caret in the last block | kept | deselect (+ focus the trailing paragraph) |
| S12 | click the ⠿ gutter of a selected block | **selection kept** | deselect | kept (gutter and handle are left alone) |
| T1 | cross-block text selection + click margin | selection disappears (no caret) | selection kept | disappears + caret on that line |
| T2 | text selection + click other text | caret there | same | same |
| T3 | text selection + Escape | collapses to caret (page block) | block halo + leftover selection | collapses to a caret at the selection start |
| G | Escape in caret state | selects that block | same | same |
| ⌘A | ⌘A in block-selection state | selects all top-level blocks (children covered by the parent halo) | — | (not implemented) |

- Definition of the deselection scope: **clicking text anywhere deselects** (regardless of modifiers), and **clicking the margin or
  the empty space below also deselects**. The only place where selection is kept is the ⠿ gutter.
  "Select just one" happens when clicking a block's **padding**, not its text.
- Two measurement pitfalls: (1) in a background Chrome tab rAF is paused, so Notion's drag handling lags several seconds per
  event — measure after `Page.bringToFront`. (2) If the marquee starts over our app's ⠿/+ gutter buttons (~20–45px left of the
  block), a button gets pressed instead of dragging — the margin is outside that.

## 6. Halo geometry (2026-09-09, 15 blocks measured at once with ⌘A + precise measurement of 2 adjacent blocks)

| block | halo inset (top/left/right/bottom) | gap between adjacent halos |
|---|---|---|
| text (paragraph) | 2 / 2 / 2 / 2 | text↔text **4px** |
| bulleted_list | 1 / 2 / 2 / 1 | list↔list **2px** |
| numbered_list | 1 / 2 / 2 / 1, but 2 on the side touching text | text↔list 4px |

An overlay absolutely positioned inside the 720×40 block box (708 text + 6 left/right) (`position:absolute; inset`),
`rgba(35,131,226,0.14)`, radius 4px, no border/shadow, `pointer-events:none`, `z-index:81`, `transition: opacity .2s`.
**Children of a selected parent have no halo** (the parent halo covers the subtree). Our app painted the whole row with a
background color, so adjacent selections looked like one lump, and halos overlapped on every child row → changed to an overlay
(2px inset, 1px top/bottom for lists, 2px depending on neighbour type), not drawn when a selected ancestor exists.
Verification: `e2e/deselect.check.mjs` (G·S1–S11·T1–T3).

## 7. How to measure

- Notion: in one golden-set tab, enable `Input.setInterceptDrags` and drag with mouse events. **Caution** — the first 1–2
  interactions after page load are swallowed before hydration (that is what the A1 and warmup failures were). Wait until ready
  (mouse-event round trip <300ms) before measuring. On large pages a single mouse event takes ~5 seconds, so one drag takes
  46–86 seconds.
- Our app: `app/e2e/selection-copy.measure.mjs` measures the same scenarios on dev and outputs JSON.
