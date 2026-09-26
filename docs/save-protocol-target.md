# Save protocol — target definition (same as Notion)

Every reference value comes from the measurements in `docs/notion-save-protocol.md`. This document states, without omissions,
what "matching those measurements" means. Implementation proceeds in the stages of §9 below, but **the state at the end of each
stage must measure zero difference against the corresponding section of this document.** It is closed by measurement, not by
judgment (same as the Projects rule in `CLAUDE.md`).

## 0. Three principles

1. **Don't send the document. Send only what changed, as operations.** Request size is proportional only to the size of the edit.
2. **Write locally before sending, and delete once the server acknowledges.** It is not "save when it fails". No edit disappears
   without acknowledgement. There is no "giving up" such as a 24-hour expiry.
3. **Sending the same thing twice applies it only once.** For retries, recovery and duplicate sends to be safe, the server must be
   idempotent by transaction id.

## 1. Data model

### 1.1 Block record

The current `blocks` row is the record as is: `id`, `pageId`, `type`, `content`, `parentBlockId`, `position`.
What changes is **how text is held** (§1.2) and **how deletion is represented**.

- Deletion does not remove the row; it marks `alive=false` (Notion's `update {alive:false}`). Reviving (undo, re-applying a
  recovered transaction) must be possible with the same id. Read paths only see `alive=true`. Physical deletion happens in a
  batch after the history retention period.
- Order stays as now: `position` (a float, the midpoint of neighbours) + `parentBlockId`. Notion inserts into the parent's
  `content` array with `listAfter/listBefore/listRemove`, but the two approaches are equally expressive and ours finishes with a
  single `position` update. **What we measure and compare is not "what gets stored" but "how many bytes are sent when, and what
  is never lost"**, so we keep our representation here.

### 1.2 Text = character-level CRDT (text instance)

The formatted text of one block is held as one **text instance**. This corresponds to Notion's `textInstanceId`.

- **item**: `{ id: [clientId, seq], originId: [clientId, seq] | "start", content: string, attrs, deleted }`.
  `id` is which piece this client created (`seq` increases monotonically per client), and `originId` is "the item immediately
  to the left of this one". Same meaning as `insertText.args.id / originId` in the Notion measurement.
- **Ordering rule** (RGA/YATA family): when several items point to the same `originId`, order by `id` (seq descending, then
  clientId lexicographically). Whatever order two clients receive operations in, the result is the same — this is why, in the
  measurement, two tabs typing into the same block at the same time both ended up as `… A-tab B-tab`.
- **Deletion is a tombstone** (`deleted=true`). The piece stays and is skipped when rendering. It is not physically removed so as
  not to break `originId` references. Old tombstones are cleaned up at server snapshot time (§4.6).
- **Formatting** is the item's `attrs` (`b`, `i`, `u`, `s`, `code`, `a{href}`, `color`, `mention{userId}` …). Formatting changes
  are done with the `formatText` operation (§2), marking the items in range after splitting them at attrs boundaries.
- **Rendering**: concatenate items in order, skipping tombstones, and merge adjacent pieces with equal attrs to produce HTML. The
  current `content.html`/`content.text` keep being stored as a **cache** of this rendering (so search, mirror and MCP reads keep
  using them). The item sequence is the source of truth.
- **Caret**: DOM offset ↔ item position conversion. The `originId` for an insertion is "the id of the character left of the
  caret". If the caret is at the start of the block, `"start"`.

### 1.3 Non-text fields

`type`, `position`, `parentBlockId`, `alive`, and the non-text parts of `content` (checked state, collapsed state, image URL,
table data …) are **last-writer-wins**. Notion treats `update` the same way (evidenced by sending `last_edited_time` along).
Table cell text also follows §1.2, with each cell as its own text instance.

## 2. Operation catalogue

Operation = `{ command, pointer: { table: "block" | "page", id }, path: string[], args }`. The server applies each operation with
the meaning below, **atomically per transaction**.

