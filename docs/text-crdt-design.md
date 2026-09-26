# Stage 3 design — character-level text CRDT

This works out `docs/save-protocol-target.md` §1.2·§2·§5.5·§5.6·§6.2 at the implementation level. The reference is
the measurements in `docs/notion-save-protocol.md`: Notion sends text inside a block as character-level operations
(`insertText`/`deleteText`/`splitText`/`moveTextSlice`, `id:[clientId,seq]`, `originId`), and when two tabs type into the
same block at the same time, both sides merge into the same result. Now that stages 1 and 2 are done, this is the one
remaining difference.

## 0. Goals and non-goals

- Goal: when two people edit the same block at the same time, the server and both screens converge on the same text. Your
  own caret is not pushed around by remote insertions. All other save behavior (queue, retry, fan-out) stays as in stage 2.
- Non-goals: sharing cursor positions (already a separate `cursor` event), a CRDT for block order (`position` stays LWW —
  Notion's `listAfter` is also server-validated and caused no problems in measurements), and rewriting structural edits
  such as moving table cells.

## 1. Data model

```ts
type ItemId = [clientId: string, seq: number];        // seq is a Lamport clock: largest seq seen so far + 1
interface TextItem {
  id: ItemId;
  origin: ItemId | "start";   // the item immediately to the left at insertion time
  text: string;               // one or more characters — consecutive input is merged into runs by client and server (§6)
  attrs?: Attrs;              // { b, i, u, s, code, a: { href }, color, mention: { userId } }
  deleted?: true;             // tombstone
}
interface TextInstance { items: TextItem[] }          // stored in sorted order
```

- Block `content` gains `items: TextItem[]`. `content.text` and `content.html` continue to be stored as a **render
  cache** — search, mirror, export, MCP reads and history snapshots all read only the cache, so they do not change.
- Table blocks have one instance per cell: `content.table.cellItems[row][col]`. The cache is the current `cells[row][col]`.
- All other fields (`type`, `position`, `parentBlockId`, `checked`, `expanded`, image URL …) remain LWW.

### 1.1 Ordering rule (RGA, Lamport seq)

`seq` is not a per-client counter but a **Lamport clock**: a new item gets "the largest seq seen so far in that instance
+ 1". That is what places a just-typed character right after its origin (with a counter, it would have a smaller seq than
older neighbours and get pushed to the end of the run — the "insert after a deleted character" case in
`scripts/text-crdt.check.mts` is exactly that).

An item goes **immediately to the right** of the item its origin points to. If several items point to the same origin,
they are ordered by `seq` descending, then by `clientId` lexicographically — the result is the same regardless of the order
in which operations arrive. Ordering means "find the origin, then move right from there until the rule is satisfied", so
insertion costs O(n) and happens only within one block (a single paragraph of a few thousand characters is the upper bound).

Example: if two tabs simultaneously insert `x` (tab 1, seq 5) and `y` (tab 2, seq 3) after the B of `"AB"`, both have
origin B. By the rule, `x` (seq 5) comes first → both sides get `"ABxy"`. This is the same property as in the measurement
(`… A-tab B-tab`).

### 1.2 Deletion = tombstone

