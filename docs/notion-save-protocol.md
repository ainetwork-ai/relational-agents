# Notion's save protocol — measurements (2026-09-08)

Reference values for making our editor's autosave behave like Notion. Everything was measured directly by attaching the
golden-set Chrome to a Notion scratch page (`app.notion.com/p/comcom/3c8d8655…`, designated by a person).
The measuring scripts are `scratchpad/notion-save-probe.mjs`, `…probe2.mjs`, `…probe3.mjs`, and the raw data is the
`*.out.json` / `*.idb.json` next to them. Blocks created by the probes were deleted at the end (page block count 2 → 2).

## 1. What is sent — operations, not the document

- Endpoint: `POST /api/v3/saveTransactionsFanout`, body `{ requestId, transactions[] }`.
  The response is always `{}` (200). It returns no result — this should be read as idempotent handling by transaction id.
- Transaction: `{ id, spaceId, debug: { userAction, clientCommitTimeMs }, operations[] }`.
  One user action = one transaction (`Text.handleMutation`, `Text.handleEnter`,
  `textBackspaceActions.textBackspaceAtBeginning` …).
- Operation: `{ command, pointer: { table, id, spaceId }, path, args }`. **Changes only part of one record.**

| action | operations (in order) |
|---|---|
| Type one character | `insertText` (block, 1 character) · `update` (block, last_edited_*) |
| Enter (new block) | `set` (whole new block) · `update` (parent_id/alive) · `listAfter` (parent `["content"]`, after=previous block) · `update` (last_edited_*) · the first one also sends `update` (last_edited_*) to the parent page |
| Backspace (character) | `deleteText` (idRanges) · `update` (last_edited_*) |
| Backspace (before an empty block) | `splitText` · `moveTextSlice` (into the previous block) · `update` (alive:false) · `listRemove` (parent `["content"]`) · `update` (last_edited_*) |

Text inside a block is a **character-level CRDT**. `insertText.args = { textInstanceId, id: [clientId, seq],
originId: [clientId, seq] | "start", content, prevItems }`, `deleteText.args.idRanges`. When two tabs simultaneously inserted
" A-tab" and " B-tab" into the same block, both requests returned 200 and the final text on both sides was the same,
`… A-tab B-tab` — a merge, not a conflict.

Size: a single-character request ≈ 1.0KB, Enter ≈ 1.7KB. **Independent of document size.**

## 2. When it is sent

| situation | measurement |
|---|---|
| First input while idle | Immediately, 3–11ms later (once 241ms) |
| Next send after a response | **≈500ms** after the response (501·507·509·510·511), sending the transactions accumulated in between **in one request** |
| In flight | Always **1**. If one is in progress, it queues and waits |
| Server response time | 224–616ms |
| Offline retry | **5.0-second interval** (5035·5012), resending **the same body with the same transaction id** |
| Offline indication | The text "Offline" appears on screen |

### Is it the same on a large page — values measured on 229 blocks (`…probe6.mjs`)

We created the same 227 Korean-language paragraphs as our e2e on the scratch page and typed characters one at a time into the
last block.

| sample | input→`Transaction` add | →write complete | →fetch | →response |
|---|---|---|---|---|
| 1 | 1.2 ms | 1.7 ms | 3.3 ms | 345 ms |
| 2 | 5.0 | 5.6 | 166 | 498 |
| 3 | 6.1 | 7.1 | 334 | 620 |
| 4 | 8.3 | 9.0 | 481 | 763 |
| 5 | 7.1 | 8.0 | 9.2 | 327 |
| 6 | 7.8 | 8.5 | 195 | 470 |

- **2–9 ms to IndexedDB write completion.** Even with 229 blocks, input handling and local storage are not blocked by rendering.
  Our editor takes 380–480 ms under the same conditions (the complete event arrives after React synchronously re-renders 227 rows).
- fetch is scattered between 0 and 480 ms after completion. On the small page (§2) it was also scattered between 3 and 330 ms, so
  it is not due to page size; Notion's queue appears to flush on a fixed period (≈500 ms). The difference from our queue, which
  sends immediately, is within a range invisible to users.

## 3. Where it is kept — IndexedDB `TransactionStore`

- Store `Transaction` (keyPath `index`, indexes byId · bySessionId · byTimestamp · byUserId).
  Record = `{ id, userId, spaceId, timestamp, debug, operations[], sessionId, index }` — the transaction exactly as sent.
- Store `Session` (keyPath `index`, indexes byOwnerSessionId · bySessionId · byUpdatedAt).
  Record = `{ sessionId, ownerSessionId, updatedAt, index }` — a heartbeat announcing that the tab (session) is alive.
  **It exists only while there are pending transactions** (when the queue is empty there is no row — an idle tab observed for
  25 seconds had 0 rows). With one transaction held pending offline and observed for 40 seconds (`…probe8.mjs`): the `updatedAt`
  update interval was **2,505 ms × 15 times**, i.e. a fixed 2.5 seconds.