| command | pointer.path | args | meaning | Notion measurement counterpart |
|---|---|---|---|---|
| `set` | `[]` | whole record | Create a block (create if missing, replace entirely if present) | Enter's `set` |
| `update` | `[]` or field path | partial fields | LWW update of scalar fields. `alive:false` is deletion | `update` |
| `insertText` | instance path such as `["content","text"]` | `{ instanceId, id, originId, content, attrs }` | Insert an item | `insertText` |
| `deleteText` | same | `{ instanceId, idRanges: [[id, length]] }` | Tombstone a range | `deleteText` |
| `formatText` | same | `{ instanceId, idRanges, attrs }` | Format a range | (Notion uses `update` + a formatting path) |
| `splitText` | same | `{ instanceId, id }` | Cut from `id` onward into a new instance | `splitText` |
| `moveTextSlice` | same | `{ instanceId, fromId, targetBlockId, targetInstanceId, targetOriginId }` | Move a cut sequence of pieces to the end / a specific position of another block | `moveTextSlice` |

UI action → transaction (order of operations) follows the measurement table (`notion-save-protocol.md` §1) exactly.
- Typing a character: `insertText` · `update last_edited`.
- Enter: `set` (new block) · `update` (parent/position) · `update last_edited` (new block and page).
  If the caret is in the middle, `splitText` · `moveTextSlice` come first.
- Backspace (character): `deleteText` · `update last_edited`.
- Backspace (at block start): `splitText` · `moveTextSlice` (into the previous block) · `update {alive:false}` · `update last_edited`.
- Drag move: `update {parentBlockId, position}`.
- Type conversion: `update {type}` (+ any required `content` fields).
- Paste (multiple blocks): one `set` per block, in one transaction.

`last_edited` is `updatedAt` in our schema plus the page's `updatedAt`. The server fills them with the apply time.

## 3. Transactions

```
{ id: uuid, pageId, userId, timestamp, debug: { userAction, clientCommitTimeMs }, operations: Op[] }
```

- **One user action = one transaction.** `debug.userAction` names the handler (`Text.handleMutation`, `Text.handleEnter`,
  `textBackspaceAtBeginning` …). It is for debugging and carries no semantics.
- The server **accepts or rejects a transaction as a whole**. If one operation fails, the rest of that transaction is not applied
  either.
- **Idempotent**: if the `id` has been seen, it is not applied again and success is returned.
- Order: transactions created by one session are sent in creation order and the server applies them in that order. Order relative
  to other sessions' transactions need not be guaranteed — CRDT (text) and LWW (scalars) were designed on that premise.

## 4. Server

### 4.1 Endpoint

`POST /api/saveTransactions` — like Notion's `saveTransactionsFanout`, **a single endpoint independent of page**.
Body `{ requestId, transactions: Transaction[] }` (each transaction carries `pageId`), response is **`{}` (200)** — same as the
Notion measurement. Permissions are checked per page (edit permission of the session or share token; `pageMembers` for
`restricted` pages). If there are transactions that can never be applied (no permission, malformed), respond **4xx** with
`{ errorId, name, message, rejectedIds }` naming those ids (this follows Notion's API error shape, but that part is our choice,
not measured). The client removes only the named ones from the queue and reports them with a badge; the rest are retried
(already-applied ones are harmless thanks to idempotence). A 401 is not discarded but retried, since the session may come back.

### 4.2 Apply procedure (per transaction, inside one DB transaction)

1. If `id` exists in the `transactions` table, skip (success).
2. Apply operations in order. Text operations read the instance, merge into the item sequence and rebuild the
   `content.text/html` cache. `set`/`update` upsert the row.
3. Update `updatedAt` of the affected blocks and the page.
4. Record `(id, pageId, userId, appliedAt, operations)` in `transactions` — for idempotence checks and auditing.
5. Commit. On failure, roll back and put it in `rejected`.

### 4.3 Validation (Notion's before/after)

- Text operations: reject if the item that `originId` points to is not in the instance (out-of-order resend). If a `deleteText`
  range points to unknown ids, ignore just that part.
- `set`/`update`: reject if the target block belongs to a different page. An `update` on a block that is already `alive=false`
  is applied (including revival).
- Permissions are checked once per request.

### 4.4 Fan-out (real time)