Mark with `deleted:true` and keep it (it may be someone's origin). It is skipped when rendering. When the server rebuilds
the cache, there is no point at which **every session can be assumed to have acknowledged it**, so only tombstones older
than 30 days are removed (based on `updatedAt`). A late insertion whose origin is a removed tombstone is rejected as
"origin missing" (§5.3) and the client rebuilds it from its own state.

## 2. Operations

Four are added to the `Operation` union. `pointer` points to the block and `path` to the instance
(`["content","items"]` or `["content","table","cellItems",r,c]`).

| command | args | meaning |
|---|---|---|
| `insertText` | `{ items: TextItem[] }` | Merge-insert the items. Several items per operation (e.g. one pasted fragment) |
| `deleteText` | `{ ranges: [ItemId, number][] }` | Tombstone `length` items starting at `id` |
| `formatText` | `{ ranges: [ItemId, number][], attrs: Partial<Attrs>, remove?: (keyof Attrs)[] }` | Merge/remove attrs over the range. Items straddling a range boundary are split by server and client using the same rule (§6) |
| `moveTextSlice` | `{ from: ItemId, toBlock: string, toPath, toOrigin: ItemId \| "start" }` | Move the item sequence from `from` to the end into another instance (ids kept; only the first item's origin becomes `toOrigin`) |

Notion's `splitText` is replaced by `moveTextSlice` (our block creation is a `set`, so "cut into a new block" becomes two
operations, `set` + `moveTextSlice`, in one transaction).

Details settled while implementing ② (`lib/transactions/types.ts`, `lib/text-crdt/ops.ts`):
- Every text operation's `args` carries `instance` (the id of the instance the operation was built against). If it differs
  from the server's instance, the transaction is rejected. **A block that has no instance yet adopts the id carried by the
  operation** — both sides build the same items (`["m",1..n]`) from the same html, so the coordinates match. This is how lazy
  migration happens: "when the first operation arrives".
- `formatText` overwrites the range not with an attrs object but with a **tag stack** `tags: string[]` (the opening tags the
  sanitizer emits, outermost first). The item model from ① holds formatting as a tag stack, so we matched that. `[]` clears
  formatting.
- In `moveTextSlice`, any item in the moved slice whose origin points to a character **left behind on the left side of the
  cut** (a concurrent insertion anchored there) is re-anchored to the last character of the preceding part of the slice. This
  is decided entirely within the slice, so all replicas agree.
- Cache rebuild is `mergeRuns` followed by `renderHtml`/`renderText`. For table cells, both `cells[r][c]` (text) and
  `html[r][c]`.

UI → transaction:
- Typing a character: `insertText` (one item at a time — Notion also sends an operation per character). In local state it is
  merged immediately by the §6 rule.
- Enter (in the middle): `set` (new block) · `moveTextSlice` (after the caret → new block `"start"`) · `update position`.
- Backspace (at block start): `moveTextSlice` (all of this block → end of the previous block) · `update {alive:false}`.
- Formatting shortcuts/toolbar: `formatText`. Markdown auto-formatting (`**a**` → bold) is `deleteText` (markers) +
  `formatText`.
- Paste (single line): `insertText` (multiple items, split at formatting boundaries). Multiple blocks: one `set` per block
  (including items).
- Table cell input: the same operations, only `path` points at the cell.

Changing text via the existing `update {content}` **disappears from the editor**. For server-side writes (PUT /blocks, MCP,
history restore), incoming `update {content:{text,html}}` / `set` has its items rebuilt by the server using the §6 rules.

## 3. Client — editor

### 3.1 State
`EBlock.content.items` is the source of truth. Rendering is items → (drop tombstones, merge adjacent pieces with equal attrs)
→ HTML. The renderer is aligned to produce the same HTML as the current `sanitizeInline` output (the existing e2e measures
exactly that).

### 3.2 Input → operations (matching measurements: uncontrolled, mutation-based)

Notion does not block `beforeinput` (`defaultPrevented:false`). The browser changes the DOM first, and Notion reads the result
to build operations (the transaction's `userAction` is `Text.handleMutation`). We do the same — **keep** the current `onInput`
(which reads the DOM), but instead of "save the whole block text", **compute the difference between the old and new text (a
single insertion/deletion span) and turn it into operations.**

| situation | operations |
|---|---|
| Typing / paste (single line) | `insertText` with the id of the character left of the diff span as origin |
| Deletion | `deleteText` over the diff span |
| Replacement (type over a selection, autocorrect) | `deleteText` + `insertText` |
| Enter | `set` (new block) + `moveTextSlice` + `update position` |
| Backspace (at block start) | `moveTextSlice` + `update {alive:false}` |
| Formatting shortcut/toolbar | `formatText` |
| IME composition | Emit operations **on every composition update** (Notion measurement: typing a Hangul syllable jamo by jamo produces `insertText` for the first jamo, then `deleteText`+`insertText` for each updated syllable). Do not wait for commit |

The diff strips common prefix and suffix, is O(n), and runs only within one block. If a remote change lands in the same block,
the "old text" must be the one after the remote change is applied, so the sequence is: merge remote → render → use that result
as the baseline for the next diff (§3.5).

### 3.3 Caret
Carry the caret not as a DOM offset but as an **item coordinate** (`{ after: ItemId | "start" }`). After rendering, convert
item → DOM offset (extending `lib/editor/caret.ts`). Even if a remote insertion lands left of the caret, the caret stays after
the same item — this is what lets us drop the current rule "the caret's block defers remote changes".

### 3.4 undo/redo
Replace snapshot diffs (`restoreSnapshot`) with **inverse operations**. Build the inverse alongside each transaction:
`insertText` ↔ `deleteText` (same ids), `deleteText` ↔ "revive" (`insertText` re-inserting the same id and origin — the server
handles it by clearing the tombstone), `formatText` ↔ `formatText` with the previous attrs, `set` ↔ `update {alive:false}`,
`update` ↔ `update` with the previous value. Undo is an ordinary transaction too (`debug.userAction:"undo"`).

### 3.5 Remote merge
Merge text operations received over SSE into local items and re-render. The caret is preserved per §3.3. Stage 2's
"defer the caret's block" is removed.

### 3.6 Performance (includes item 6)
- Wrap `BlockRow` in `memo` and pass a single block as props instead of the `blocks` array, so a keystroke re-renders **only
  that block**. Target: input → IndexedDB complete within 10ms on 229 blocks (Notion measured 2–9ms).
- The renderer rebuilds HTML only for blocks whose items changed.

## 4. Client — queue
Unchanged. Only transactions get smaller (one item ≈ 100 B).

## 5. Server

### 5.1 Applier
Add a text-operation applier to `applyTransactions`: read the instance (if missing, lazy conversion per §7), merge into items →
rebuild cache (`text`/`html`, `cells` for tables) → save. Multiple operations in one transaction share one DB transaction, as now.

### 5.2 Idempotence
Unchanged (transaction id). Text operations are also idempotent on their own (re-inserting an item with the same id is ignored).

### 5.3 Validation (before/after)
- `insertText`: if the origin is not in the instance (a late insertion after tombstone GC, or an out-of-order resend), **reject
  that transaction** → 4xx `rejectedIds`. The client rebuilds those items against the current state and sends again.
- `deleteText`/`formatText`: unknown ids are ignored (tombstones already GC'd).
- `moveTextSlice`: rejected if the target block belongs to a different page.

### 5.4 Fan-out
Same as stage 2 (`type:"transactions"`).

## 6. Merging runs — on both client and server

Live items **by the same person, with consecutive seq, the same attrs, and chained origins** are merged into one (id of the first
item, `text` concatenated). Measured: 13 pieces sent one per character were held by the client in the next operation's
`prevItems` as a single piece `id:[…,1], length:13` — the **client merges immediately in its own state**, and the server applies
the same rule when rebuilding the cache. An origin pointing to a character inside a merged item is resolved as
`[clientId, seq+offset]` (thanks to the consecutive-seq condition). Tombstones are merged by the same rule. When `formatText`
straddles the middle of a run, it is split at the boundary (split piece ids are deterministic: `[clientId, seq+offset]`).

## 7. Migration

- The server creates an instance **the first time it needs one**: if there are no `items`, split `html` at tag boundaries and
  store `[{ id: ["migration", 1..n], origin: previous item, text, attrs }]`. If there is no `html`, a single item from `text`.
  This is the same shape as `prevItems[0]` in the Notion measurement (`originId:"start"`, `id:[…,1]`). Not done all at once.
- A `set`/`update {content}` from a server-side write (PUT /blocks, MCP, restore) becomes a **new instance** (`textInstance`
  replaced, items rebuilt from html) — same as measured in Notion (after an API-style replacement, a new `textInstanceId`,
  `prevItems:[start]`). Late operations targeting the old instance are rejected on instance mismatch and the client rebuilds
  them. This conversion must land **before** the editor switch, so that writes which only change the cache do not leave items
  stale. (Implemented in ①: `lib/text-crdt/content.ts` `withTextInstance`; `normalizeContent` in `applyTransactions` applies
  to every content write.)
- **Canonical form.** `render(parse(h))` aims for DOM equality, not byte equality: stored html mixes `&quot;` and `"`, and has
  adjacent identical tags like `</b><b>`, which are normalized to one notation. All of dev's 7,150 and prod's 4,643 records were
  confirmed to preserve the character and tag sequence and to be idempotent; 58/53 of them change notation only.
- Old clients (tabs on a previous build that send `update {content}`) may still be around, so that shape is accepted via the
  same conversion. Tabs left open across a deploy do not corrupt data even without the new code.

## 8. Verification — completion criteria (added to §7)

| item | criterion |
|---|---|
| Concurrent editing | Two tabs append " A" and " B" to the end of the same block simultaneously → server and both screens show identical text containing both |
| Caret preservation | Even if tab B inserts before the caret, tab A's caret stays after the same character |
| Delete merge | Converges even when one side edits a range the other side deleted |
| IME | An operation per Hangul composition update (same as Notion); a remote insertion during composition does not break the composition; after commit the server text matches the screen |
| Size | Single-character request ≤ 1.2KB (one item) |
| Performance | Input → IndexedDB complete ≤ 10ms on 229 blocks |
| Regression | `block-spacing`(551)·`plus-menu`·`ime-enter`·`notion-paste`·`table-cellnav`·`table-grip` all pass |
| Cache | Search, export, mirror and MCP read results identical to before the switch |

## 9. Order

1. **Server conversion + lazy migration + cache rebuild** (§5.1 cache, §6, §7). No editor changes. All existing checks pass.
2. **Text-operation applier + validation** (§2, §5.3). API-level check (concurrent insertion with two client ids → converges).
3. **Editor** (§3.1–3.5). All regression checks + concurrent-editing, caret and IME checks.
4. **Performance** (§3.6). 10ms criterion.

Each step gets a commit, a dev measurement and a deploy. Step 1 has no schema change (it lives inside jsonb).

## 10. Decisions — closed by Notion measurements (`docs/notion-save-protocol.md` §4b)

| question | Notion | our decision |
|---|---|---|
| May a server-side full replacement (`update {content}`) break CRDT history? | After `set properties.title`, a new `textInstanceId`, `prevItems:[start]` — it breaks it | Same. Start a new instance (§7) |
| Late insertion pointing at a deleted origin | 200, placed at that spot (tombstone kept) | Same. Tombstone retention can't be measured in Notion, so **30 days** is our choice |
| Input handling | Uncontrolled, builds operations by reading DOM changes, an operation per IME composition update | Same (§3.2). No controlled rewrite — the risk dropped substantially |
| Render scope | One keystroke re-renders only 1 block | Include §3.6 in stage 3 to match |
| Merging consecutive input | Client merges too | Both sides (§6) |

## 11. Measurement results — 2026-09-09, two-tab concurrent editing (`scratchpad/notion-crdt-*.mjs`)

Measured directly on a Notion scratch page with the golden-set Chrome. We read the `insertText` in the `saveTransactions`
request bodies (`id:[clientId,seq]`, `originId`, `prevItems`), the converged text in both tabs, and IndexedDB.

**Confirmed consistent with our implementation (keep as is):**

| item | Notion measurement | ours (`lib/text-crdt`) |
|---|---|---|
| Concurrent insertion order | At the same origin and same seq, clientId `X-2…` comes before `01N2…` (lexicographically larger first) | `precedes`: seq descending → larger clientId. **Match** |
| seq | Two concurrently editing tabs stamp the same seq (42, 57) = logical clocks at the same point | Lamport ("largest seen + 1"). **Match** |
| Length and seq units | **UTF-16 code units**. 😀 len=4 (`A😀B`, seq +4), 👨‍👩‍👧 len=8, a two-character CJK word len=2, é (e+U+0301) len=2 (not normalized), spaces and tabs kept as is | `text.length` (UTF-16). **Match**. No normalization, whitespace preserved likewise |
| Run merging and split | `prevItems` has one piece `{id, length:2, content:"11"}` + `{type:"split", id, originId}` | `mergeRuns`·`splitAt`. **Match** |
| Convergence | Final text of both tabs always identical | RGA. **Match** |

**Difference — decision needed (formatting representation):**

Notion's formatting is not an item tag but a **boundary-anchored range annotation**:
```
addAnnotation / removeAnnotation {
  id, textInstanceId,
  start: { id:[c,seq], anchor:"before" },
  end:   { id:[c,seq], anchor:"before" },
  annotationKey: "b"        // bold. Links and colors presumably carry a value
}
```
Our `formatText` overwrites the tag stack on items in the range (implemented and deployed in ②). **For a single user the rendered
result is the same, but it diverges under concurrent editing**: if one tab bolds `[X,Y]` while another tab inserts characters
inside it, in Notion the anchored range covers the new characters and they **inherit bold**, while in ours the new item carries
the tags the editor chose (inherited from its left neighbour), so the result can differ **only under concurrency**. The common
case, "keep typing at the end of bold text", is the same on both sides thanks to left inheritance.

- **Option A (full parity):** Reimplement formatting as a boundary-anchored range-annotation layer like Notion. Items hold only
  characters; formatting is a separate overlay (`annotationKey` + start/end anchors). Even concurrent formatting would match
  Notion. The tag approach from ② is discarded and reworked.
- **Option B (keep current):** Keep item tags. Only the rare case "two people format and type in the same span at the same time"
  differs; everything else matches. The ③ editor inherits the left neighbour's formatting on insertion to cover the common case.

Mentions and links follow this decision (annotations under A; `<a>`/`<span>` tags as now under B). In Notion, links are likely
annotations with a value (same family by form), but what we measured cleanly this time only goes as far as formatting (b).

**Not measured due to harness limits:** Notion's representation of a Shift+Enter soft line break (could not reproduce with CDP key
events — we keep a `br` item `\n`), and the exact caret scenario for concurrent delete-vs-insert (convergence confirmed, precise
position control failed). Both are low-risk, and our implementation is verified by `e2e/text-ops.check.mjs`.
