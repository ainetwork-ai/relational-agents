# Comment deletion — Notion measurements (2026-09-10)

comcom: "There's no UI or feature for deleting comments. Find out how Notion supports deletion and
implement it. Do it in the Hyeonjeong test teamspace, and verify by actually posting comments. Also check
whether there's a delete UI in the place that opens when you click the comment icon in the Projects table."

Measured on the original by actually posting comments, opening the menu, and deleting them. Measured
in two places — the row comment popover in the **ComCom › Projects** table (read-only, other people's
comments) and **Hyeonjeong test › New page** (comments I posted myself). Measurement scripts and raw data
are in the session scratchpad (`c*.mjs`, `n-*.jsonl`).

## 1. Where comments are posted, and where they are deleted

- **Entry point for page comments**: `Add icon · Add cover · **Add comment**`, shown when hovering over the title.
  Once there is at least one comment, a comment button also appears in the top bar (absent when there are none).
- **Row comment popover in the table** (comment badge in the title cell → 480 card): contains the same
  comment rows, and **has exactly the same delete UI.** So the answer to comcom's question "is there a UI for
  deleting there too" is **yes**, with an affordance identical to the in-page comment section.

## 2. The toolbar over a comment — `Comment actions`

On hover, a toolbar with `aria-label` = the `Comment actions` string (ko dictionary) appears to the right
of that comment (opacity 0 otherwise).

| Target | Size | Buttons (24×24 each) |
|---|---|---|
| Thread head | 76×28 | `Add reaction` · `Resolve` · `More actions` |
| Other comments (replies) | 52×28 | `Add reaction` · `More actions` |

- In the popover, the toolbar's right edge is **16px inside** the card's right edge (card right 1141, toolbar right 1125).
- `Resolve` is present **on other people's comments too** — resolving is not author-only.

## 3. The `More actions` (⋯) menu — this is where delete lives

Width **180**, radius **10px**, row height **28**, text color **rgb(44,44,43)**, row pitch 29, divider between groups (+8).

| Whose comment | Items |
|---|---|
| **Someone else's** (2 rows) | Mark as unread · Copy link |
| **Mine** (5 rows, height 160) | Mark as unread · **Edit** · Copy link ―divider― Mute replies · **Delete** |

- So **edit and delete are author-only**. Being a workspace member does not let you delete someone else's comment.
- **The delete item is not red** — same ink as the other items (unlike our repo's `danger` red convention).
- Edited comments get an `(edited)` marker next to the date.

## 4. Delete confirmation dialog

Pressing `Delete` opens a modal. It does not delete immediately.

| Item | Value |
|---|---|
| Card | 324 × 145, radius **12px** |
| Text | **"Are you sure you want to delete this comment?"** (the corresponding ko dictionary string) |
| Primary button | **Delete** — text rgb(253,246,246) / background **rgb(229,100,88)** (red fill) |
| Below it | **Cancel** — no background, text rgb(44,44,43) |

The two buttons are stacked **vertically**, not horizontally (Delete on top, Cancel below).

## 5. What happens to replies when the thread head is deleted?

**They remain.** Verified by creating a root + reply and deleting the root: only the root disappeared, the
reply stayed and the next comment became the thread head (toolbar count 2 → 1). **It is not a cascade delete.**

Why this matters: our server also deletes just the one row, but our panel only draws items with
`parentId === null` as roots, so when the head disappeared the replies **vanished from the screen while
still counting in the badge number**. To match the original, leave the server as is and **draw replies
whose parent is gone as roots**.

## 6. What we applied to our app (2026-09-10)

| Measurement | Applied |
|---|---|
| Edit and delete are author-only | Added `loadOwnComment` to `api/comments/[commentId]`. DELETE and PATCH{body} are author-only (403 otherwise); PATCH{resolved} stays open to any member as before. Previously **any workspace member could delete and edit other people's comments** |
| ⋯ → Delete | `CommentActions` — in the page comment section, the table row popover (both `CommentRow`) and the side panel (`CommentBubble`) |
| Menu 180/28/10, not red | As measured |
| Dialog 324/12, red Delete + Cancel | As measured (same text too) |
| Replies survive deleting the head | Server deletes only one row; panel renders parentless replies as roots |
| No delete on others' comments | If `me.id !== comment.authorId`, the toolbar is not rendered at all — the public `/share` has no logged-in user, so it automatically does not appear |

### 6.1 "Who can reach this comment" — page permission, not membership (correction, 2026-09-10)

After adding the author gate above, a review found two places that were wrong. Both were reproduced and closed.

| What was wrong | What happened | Fix |
|---|---|---|
| The access gate only looked at `workspace_members` rows | **Guests** (people who only see pages shared with them) also have member rows. So a guest with no pages shared could **read every comment body** in the workspace and resolve/reopen any thread. Comments on participant-only (`restricted`) pages were also open to every member of the same workspace | `getPagePermission` + `hasPermission` — the same answer the page itself uses (`lib/pages/edit-access.ts`, same as comment POST) |
| The author gate **replaced** the access check | It only asked `authorId = me`, so **someone removed from the workspace could keep editing and deleting their old comments** (while every other route already rejected them) | Layer the author condition **on top of** the access check — `loadOwnComment` passes through `loadAccessibleComment` first |

The same hole existed **on the read side** (`loadAccessiblePage` in `api/pages/[pageId]/comments`) and was fixed too.
OKF (file-based) pages have no `pages` row, so they had no check at all; their gate, the path ACL
(`okfGateFor(...).canReadId`), was attached to both reads and writes.

Levels were set along the same lines as Notion: **read is `view`; resolve, edit and delete are `comment`**. Only the
decision between 403 (not yours) and 404 (no such thing) on delete uses `view` — existence is not revealed to someone who cannot see it.

A1–A7 in `e2e/comment-delete.check.mjs` measure these seven things. All seven fail on the pre-fix code.

**Not implemented (but measured)**: Add reaction · Edit · Copy link · Mark as unread ·
Mute replies, and the toolbar's `Resolve` (the panel already has it separately).

Geometry constraint: comment rows are measured to the pixel by three golden checks (avatar = first child,
name and date = first two `span`s, body = first `<p>`, one cell 64, text columns 32/46). So the actions are
**absolutely positioned as the row's last child and use no `span` or border**. The check
`e2e/comment-delete.check.mjs` guards this condition as well.

## 7. Things learned while measuring (for the next person)

- The Notion composer accepts **only trusted input**. If you insert text with `Input.insertText` or
  `document.execCommand('insertText')`, it shows in the DOM but `Send comment` stays `aria-disabled="true"`.
  Only real `Input.dispatchKeyEvent({type:'char'})` works → **if the window is occluded, you cannot measure at all.**
- When the window is occluded (`visibilityState: hidden`), each input takes 5 seconds. Open your own window with
  `Target.createTarget({newWindow:true})` and pull it to the front with `Browser.setWindowBounds` + `Page.bringToFront`
  whenever it gets occluded (`ensureVisible` in scratchpad `cdp3.mjs`). If another session is measuring Notion at the
  same time, you steal each other's windows.
- Conversely, **opening a menu and reading its items** works fine with synthetic clicks (`el.click()`), so occlusion is OK.
- Clicking at scraped coordinates is risky — this time a click next to `Add comment` created 4 empty subpages in the
  sandbox page, which were then removed with a margin marquee selection + Backspace. If you close the tab before the
  deletion reaches the server, they come back, so **after a destructive action, wait about 8 seconds before closing the window.**