Currently, after `publish({type:"blocks"})`, receivers GET all blocks again. The target is to **send the applied transactions
themselves over SSE** and have receivers apply the same operations to local state (`type:"transactions"`, with body). Own
transactions are filtered out by `clientId`. A full GET happens only once, right after an SSE reconnect.

### 4.5 Side effects

Mention notifications (`notifyMentions`), snapshots (`maybeSnapshot`) and the md mirror (`scheduleMirror`) — whatever `PUT /blocks`
does now — are done the same way after applying transactions.

### 4.6 Snapshots and tombstone cleanup

`page_snapshots` stores rendered blocks (the cache), so it does not change. At snapshot time there is no guarantee that every
session of that page has acknowledged (= has an empty queue), so only tombstones older than **30 days, server time,** are removed.

### 4.7 Existing write paths

`PUT /blocks`, `POST /blocks`, MCP (`relational-memory-mcp`), Notion paste, duplication, templates and every other server- or
script-side write is **converted into transactions inside the server** and goes through the same apply procedure. The moment a
non-editor write bypasses the item sequence and changes only `content.text`, the CRDT breaks, so this is the most important
migration condition.

## 5. Client — transaction queue

### 5.1 Storage: IndexedDB `TransactionStore`

- `Transaction` (keyPath `index` auto-increment; indexes `byId`, `bySessionId`, `byTimestamp`, `byUserId`):
  record = the transaction as is + `sessionId`.
- `Session` (keyPath `index`; indexes `bySessionId`, `byOwnerSessionId`, `byUpdatedAt`):
  `{ sessionId, ownerSessionId, updatedAt }`. One tab = one session. `updatedAt` is the **heartbeat** (every 5 seconds).

### 5.2 Lifecycle

1. `mutate` creates a transaction → **first** puts it in `Transaction` and **waits for the write to complete** (measured: add
   2.6ms → complete 3.1ms → fetch 4.7ms) → applies it to screen state → notifies the queue. Nothing is sent before the write
   completes.
2. The queue sends **only one request at a time**. When idle, the first transaction goes out **immediately** (≤ 10ms). When a
   response arrives, **500ms later** it sends **everything** accumulated in the meantime **in one request**.
3. On 200, delete the sent transactions from `Transaction`. `rejected` ones are deleted and the user is notified.
4. Failures (network, 5xx, browser refusal) resend **the same body with the same transaction id after 5 seconds**. No exponential
   backoff (measured fixed 5.0 seconds).
5. `keepalive` is not used. When a tab closes, the in-flight request is cut and its transaction stays in the queue.

### 5.3 Sessions and orphan recovery

- **Only while there are pending transactions** does a tab keep its own record in `Session`, updating `updatedAt` every
  **2.5 seconds** (measured 2,505 ms). When the queue empties, the row is deleted — an idle tab does not touch IndexedDB.
- 1 second after start, and every 2.5 seconds, look for sessions whose `updatedAt` has stalled for more than **12.5 seconds**
  (5 beats), move their transactions to your own session (update `ownerSessionId`) and send them. In measurements, a live tab
  recovered a dead tab's transactions 13.6–13.7 seconds after the close, and with these values it happens within 12.5–15 seconds.
  It is done not only when a new tab opens but by **any live tab**.
- So that multiple tabs of the same origin don't recover at the same time, the `ownerSessionId` update is done conditionally
  (only if it is still the original owner) inside an IndexedDB transaction.

### 5.4 On-screen indication

- Saving is silent (`data-save-state` is kept for tests: `idle | saving | saved | offline | error`).
- If the queue is non-empty and the last attempt failed, show a badge in the top right. Network failure shows `Offline`; server
  rejection/5xx shows `Save failed`. Both append "changes are kept in this browser". On success the badge disappears.
- If something remains in the queue (`beforeunload`), **do not** show the browser's default confirmation dialog — Notion doesn't
  either, and the next session recovers it.

### 5.5 Remote reception

Apply transactions received over SSE to local state. Blocks overlapping with this session's unacknowledged transactions are simply
merged by CRDT/LWW rules — the current "defer if dirty" goes away. The block holding the caret is no exception (the caret is
re-placed by item).

### 5.6 undo/redo

