# AINMem QA backlog — #qa-ainmem investigation (2026-09-09)

Reports posted to the `#qa-ainmem` channel (ainteams) of the comcom workspace, investigated against the code and the prod DB.
Each item is written as **symptom (reporter's words) → cause (code evidence) → how to confirm in logs/DB → status → fix direction**.
Sources: ainteams prod DB (read-only, channel `07e982cc-8e38-4008-a568-b6e5bbffba74`), ainmem code,
ainmem prod DB/container logs.

Priority: **P1** data loss·core editing blocked / **P2** common editing friction / **P3** request·improvement.

## Tracking (avoiding duplicate entries)

So that re-reading the channel does not register the same thing twice, this document tracks the **processing point (watermark)** and each item's
**source message id** together.

- **Channel**: comcom / `#qa-ainmem` · `channel_id = 07e982cc-8e38-4008-a568-b6e5bbffba74` (workspace `08040167-0a63-4a3f-bbe7-b49161b96e37`)
- **Processing point (watermark)**: processed up to `2026-09-09 03:58:22` (message `dbc78446-dedb-4596-a370-c3c1b1eabc31`).
- **How to query next time**: look only at messages after that time —
  ```sql
  select id, created_at, user_id, content
  from messages
  where channel_id='07e982cc-8e38-4008-a568-b6e5bbffba74'
    and deleted_at is null
    and created_at > '2026-09-09 03:58:22'
  order by created_at;
  ```
  Add only new messages as QA items, and move the watermark to the latest processed message. Ids already listed under
  "source message id" below are not registered again.
- **Source message ids already processed**: `da4c03f4`(QA-6), `ea1015d1`(QA-2), `bdb0733d`(QA-3), `7bfda286`(QA-4),
  `bd3f869c`(QA-8), `c327376b`·`1f3ba8eb`(QA-1), `337adabc`(QA-5), `7e2eae79`(QA-7).

---

## QA-1 · Edits lost because saving failed (P1) — **fixed, deployed**

- **Report**: Jiyoung (Jiyoung UX) 9/8 04:09 "It looks like the page Hyemin edited on Saturday didn't save and got wiped. We had filled in the visitor KPI numbers and so on — can it be recovered?" Confirmed by Finn·Hyemin.
- **Source messages**: `c327376b (Jiyoung's report), 1f3ba8eb (Hyeonjeong's scheduled conclusion message)`
- **Channel/page/user**: #qa-ainmem · `ainmem.ainetwork.ai/p/cf791d88-4108-41dd-87f6-435bd36072b7` ("2026 Uncommon Art Market (Frieze x Kiaf period) (copy)") · author Hyemin (hyemin kwak), original page `d77a3139…`.
- **Cause (confirmed)**: autosave PUT the **whole document** on every keystroke and decided whether to use `keepalive` by character count (< 60,000), but Chrome's 64KiB keepalive limit is measured in **UTF-8 bytes**. Korean is 3 bytes per character, so at about 53k characters it passed 65KB and Chrome rejected the request before sending it. The code interpreted that as "offline", kept only a localStorage draft, and deleted it 24 hours later → it never reached the server.
- **How to confirm in logs/DB**: `page_snapshots` has no snapshot of that page after 9/3. Reconstructing the `blocks` PUT body gives 65,379 bytes (over 64KiB). The copy of Hyemin's Chrome LevelDB holds only deletion tombstones, so recovery is impossible (the values were removed by compaction).
- **Status**: fix for the cause and path deployed (save protocol rewritten, `docs/save-protocol-target.md`). The Saturday content of that page itself cannot be recovered (it is not on the server, in backups, or in the browser).
- **Follow-up**: none. Recurrence prevention is covered by the same save rewrite as QA-2.

## QA-2 · Other people's edits not showing on another computer + "offline" message (P1) — **fixed, deployed**

- **Report**: Jiyoung 9/8 00:02 "When another user edits a page, it isn't reflected when checked from a different computer. What Hyemin edited last week doesn't show up on my computer today. And an offline status message appears."
- **Source message**: `ea1015d1`
- **Cause (confirmed)**: two branches. (a) The "offline" badge was the result of saves being rejected for exceeding the keepalive byte limit, same as QA-1. (b) Not reflected = the edit never reached the server in the first place (= QA-1), or it did but real-time fan-out/sync was weak.
- **Status**: saving was rewritten and deployed as character-level CRDT operations + an IndexedDB queue + server fan-out (SSE). Even when two tabs edit the same block simultaneously they converge in real time without loss. Verified with `e2e/concurrent-edit.check.mjs`.
- **Follow-up**: check two people editing simultaneously in real use (recommended).

## QA-3 · Pages get mixed up when switching workspaces (P1) — **cause confirmed (page viewing has no active-workspace guard)**

- **Report**: Jiyoung 9/8 00:04 "When going back and forth between the ComCom workspace and the personal workspace, pages get mixed up. For example, the selected workspace is the personal one but ComCom space content shows up."
- **Source message**: `bdb0733d`
- **Candidates ruled out first (code checked)**: (1) not leftover client cache — `usePagesStore.load()` replaces the whole map (`stores/pages.ts:83-89`). (2) switch order is correct — the switcher awaits `/api/workspaces/switch` and then does `load()`·`router.push`·`router.refresh()` (`sidebar/workspace-switcher.tsx:96-121`). (3) the sidebar (`/api/pages`) is strictly scoped to the active workspace — `eq(pages.workspaceId, workspaceId)` (`api/pages/route.ts:26-28`).
- **A cause we suggested once and retracted**: at first we thought "OKF file pages are not bound to a workspace and leak", but **the OKF root in prod is empty** (0 files on both the host `deploy/okf-content/` and the container `/data/okf`, checked 2026-09-09). All prod pages are Postgres, so OKF leakage is **not the actual cause in this prod**. (It is true that OKF's `inThisWorkspace` only filters relation documents, but it is a latent bug with no symptoms until OKF is populated — recorded separately below.)
- **Cause (confirmed)**: **the page viewing path does not check the "active workspace".** `/p/<id>` (`app/(app)/p/[pageId]/page.tsx:83-102`) loads the page by id and checks **only whether the user is a member of that page's workspace** (`workspaceMembers`); it **does not compare whether the page belongs to the currently selected (active) workspace.** The reporter is a ComCom member, so even with the personal workspace active, opening a ComCom page renders its body as-is — header (sidebar) personal, body ComCom = "mixed up". Ways to reach a ComCom page URL: favorites·recents·breadcrumbs·mention links, or switching/going back while a ComCom page is open.
- **How to confirm in logs/DB**: with the personal workspace selected, open `/p/<comcom-page-id>` and see if the body renders (if so, reproduced). Whether it opens even though `pages.workspace_id` differs from the session's `activeWorkspaceId`.
- **Status**: **resolved (code landed, verified on dev)** — `508d0b9` (the page decides the workspace) + the next commit (sidebar fetch uses that workspace). The URL stays `/p/<id>`. Implementation: `proxy.ts` passes the `/p/*` request path to the layout → the layout draws the sidebar **from the first paint** with that page's workspace (membership-checked) → if the page route differs from the session's active value, `FollowPageWorkspace` (client) makes the session follow via `/api/workspaces/switch` and calls `router.refresh()` → `/api/pages`·`/api/teamspaces` accept a membership-checked `?workspaceId=` so the sidebar requests its own workspace rather than the session's. Verification `e2e/workspace-follows-page.check.mjs`: hard-load a B page with active=A → SSR header B, tree B (A tree shown for 0ms), session B, 1 switch POST; the hard load back to A and the A→B soft navigation behave the same. 0 page errors.
- **Notion measurement (2026-09-09, CDP, golden.check passing; inferences from the first round corrected by real measurement in the second)**. The account hyeonjj@comcom.ai has ComCom, a personal ("HyeonJeong Jun's Notion"), and a guest workspace. Actual switching and navigation were done in one tab and then restored:
  1. **The page id is authoritative; the workspace is derived from the page.** With the personal workspace active, opening a ComCom page URL directly **switched both the body and the sidebar (bottom switcher "ComCom", teamspace list) to ComCom.** No confirmation dialog or error. In other words, "which workspace is active" is decided by the page you are viewing.
  2. **The workspace slug in the URL is optional decoration.** ComCom has a slug, so `/p/comcom/<id>`; the personal workspace has no slug, so **`/p/<id>`** (observed `/p/353adf31…`). The first-round claim that "the URL always contains the workspace" was **wrong**.
  3. **A wrong slug or a slugless URL is corrected by the page id.** `/p/<other value>/<comcom page id>` → redirects to `/p/comcom/<id>`. Legacy `notion.so/<id>` → redirects to `app.notion.com/p/comcom/<id>`, and the chrome is ComCom too.
  4. **Where the workspace is shown**: a team workspace (ComCom) is the switcher at the **bottom left** of the sidebar ("ComCom ⌄"); the personal workspace is at the **top** of the sidebar ("HyeonJeong Jun's Notion"). The top breadcrumb is **teamspace → parent page → page** and does not include the workspace ("Hyeonjeong Test" is a teamspace — calling it a workspace in the first round was wrong).
  - Conclusion: Notion has no "header A, body B" mismatch not because of a URL segment but because of **the rule "opening a page makes that page's workspace active"**. Our app does not derive the active workspace from the page when viewing it, so they diverge.
- **Fix direction (based on re-measurement)**: isomorphic implementation = **when viewing a page, take `page.workspaceId` as the active workspace and render the sidebar·header with it.** First paint on the server (the layout knows the request path's page → workspace and draws the right sidebar); on soft navigation the client makes the session follow via `/api/workspaces/switch` and calls `router.refresh()`. Putting a workspace segment into the URL is an optional slug even in Notion (ainmem has no slug concept), so it is not required; if added, compatibility redirects for old URLs (Slack shares·saved mention links `/p/<id>`) must be kept forever. For design details see the separate plan (route restructuring·middleware `x-pathname`·client reconcile·migration order of 40 links).
- **Separate (latent) bug**: in the OKF merge in `api/pages/route.ts`, `inThisWorkspace()` filters only relation documents by workspace, while plain OKF content passes for every workspace via `if (!m) return true` + `okfSyntheticPage` stamps the current workspace id (`route.ts:140-163`). **Once OKF is populated**, the same mix-up will appear in the sidebar. Needs cleanup before OKF is actually used.

## QA-4 · After creating a page (sub-page) block, you cannot type below it (P1) — **resolved**

- **Report**: Jiyoung 9/8 00:11 "After creating a page, it freezes in a state where I can't type. Text can be typed freely, but once a page is created, text input below it doesn't work."
- **Source message**: `7bfda286`
- **Cause (confirmed)**: turning a line into a sub-page makes that block a **non-editable link chip** (`ChildPageBody`, `block-row.tsx:970`), but **no empty paragraph is created after it** (the child_page conversion in `block-editor.tsx:910-928` only changes the block type and does not add a following paragraph). If the sub-page is the last block of the document, there is no editable target to put the caret below, so input is blocked. The empty-page starter (EmptyPageStarter) only appears when `blocks.length === 1` (`block-editor.tsx:2820~`).
- **How to confirm in logs/DB**: in the problem page's `blocks`, the last block is `type='child_page'` with no paragraph block after it.
- **Status**: resolved (the commit after `beb4b78`). Two fixes — (1) when creating a sub-page with slash, if the block is last, an empty paragraph is auto-added after it and the caret moves there. (2) when the last block is non-editable (sub-page·image·divider·table) and there is no caret, clicking the empty area below adds an empty paragraph and enters it (same affordance as Notion). Ending with an image·divider·table escapes via the same path.
- **Fix direction**: (landed) add a trailing paragraph to the child_page conversion in `block-editor.tsx` + add a paragraph in the bare-canvas onClick when the tail is non-editable.

## QA-5 · Content you wrote disappears when you leave the screen (P1) — **mostly covered, needs confirmation**

- **Report**: Bobae Jeon 9/9 00:46 "When I write something and leave the screen, what I wrote keeps disappearing."
- **Source message**: `337adabc`
- **Cause (code checked)**: the timing is **after** the save rewrite (phase-1 queue, deployed 9/8 15:05). The queue **commits each edit's transaction to IndexedDB first** and then sends it (`editor/transaction-queue.ts:199-217`), and unsent items are adopted by the next session (orphan adoption, `:350-390`). The old `flush on unmount` was removed with the queue. So committed edits should not be lost by navigation. The remaining real risks narrow to two:
  1. The reporter's browser had cached the **old pre-deploy code** (port forwarding·service worker·before a hard refresh).
  2. A specific path where one leaves **the first edit of a freshly created page** before the page-creation server round-trip finishes, so the transaction points to a page/block that does not exist yet and the server rejects it permanently.
- **How to confirm in logs/DB**: ask the reporter for page id·browser·app version. Whether the edit remains in that page's `transactions`/`blocks`. Whether unacknowledged transactions were left in IndexedDB `TransactionStore`.
- **Status**: mostly covered by the save rewrite. **Reproduction·version check needed**.
- **Fix direction**: if reproduced, fix only the "first edit of a new page" path in (2) (the queue holds·retries edits made before page creation is confirmed). Otherwise, advise a hard refresh after deploys.

## QA-6 · Dragging a block to move it always creates "columns" (P2) — **resolved**

- **Report**: Finn 9/7 07:28 "When I drag to move something, it always splits into columns."
- **Source message**: `da4c03f4`
- **Cause (confirmed)**: the drop test treated **25% on each side** of the target block's width (50% of the width combined) as "edges" and created columns (`block-editor.tsx:2410-2411`: `relX < 0.25 ? "left" : relX > 0.75 ? "right" : undefined`). Notion's edge band is only a few px, much narrower. With half the width being a column-split zone, ordinary reorder drops easily fell into column splits.
- **How to confirm in logs/DB**: unintended `column_list`/`column` blocks appear in the dragged page's `blocks`.
- **Status**: resolved (`beb4b78`). The edge band was narrowed from a width ratio (25% each side) to a fixed pixel `min(64px, 15% of width)`. On wide blocks, the column-split zones are just 64px on each side, and the wide center falls into ordinary row reordering.
- **Fix direction**: (landed) `block-editor.tsx` `onDragOverRow`.

## QA-7 · Clicking does nothing in the Projects "My" tab (P2) — **resolved (cause confirmed, verified on dev)**

- **Report**: Finn 9/9 01:40 "In the projects my tab, clicking doesn't open anything." (The 9/8 04:13 "Only this page shows up like this at the top", previously noted as "possibly related", is **a message about Jiyoung's QA-1 page** (`5cafdba4`) and unrelated to QA-7 — corrected.)
- **Source message**: `7e2eae79`
- **Cause (confirmed)**: in the prod Projects database (`4b087b9f…`), "My" is a **board view** (`db_views 7a0bce0c…`, `is_me` filters on TL·Assignee·Sherpa, grouped by Status). Board cards **had no open path**: `onCardPointerDown` in `board-view.tsx` only handled dragging, so even a click where the pointer did not move was handled on pointerup as a "drop into the same column" → `openRow` was never called so nothing happened, and it even rewrote the unchanged value with `updateRow`. Table·gallery·timeline views call `db.openRow`, so it opened in other tabs — which is why it failed "only in the My tab".
- **Status**: resolved. Press without moving 5px or more → **click → `openRow` (side peek)**; moving → drag; dropping back in the original column → no write. Verification `e2e/board-card-open.check.mjs` (dev, amy account, 55 cards on the My board): click → peek opens·0 writes, drag within the same column → no peek·0 writes, 0 page errors. Running the same check against the pre-fix code fails 1a (see the commit message).
- **Alignment with Notion**: Notion boards also do click = open, drag = move. The drag threshold in pixels can only be measured by actually dragging a card in the original (dragging is forbidden by the golden-set rules), so it was **not measured** and the usual 5px was used — measure separately if needed.
- **Cause (candidate, path traced)**: opening a row is one path shared by all views — `db.openRow(rowId)` → finds the row in `rowsRef.current` (the **full row list**, independent of view filters) → `ensureRowPage` (creates `__page` if missing) → opens the **row-peek overlay** via `setOpenRowId` (`database/database-block.tsx:651-659,532-544,1607`). That is, it is not navigation but a right-side overlay. Since openRow searches the full list, "doesn't open only in a certain tab" is likely not openRow itself but **the click never reaching openRow** in that view (e.g. another handler on the group/card·`stopPropagation`, or that tab being a separate "my" aggregate screen rather than a database view). From the code alone we could not tell which "my" tab of which view.
- **How to confirm in logs/DB**: that tab's view kind (`kind` in `db_views`), console errors on click, whether the click goes through the `db-title-open-<rowId>` button or the whole row, whether the `openRowId` state is set but the overlay does not appear (= RowPeek side) or it is never set (= click not reaching). Finn's 9/8 04:13 attached image not viewed — need to check what state that banner is.
- **Status**: unresolved. The path is narrowed but **reproduction·image check needed** (which Projects page·which tab·console logs).

## QA-9 · ⌘C after drag selection does not copy + selection styling differs from Notion (P1) — **resolved (measurement-based, verified on dev)**

- **Report**: comcom (Hyeonjeong) 9/9 chat, confirmed directly on prod — "I dragged and pressed cmd c but nothing copied? And the selected-state styling while dragging is different from Notion too." (Not a channel message — no source id)
- **Cause (confirmed)**: (1) the key handling in block selection mode had no ⌘C/⌘X and blurred the caret, so the browser's default copy was empty too. (2) a text drag switched to block selection as soon as it entered another block (Notion keeps the text selection). (3) selection styling `bg-blue-100/80 + ring` (Notion: `rgba(35,131,226,0.14)` r4, no ring). (4) the margin marquee was outside the editor so it became a text selection, and clicking an image did not select it.
- **Measurement**: 7 scenarios measured with real drags on the Notion original → `docs/notion-selection-copy.md`.
- **Status**: resolved. Commits "Block clipboard…" + "Drag selection and ⌘C like the original…". Verification `e2e/selection-copy.check.mjs` (A·B·C·H·E·D·F + Backspace merge/⌘Z) all pass, `save-protocol`·`concurrent-edit` regressions pass.
- **Follow-up reports (9/9, after checking on prod)**: (a) "clicking the margin after a drag does not deselect — define the deselect scope and measure it", (b) "when multiple blocks are selected, Notion shows them split between blocks — get the design rule exactly", (c) a `-bottom-0.5 … bg-blue-500` indicator line appears during drag.
  - (a) Measured a 16-case deselect rule matrix in Notion (`docs/notion-selection-copy.md` §5): clicking text anywhere deselects + caret, clicking the margin·empty space below also deselects (caret in the block on that line), Escape deselects; exceptions are clicking a block's **padding** → selects just that block, clicking the ⠿ gutter → kept. Applied as-is.
  - (b) Measured the halo geometry (§6): a 2px inset overlay inside the block box (list items 1px top and bottom, 2px on the side touching a text block), 4px gap between adjacent halos (text)/2px (lists), children of a selected parent have no halo. Row background color → replaced with an overlay.
  - (c) A bug where, if a block drag ended outside a row, `draggingId`/`dropTarget` remained so the indicator line stuck and reacted to later text drags. Cleaned up on `dragend`/`drop`, and the drop indicator is shown only when our block-drag marker (`application/x-ainmem-block`) is present.
  - Verification `e2e/deselect.check.mjs` (G geometry + S1–S11 + T1–T3), `selection-copy.check.mjs` passes again.

## QA-10 · "Turn into" at the bottom of the ⠿ menu does not work (P2) — **resolved (Notion measured, verified on dev)**

- **Report**: comcom (Hyeonjeong) 9/9 chat — "Of the two left buttons that appear when the cursor is on an empty line, the 6-dot button's submenu item turn into at the very bottom doesn't work."
- **Notion measurement (test page + Project Page document, CDP)**: (1) clicking ⠿ on an **empty line** opens not the action menu but the **block type picker** directly (same panel as +: filter input "Type to filter…", Suggested/Basic blocks/Media, Close menu esc). (2) clicking ⠿ on a block with content → Turn into · Color · Copy link to block ⌘⌃L · Duplicate ⌘D · Move to ⌘⇧P · Delete Del · Comment ⌘⇧M · Suggest edits · Present from here · Ask AI · Skills (width 265, rows 28px, radius 10px). **Turn into opens on hover alone**, a panel to the right (menu.right−4px, width 220, rows 28px): Text · Heading 1–4 · Page · Bulleted list · Numbered list · To-do list · Toggle list · Code · Quote · Callout · Block equation · Synced block · Toggle heading 1–4 · 2–5 columns. Raw data `scratchpad/notion-handle-menu*.json`.
- **Cause (confirmed)**: two layers. (a) the submenu was `absolute left-full` inside a scrolling menu container (`overflow-y-auto`), so it was **clipped and invisible** (for the same reason, the table's sort submenu had already been moved to a portal). (b) even when made visible, type changes of **nested (child) blocks** were saved but not drawn — the top-level row render cache compared only the root block object, so the parent element was reused even when a child changed (showing the old type until the selection state changed).
- **Status**: resolved. The sub-panel was moved to a portal, opens on hover like Notion, and is positioned beside the menu (menu.right−4, at the Turn into row height, clamped inside the window); items follow Notion's order and labels (only the types we have: Text·Heading 1–3·Page·Bulleted·Numbered·To-do·Toggle·Code·Quote·Callout·Block equation). Clicking ⠿ on an empty paragraph opens the type picker directly. The root row cache now compares the subtree (list of descendant objects) too. Verification `e2e/handle-menu.check.mjs` (⠿ → hover Turn into → panel position·row height → click Heading 1 → heading1 → ⌘Z restore, ⠿ on an empty line → picker), `save-protocol`·`selection-copy`·`deselect`·`concurrent-edit` regressions pass.
- **Not applied (measured, though)**: menu width 265/row 28/radius 10 (ours 176/32/8), the Color·Copy link to block·Move to·Suggest edits·Present·Skills items, Heading 4·Synced·Toggle heading·column types.
- **Label unification (9/9 follow-up)**: "only Turn into shows in Korean" was not a language-setting problem; the rest of this menu (Delete·Duplicate·Copy link·Comment) was hard-coded English that did not go through i18n. The four items were routed through t() using Notion's Korean labels (Delete·Duplicate·Copy link to block·Comment; the exact Korean strings are the corresponding entries in the ko dictionary, `app/src/i18n/ko.ts`). For English there is no original capture of this menu (`docs/en/` has only the page menu), so it is **unmeasured** — we used Notion's English UI labels (Turn into · Copy link to block · Duplicate · Delete · Comment), and since the dictionary value for the panel is "Comments", "Comment" branches by locale only in this menu. Measuring English for real requires temporarily switching the golden-set account language to English, which needs human permission.
- **Side effect during measurement**: in the first attempt the **+ button** was pressed instead of ⠿ (Notion has no `draggable` attribute, so it fell back to the last button), and **1 empty text block was inserted** below the first block of Notion's "Notion Project Page dev doc" (77→78 blocks). It must be removed on the Notion side — a human should check and delete it.

## QA-11 · No UI or function to delete comments (P1) — **resolved (Notion measured, verified on dev)**

- **Report**: comcom (Hyeonjeong) 9/10 — "There's no comment delete UI or function. For comments on a page. Find how Notion supports it and implement it. Also check whether there is a delete UI where it opens when you click the comment icon in the Projects table."
- **Cause (confirmed)**: the server `DELETE /api/comments/[commentId]` and the store `useCommentsStore.remove()` **already existed and nobody called them** — purely a missing UI. Moreover, that route only went through `loadAccessibleComment`, so **any workspace member (including guests) could delete others' comments and even edit their body** (OKF pages skipped even the membership check).
- **Notion measurement (2026-09-10, confirmed by posting comments ourselves in the Hyeonjeong Test teamspace)** → `docs/notion-comment-delete.md`. Summary: hovering a comment shows a `Comment actions` toolbar (head 76×28 / reply 52×28); the `More actions` (⋯) menu is width 180·row 28·radius 10; **Edit·Delete only on your own comments** (others' comments only have Mark as unread·Copy link); the delete item is **not red**; `Delete` → a **324×145 radius 12 confirmation dialog "Would you like to delete this comment?"** with a red `Delete` (rgb(229,100,88)) above `Cancel`. **Deleting the thread head keeps the replies** (no cascade). **The row comment popover in the table has the same delete UI** — the answer to comcom's second question is "yes".
- **Status**: resolved. (1) Added `loadOwnComment` on the server so delete·body edit are **author-only** (otherwise 403), while resolve/reopen is allowed for anyone with access (the original also shows `Resolve` on others' comments). (2) Added `CommentActions` in three places — the page comments section, the row popover, and the side panel — with the original's measurements. (3) Fixed the problem where, after deleting the head, replies were not visible and only remained in the badge count, by treating "replies without a parent as roots" in the panel. (4) Public `/share` has no logged-in user, so no delete UI appears.
- **Two holes found after adding the author gate (2026-09-10 review, both reproduced and fixed on dev)** → `docs/notion-comment-delete.md` §6.1.
  1. The access gate looked only at `workspace_members` rows. **Guests have member rows too** — a guest with no pages shared could read every comment body in the workspace and resolve/reopen any thread. Comments on participant-only (`restricted`) pages were also open to every workspace member.
  2. The author gate **replaced** the access check (`authorId = me` only). **Someone removed from the workspace could keep editing and deleting their old comments.**
  Fix: access goes through `getPagePermission` + `hasPermission` — the same answer the page itself uses. The author condition sits on top of that. Also applied to the read side `api/pages/[pageId]/comments`, and to the OKF path that had no check at all because there is no `pages` row (`okfGateFor.canReadId`). Commit `fd0a7c6`.
- **Verification**: `e2e/comment-delete.check.mjs` (server 403/200, reply preservation, menu·dialog measurements, cancel/delete, no actions on others' comments, row geometry unchanged, **access regressions A1–A7**) all 30 pass — reverting to the pre-fix code makes all seven of A1–A7 fail. The existing comment geometry checks (`page-comments-inline`·`comment-collapse`·`comment-attachment`·`row-comment-badge`·`row-comment-popover`) pass their regressions.
- **Deploy**: `ainmem_prod:app-b07d8b4` (2026-09-10, healthy).
- **Not implemented (measured, though)**: Add reaction · Edit · Copy link · Mark as unread · Mute replies, and `Resolve` in the toolbar (already in the panel). Separate leftovers: no real-time comment fan-out (other tabs don't know about deletions), `.comment-highlight` of range comments remains after deletion, attachment bytes not reclaimed.

## QA-8 · A database created in Notion does not show up in AINMem — import/sync request (P3)

- **Report**: B Sebastian 9/8 02:05 "I made a database for IP management in Notion, but it doesn't show up in AIN MEM. Is there a way to import/sync?" (Notion·ainmem links attached.)
- **Source message**: `bd3f869c`
- **Nature**: not a bug but a **feature request** (sync/import from Notion DB → ainmem). Notion captures are currently reference only (`docs/notion-captures.md`) and there is no automatic sync.
- **Link check (2026-09-09)**: the ainmem side `1c2562d9…` is ComCom's "⚖️ Trademark Use Mitigation Tracker" page (created during the migration work before 8/13). Its body is a divider + one paragraph **"🗃 Global Trademark Portfolio — Notion inline database (not migrated)"** — at migration time the Notion inline DB could not be moved, so **only placeholder text was left**. The Notion side `d9bb4408…` is the inline database "Global Trademark Portfolio" that should be in that spot (11 properties: Mark, Reg Number, Class, Territory, Reg Date, Vulnerable Since, Sec.8 Deadline, Action, Status, Law Firm, Notes / views: Default·Board(Territory)·Timeline·🇯🇵 Japan etc. / 20+ rows). So it is not "I made it in Notion and it doesn't show"; rather, **Sebastian keeps filling in, in Notion, the inline DB that was left out of the original migration**, and ainmem does not have that DB.
- **Direction**: (1) one-off import — create the Notion DB as an ainmem database (map 11 properties, 3–4 views), move the rows, then replace the placeholder paragraph. Stop editing on the Notion side afterward. (2) continuous sync — Notion API integration is a new feature (roadmap decision). First unblock with (1), then the team decides whether to edit in parallel with Notion.
- **Status**: request. Roadmap decision needed.

---

## QA-12 · Indentation differs from Notion — once indented, the blocks below don't stay indented (P1) — **resolved (Notion measured, verified on dev)**

- **Report**: comcom (Hyeonjeong) 9/10 — "Deal with the indentation problem. Once you indent, the blocks below it should always stay indented. Measure in Notion how it differs — indenting within a block versus between blocks, and how indentation works for each basic block — and fix the problem."
- **Notion measurement (2026-09-10, 28 scenarios by actually pressing keys)** → `docs/notion-indent.md`. Measured not on a scratch page but on **a sub-page I created**, deleted at the end.
- **Cause (confirmed, 9 places)**: the biggest is **Enter at the end of a block with children** — Notion places the new line right below that block and **moves the children to the new line**, while we created it **below** the subtree at the parent's depth. Others: Tab/Shift+Tab threw the caret to the start (the row remounts when depth changes, but text sync was a passive effect, so the caret landed in an empty node); Enter on an indented empty list item did not outdent one level; Shift+Tab on a middle child did not absorb the following siblings, **swapping document order**; Backspace at the start of an indented block did not outdent one level (on the first child **nothing happened**); merge orphaned children so they **disappeared from the screen** (but were saved); Tab with block selection·text selection was unimplemented; Tab in a code block indented the block; outdent used **the same position** as the parent, so the same input rendered in two orders; the SSE applier dropped `position`, so other tabs had the old order.
- **Status**: resolved. Commits `eae9fa3` (behavior) + `03fdfd7` (geometry·markers). Tree surgery is consolidated in one place, `app/src/lib/editor/indent.ts`. Verification `node e2e/indent.check.mjs` — 18 scenarios, 49 checks, exit 0 (on-screen tree + saved `parentBlockId`/`position` + reload). `block-spacing` (551)·`deselect`·`selection-copy`·`plus-menu`·`handle-menu`·`save-protocol`·`concurrent-edit` pass again.
- **Visible differences fixed along the way**: one indent level 24px → **30px when the parent is text, 32px when it has a marker**; list markers per depth `•/◦/▪` · `1./a./i.` (3-level cycle).
- **Differences left**: `docs/notion-indent.md` §6 — Backspace at the start of a depth-0 heading/quote, indentation lost on the markdown/AI insertion paths, children missing in the `md-mirror` export.
- **Round 2 (9/10, "measure it in Notion and match Notion exactly · the same policy for even a single keystroke")**: re-measured the three leftovers and matched them all — `docs/notion-indent.md` §6·§7.
  1. **Backspace-at-start policy** (measured per type): headings merge with the block above **in one step** without dropping their style; code blocks **do nothing**; if there is nothing above, the text goes into **the page title** (confirmed by the measurement page's URL changing to the title). Only quote·bulleted·numbered·to-do·toggle drop their style first.
  2. **Reading markdown**: one level = "parent marker width" (`- ` 2 spaces, `1. ` 3 spaces, tab 4 spaces); a plain line indented deeper than a list is a **child block** of that item. Paste·AI insertion·MCP·OKF use one place, `parentIdsByDepth`.
  3. **Writing markdown**: one level is 4 spaces, to-do `- [ ]  `, toggles as bullets, blank lines not between list items but only before and after other blocks — **identical to Notion down to the character** (exporting the same structure matches exactly the string Notion copies). Also fixed the `.md` download order scramble (sorted by `position` only), md-mirror's missing children, and OKF's flattening, so the **round-trip** (Notion markdown → our tree → our markdown → the same tree) holds.
  - Verification `node e2e/indent.check.mjs` (19 scenarios, 64 checks) + new `node e2e/markdown-nesting.check.mjs` (10 checks). `notion-paste` (default USER_ID updated to the current dev user)·`block-spacing`·`deselect`·`selection-copy`·`plus-menu`·`handle-menu`·`text-ops` pass again.
  - Left (§8): merging paragraphs indented without a list into one block, Backspace on the first child of a callout, leftover `.tmp-*` in md-mirror (a separate bug unrelated to nesting).
- **Deploy**: round 1 was excluded from the report, but `app-b07d8b4` was a HEAD snapshot so it went out too (2026-09-10). **Round 2 was not deployed.**

---

## QA-13 · Pasting markdown into an empty line **loses the first line** (P1) — **resolved (reproduced·verified on dev)**

- **Found**: 2026-09-10, reproduced on dev while working on QA-12 round 2 (markdown nesting). Not a report — we found it ourselves.
- **Symptom**: pasting `A⏎⏎B` into an empty paragraph **loses A**, leaving two blocks `""`, `B`. Not only on screen — it is stored empty too. When the first line **changes type**, like a heading or bullet, it was fine, so it was easy to miss.
- **Cause (confirmed)**: when paste absorbed the first parsed block into the empty target block, it set only `content.text`. This editor turns text changes of existing blocks into character CRDT operations **based on `content.html`** (`lib/editor/block-diff.ts:190`). With html empty, "delete everything" was computed, erasing the text just inserted. When the type changes, it goes through the whole-write path rather than character operations, which is why that case was fine.
- **Status**: resolved. On absorption, `html` is set too and the block's CRDT fields (`textInstance`/`items`/`marks`) are preserved. Verification: "the first line survives pasting into an empty block" and "a first line with inline formatting survives too" in `node e2e/markdown-nesting.check.mjs`.
- **Lesson (for the next person)**: when setting block text in code, write **text and html together**. Writing only text makes the CRDT empty that block.

## QA-14 · Workspace export (zip) returns 500, `.tmp-*` piles up in the mirror (P2) — **resolved (reproduced·verified on dev)**

- **Found**: 2026-09-10, during QA-12 round 2. `GET /api/workspace/export` returns 500 (`ENOENT … md-mirror/<ws>/<page>.md`).
- **Cause (confirmed)**: when md-mirror rewrites a whole workspace, it does `rm -rf <ws>` → `rename(<ws>.tmp-… → <ws>)`. When runs scheduled on every save overlap, (a) the directory changes the moment zip reads a file that was just in the listing, giving ENOENT, and (b) the `<ws>.tmp-*` of the side whose rename failed is left behind (14 had piled up on dev).
- **Status**: resolved. Mirror runs are serialized per workspace, each run clears its own `.tmp-*` at start, and zip skips files that vanished. Confirmed: `/api/workspace/export` 200, the mirror checks in `e2e/markdown-nesting.check.mjs` pass.

---

## Summary table

| ID | Title | Priority | Status | Cause certainty |
|---|---|---|---|---|
| QA-1 | Edits lost on save failure (KPI) | P1 | Fixed·deployed | Confirmed |
| QA-2 | Edits not reflected + offline message | P1 | Fixed·deployed | Confirmed |
| QA-3 | Pages mixed up on workspace switch | P1 | Resolved·deployed | Confirmed |
| QA-4 | Input blocked below sub-page | P1 | Resolved·deployed | Confirmed |
| QA-5 | Content disappears on leaving the screen | P1 | Mostly covered | Needs confirmation |
| QA-6 | Drag forces column split | P2 | Resolved·deployed | Confirmed |
| QA-7 | Projects My tab (board) cards don't open | P2 | Resolved·deployed | Confirmed |
| QA-8 | Notion DB sync request | P3 | Request | — |
| QA-9 | ⌘C after drag selection fails·selection styling differs | P1 | Resolved·deployed | Confirmed (Notion measured) |
| QA-10 | ⠿ menu Turn into doesn't work | P2 | Resolved·deployed | Confirmed (Notion measured) |
| QA-11 | No comment delete UI·function | P1 | Resolved·deployed | Confirmed (Notion measured) |
| QA-12 | Indentation differs from Notion | P1 | Resolved (round 1 deployed·round 2 not deployed) | Confirmed (Notion measured) |
| QA-13 | Markdown paste loses first line | P1 | Resolved (not deployed) | Confirmed (dev repro) |
| QA-14 | Workspace export 500·mirror tmp leftovers | P2 | Resolved (not deployed) | Confirmed (dev repro) |
| QA-15 | Blocks·subtrees lost in collapsed toggles | P1 | Resolved (not deployed) | Confirmed (Notion measured) |
| QA-16 | Content altered by markdown round-trip | P1 | Resolved (not deployed) | Confirmed (dev repro) |

## QA-15 · Blocks disappear in collapsed toggles, or collapsed content spills out (P1) — **resolved (Notion measured, verified on dev)**

- **Found**: 2026-09-10, in the adversarial audit of QA-12 round 3. Not a report — we found it ourselves.
- **What**: (1) pressing Tab when the previous sibling is a **collapsed toggle** moved the block into the toggle so it
  disappeared from the screen and the caret died, so **all typing after that was discarded**. (2) pressing Enter on a collapsed toggle's title
  moved its hidden children to the new block, so **the collapsed subtree spilled out**. (3) pressing Shift+Tab on types that
  cannot take children, such as headings and code, took the following siblings as children, creating a tree that Tab
  could never produce.
- **Reference**: re-measured in Notion — (1) the toggle **expands**, (2) a **sibling toggle** is created and the children stay put,
  (3) the following siblings are **not taken** (except that a collapsed toggle does take them). `docs/notion-indent.md` §8-2.
- **Fix**: `lib/editor/indent.ts` (`unfold`, no absorption for `NO_CHILDREN`), `block-editor.tsx`
  `splitBlock` (`foldedToggle`). Also: promoting children when deleting a container with Backspace,
  Enter's position collapse (renumber 1..n), splitting the undo group for typing right after Enter.
- **Comparison**: `node e2e/indent.check.mjs` (27 scenarios).

## QA-16 · One save/read cycle through markdown changes the content (P1) — **resolved (reproduced·verified on dev)**

- **Found**: 2026-09-10, in the same audit. On OKF pages, where the file is the storage, this was a path where **a single save changed
  the content**.
- **What**: line breaks inside table cells broke rows, `\|` split cells, and all-empty table rows and paragraphs consisting of a single `|`
  disappeared. ``` inside code bodies broke the block and the rest was lost, and inline markdown conversion ran on
  code·equation bodies. Paragraphs that looked like `- x` came back as bullets, and line breaks inside list items flattened the
  nesting beneath them. The mirror wrote children of `100. ` items with 4 spaces, overwrote callout icons with 💡, wrote
  equations without `$$`, and dropped sub-page links.
- **Fixes·list**: the §7-1 table in `docs/notion-indent.md`. One thing was also measured in Notion — a plain line directly
  below a list item **folds into that item** (M2c).
- **Comparison**: `node e2e/markdown-nesting.check.mjs` (37 checks).
- **Left**: empty paragraphs have no place in markdown (same in Notion). On OKF pages a single blank line
  disappears after one save/read — we chose to keep it the same as Notion.

## To reproduce·confirm next

- QA-5: reporter's page id·browser·app version, check leftovers in `transactions`/IndexedDB.
- QA-3·QA-7: deployed as `app-b07d8b4` (2026-09-10). Only real-use confirmation remains — for QA-3, open a ComCom page link with the personal workspace selected; for QA-7, click a card in the Projects "My" tab.
- Common: #qa-ainmem attached images·videos are in minio (`ainteams_prod_minio`) and were not viewed in this investigation. Query separately if needed.