- **Every transaction stays here until the server returns 200, and is deleted when it does.** Measured while typing online:
  0 records; 5 keystrokes offline: 5 records; after reconnecting: 0.
- It is not a save-only-on-failure scheme. It saves **before** sending, and sends **after the write completes**.
  Order measured for one character (`…probe4.mjs`, wrapping `IDBObjectStore.add`·`complete`·`fetch`):
  input 0ms → `Session` add 2.3ms → `Transaction` add 2.6ms → write complete 3.1ms → fetch 4.7ms → response 321ms.

## 4. When a tab closes

- The save fetch does **not** use `keepalive` (all 14 were `keepalive:false`, no `sendBeacon`).
- If the tab is closed 10ms after input, that transaction does not reach the server. Instead it stays in IndexedDB.
- When a new tab opens the same page, the leftover transaction (orphan) is visible as is (`Transaction:1`, `Session:1`), and
  **about 8 seconds after opening** the queue emptied and the character appeared.
- Recovery timing re-measured (`…probe7.mjs`, three times): relative to when the tab was closed, **13.7 seconds** (new tab opened
  right after closing), **13.6 seconds** (an already-open other tab recovered it), and when a new tab was opened 30 seconds after
  closing, **it had already been recovered** (the open golden-set tab did it).
  So recovery is done not "when a new tab opens" but **periodically by any live tab**, about 13.6 seconds after death.
  With a 2.5-second heartbeat, that is the value you get from treating a session that missed 5 beats (12.5 seconds) as an orphan
  and taking it on the next check. This resend was not captured on the page context's network — Notion runs shared workers
  (`wasm-sqlite-shared-worker`, `opfs-*-cache-worker`) and a service worker, so it apparently went out from there. Which one sends
  it does not matter for our implementation.
  The rule is: **"the next session recovers and sends the previous session's unacknowledged transactions"**.

## 4b. Four things about the text CRDT — measurements for stage 3 design decisions (`…probe9.mjs`, 2026-09-08)

| question | what was measured | result |
|---|---|---|
| Is input handling controlled? | `defaultPrevented` of `beforeinput` | **No.** Both `insertText` and `insertCompositionText` are `prevented:false`. The browser changes the DOM first and Notion follows — the transaction's `userAction` is literally `Text.handleMutation` |
| Are operations sent during IME composition? | Compose a Hangul syllable in three steps (initial consonant → consonant+vowel → full syllable with final consonant), then commit | **Yes.** On every composition update: `insertText` with the first jamo, then `deleteText` + `insertText` with the updated syllable … It does not wait for commit |
| What happens to the CRDT after an API-style full replacement? | Replace text via `set ["properties","title"]` → type one character | The replacement returns **200 `{}`**. The next `insertText` has a **new `textInstanceId`**, `prevItems:[{type:"start"}]`, `origin:"start"` — the old piece history is cut and the instance starts over |
| Late insertion pointing at a deleted origin | A, offline, inserts `Q` after the last character → B deletes that character → A comes back | **200, both sides end with the same text: the two preceding characters followed by `Q`.** The tombstone remains, so `Q` is placed at that spot. Retention period cannot be measured within a day |
| Number of blocks re-rendered by one keystroke | 60 blocks, count blocks whose DOM changed via MutationObserver | **1.** Only the edited block changes |
| Merging consecutive-input pieces | The next `prevItems` after 13 pieces sent one per character | The client also holds them as **one piece** `id:[…,1], length:13` — merging happens on both client and server |

Aside: the title (a page block's `properties.title`) uses the same text editor and the same operations. A new block's `set` carries
`crdt_data.title` (`crdt_format_version:1`, a node tree with start/end sentinels) alongside `properties.title` (the rendered
result) — stored twice, as "CRDT source + render cache".

## 5. Differences from ours (HEAD as of 2026-09-08)

| | Notion | ainmem |
|---|---|---|
| Unit of transmission | Operations on changed records | All blocks of the page |
| Payload | ≈1KB, independent of document size | Proportional to document size (65KB for the page in this incident) |
| Local retention | IndexedDB before sending, deleted after acknowledgement | localStorage only on failure, deleted after 24h |
| Retry | 5 seconds, idempotent resend with the same id | 5 seconds, resend the whole document |
| Concurrent editing | Character-level merge | Last full copy overwrites |
| Tab close | No keepalive, next session recovers | keepalive (64KiB limit, judged by character count, not bytes) |
| Server response | `{}` | Full block list |

## 6. To decide before implementing

1. **Text granularity.** Going with a character-level CRDT like Notion makes even concurrent-edit merging identical, but it is a
   big job that changes the text model, history and the MCP write path. Starting with block-level `set content`
   (last-writer-wins) makes sections 1, 2, 3 and 4 identical and differs only when the same block is edited concurrently.
2. **Server.** The current `PUT /blocks` accepts partial updates but is not idempotent (sending the same request twice applies
   it twice, and insertions are duplicated). We need an endpoint that takes a transaction id and applies it only once.
3. **Storage.** localStorage drafts → IndexedDB queue (`Transaction`, `Session`) + session heartbeat + orphan recovery.