Local history is built from **inverse operations**: `insertText` ↔ `deleteText`, `update` ↔ `update` with the previous value,
`set` ↔ `alive:false`. Undo is a transaction too (`debug.userAction: "undo"`).

## 6. Migration

1. Schema: `blocks.alive boolean default true`, `blocks.content.textItems` (the instance sequence), and a `transactions` table.
   Keep the structure where `pnpm db:check` and `/api/health` report what is missing (`schema-drift.ts` automatically checks every
   table in `schema.ts`). **Stage 1 adds only the `transactions` table** — pushed to dev on 2026-09-08; for prod, a person has to
   run `pnpm db:push` once at deploy time (`deployment.md` §3.6). Otherwise the boot log and `/api/health` (503) report that the
   table is missing, and every editor save gets stuck in the 5-second retry and piles up in IndexedDB (nothing is lost).
2. Initialize existing text → a single item: `{ id: ["migration", 1], originId: "start", content: text, attrs }`.
   Same shape as `prevItems[0]` in the Notion measurement (`originId:"start", id:[…,1], length:14, content:"probe …"`).
   Formatting is obtained by parsing `html` and splitting at attrs boundaries. The server migrates **lazily on read** (creating
   and saving the instance if missing) instead of all at once.
3. Switch the editor to items only after non-editor writes (§4.7) have been converted to transactions. In the reverse order,
   writes that only change the cache would leave items stale.
4. Old `localStorage` drafts (`draft-*`, `draft-archive-*`) are, when found, enqueued as `update {content}` transactions and
   deleted.

## 7. Measure — completion criteria

Each item must be measured on dev with `app/e2e/*.check.mjs` and exit 0. Numbers are measured values.

| item | criterion |
|---|---|
| Request size | Typing one character on a 227-block, 65KB page → request ≤ 2KB |
| Latency | First input while idle → request ≤ 50ms (with sending after the IndexedDB write completes, on a page with a light re-render); next request 450–600ms after a response; 1 in flight. On the 227-block page the re-render gets in between: 477ms as of 2026-09-08 — this value is the baseline for the typing-latency (performance) work |
| Batching | 5 keystrokes while awaiting a response → 5 transactions in the next request |
| Local retention | 5 keystrokes offline → 5 `Transaction` records; back online → 0 |
| Retry | 5.0±0.5 second interval while offline, same id |
| Idempotence | Same request twice → 1 block |
| Tab close | Close 10ms after input → open a new tab, reflected on the server within ≤ 15 seconds |
| Concurrent editing | Two tabs type " A" and " B" into the same block → identical final text on both sides, containing both |
| No loss | In all the scenarios above, the server's final state includes all input |
| Badge | Shows `Offline` while offline, disappears after reconnecting |

## 8. Out of scope

- `keepalive`/`sendBeacon` — Notion does not use them, and the queue takes that role.
- 24-hour draft expiry, save only on failure — removed.
- Whole-document PUT — removed from the editor path. `PUT /blocks` remains only for script/MCP compatibility and is converted into
  transactions inside the server.

## 9. Stages

| stage | content | done criterion (§7) |
|---|---|---|
| **1 (done 2026-09-08)** | Block-level operations (`set`/`update`/`alive`), IndexedDB queue (all of §5), idempotent server (§4.2·4.5; text is `update {content}` LWW), recovery of old drafts | Request size, latency, batching, local retention, retry, idempotence, tab close, badge |
| **2 (done 2026-09-08)** | Single global endpoint + `{}` response (§4.1), in-server transaction conversion (§4.7: `PUT/POST /blocks`, history restore), `alive` soft delete (§1.1, 14 read sites filtered), transaction fan-out over SSE (§4.4; only content changes to the block holding the caret are deferred to the next full sync) | Remote changes applied without a full GET, response body `{}`, deletions disappear from GET while rows remain |
| 3 | Text CRDT (§1.2 · §2 text operations · §5.5 · §5.6 · §6.2) | Concurrent edits merge |

When stage 1 is done, all three causes of this incident (sending the whole document, judging by character count, 24h deletion) are
gone. Once stage 3 is reached, even two people editing the same block at the same time behave the same as in Notion.
