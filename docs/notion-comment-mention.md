# Mentions (@) in comments — Notion measurements (2026-09-10)

comcom: "Measure the comment mention feature — the algorithm that searches people when you type @,
the case where the query contains spaces, the select modal, and so on — systematically, and implement it
exactly like Notion. Include the notifications in the inbox too."

Measured on the original by **actually typing `@` into the comment input**. Measured in the page
comment input of `Hyeonjeong test › New page` and in the left-hand `Inbox`. **Not a single comment
was sent** — text was only typed into the input and erased, so nothing was left behind in the original.
Measurement scripts are in the session scratchpad (`mn1*.mjs`), raw data in `n-mention-*.jsonl`.

## 0. Two preconditions for measuring (for the next person)

- The menu only opens if you **click the input with a real mouse**. If you place the caret with JS
  `.focus()`, characters are inserted but Notion never sees the trigger and the menu does not open.
  Not knowing this cost three wasted attempts.
- **One** `Input.dispatchKeyEvent({type:'keyDown', text})` **is one character**. Adding a `char` event
  on top inserts two characters (`@` becomes `@@`). ⌘A → Backspace is the reliable way to clear.

## 1. When it opens and when it closes

| Input | Menu |
|---|---|
| `@` in an empty input | **Opens** |
| `x@` (directly after a character, no preceding space) | **Opens** — word boundaries are not checked |
| `x @` | Opens |
| The `@` button to the right of the input (24×24, `aria-label` = the "Type the person, page, or date you want to mention." string in the ko dictionary) | Opens. Pressing it **actually inserts** `@` **into the input** |
| **The first character after `@` is a space** (`@ `) | **Closes** |
| `@hyeon ` (space after the query) | **Does not close.** Results are the same as `@hyeon` |
| `@hyeon jeong` (space in the middle of the query) | Stays open and keeps searching with **the whole query, space included** |

So the answer to comcom's question about **"the case with spaces"**: **only a space immediately after
`@` cancels; after that, spaces are part of the query**. Our block editor currently closes
unconditionally as soon as it sees `/\s/` (the `@-mention live query` in `block-editor.tsx`), which
differs from the original.

## 2. Search algorithm — people

23 queries were typed and the resulting lists recorded verbatim (`n-mention-battery.jsonl`).

| Query | People results (in order) | What it tells us |
|---|---|---|
| `hy` | HyeonJeong Jun (me) · Hyoeun Lee · Hyemin Kwak · Jang Hyeonuk (Hangul display name) · Minhyun Kim | **Prefix matches rank higher**; `Minhyun` is a mid-word match so it is lower |
| `eon` | HyeonJeong Jun (me) · Seonghwa Yun · Bobae Jeon · Seongmin · Jaeyeon Ahn | **Also matches mid-string substrings** (not prefix-only) |
| `HYEON` | **Exactly the same** as `hyeon` | Case-insensitive |
| `jun` | HyeonJeong Jun (me) · eunjung jo · Lee Junmin (Hangul display name) | Matches the **second word** too, and **the romanization of a Hangul name** |
| `kim` | KimSan · Minhyun Kim · Bansuk Kim · KimGloria · kimHyunJeong | Prefix first, second word below |
| `hyeonjj` | **Only HyeonJeong Jun (me)** | **Matches the email local part (hyeonjj@)** |
| `comcom` | Every internal member + `15 more results` | **Matches the email domain too** |
| The bare Hangul initial consonant *h* (U+314E) | Five members with Hangul display names whose syllables start with *h* | **Hangul initial-consonant (choseong) search works** |
| `Hyeonjeong` spelled in Hangul | **No results** | If the display name is romanized, Hangul does not match it (there is no romanization ↔ Hangul conversion) |
| `zzzqqq` | No results | See §4 below |

Rules derived:

1. **Substring, case-insensitive.** Not prefix-only.
2. **Display name and email are both searched.** For email, both the local part and the domain.
3. **Hangul is also matched by initial consonants** (the initial *h* → a name whose first syllable starts with *h*).
4. **Order**: match at the very start of the name > match at the start of a word > mid-word match.
   Within the same tier, **yourself first** and **guests last** (guest rows carry the `Guest` badge).
5. **Up to 5 people** are shown, followed by a `N more results` row (that row is itself one line of the list).

## 3. Select modal — measured values

Card is **330 × max 325**, radius **10px**, white background, no border, `overflow-y: auto`.

```
box-shadow: rgba(25,25,25,0.05) 0 20px 24px,
            rgba(25,25,25,0.027) 0 5px 8px,
            rgba(42,28,0,0.07) 0 0 0 1px;
```

| Part | Value |
|---|---|
| Card top padding → first section header | 14 |
| Section header (`Date` · `People` · `Link to page` · `Groups`) | 12px / 500 / rgb(125,122,117), height 14, indented **12** from the left |
| Below section header → first row | 9 (23 from the header top) |
| Row | **322 × 28**, radius **6px**, **4** horizontal inset, vertical pitch **29** |
| Row icon/avatar | **20 × 20**, left **8** |
| Row name | 14px / 400 / rgb(44,44,43), left **36** |
| `(me)` tag on my row | Same 14px, rgb(125,122,117) |
| Highlight (keyboard/hover) background | `rgba(33,27,23,0.051)` (= `color(srgb .1294 .1059 .0902 / .051)`) |
| Page row | Height **45** (two lines), title 14px rgb(44,44,43), path below it 12px rgb(161,158,153) |
| Group row | Name + `N members` |

Section order is not fixed. Initially (just `@`) it is **Date → People → Link to page → Groups**, but
the best-matching section moves up depending on the query (`@ye` gives People → Date → Link to page).

**Keyboard**: ↓/↑ move **one row at a time** across sections (not section by section). The list is a
**single flat list** spanning dates, people and pages, and `N more results` is one of those rows.

## 4. When there are no results

The card shrinks to **330 × 65** and only a single `No results` line remains — 14px / 400 / rgb(125,122,117),
**12** from the card's left, **9** from the top. (The `Send search feedback` link below it is Notion's own, so we do not copy it.)

## 5. What goes into the input when you pick

```html
<span contenteditable="false" style="color:var(--c-texSec)"
      class="notion-text-mention-token notion-enable-hover notion-focusable-token"
      data-token-index="0" tabindex="0"
  ><span></span
  ><span><span style="color:color-mix(in srgb, currentColor 60%, transparent)">@</span>HyeonJeong Jun</span
  ><span></span
></span>&nbsp;
```

- **It is not a chip.** Background, radius and padding are all 0; only the text is in the secondary
  color (rgb(125,122,117)), and **only the `@` glyph is lighter, at 60% of that color**. (The `mention`
  entry in `src/i18n/content/e2e-fixtures/notion-row-comments.json` already records the post-send look with the same
  values — while typing and after sending look the same.)
- **One trailing space** is inserted along with it.
- The token is `contenteditable="false"`, so it is **one atomic unit**. Pressing Backspace right after
  it removes **the space first**, and **the whole mention on the second press**. It is not trimmed character by character.

## 6. Notification inbox (`Inbox`)

28×28 button at the top left (`aria-label` = the `Inbox` string in the ko dictionary), with a red badge
for the unread count on top. Panel width **366**, title `Inbox` 14px/500 rgb(44,44,43). Grouped by
time headers (`Earlier`, etc.).

Anatomy of one row:

| Part | Value |
|---|---|
| Avatar | 24 × 24, left **8**, top **10** (without a photo, one initial letter, 11px rgb(142,139,134)) |
| First line | **{sender}** (14px/500) + phrase + [page icon] + **{page title}** (14px/500), date on the far right 12px rgb(161,158,153) |
| Mention phrase | "mentioned you in" (the corresponding ko dictionary string) |
| Comment phrase | "commented on …" (the corresponding ko dictionary string) |
| Preview line | Body, 14px/400 rgb(125,122,117) — **mentions are rendered the same way here too**: light `@` + name |
| Unread | **Blue dot** to the right of the date |
| Row height | 87 without a preview, 108 with one |
| Hover | Three icons on the right (mute · mark as read · archive) |

## 7. Our state (before implementation)

- **The comment input has no mention feature at all.** `CommentComposer` is a plain `<input>`, and
  the `@` button on the right is **decoration** with no `onClick` (`comment-thread.tsx`).
- So **mentioning anyone in a comment sends no notification.** The server passes the plain-text body
  to `notifyMentions` as `html`, but plain text has no `data-mention-*` tags, so there are always 0 recipients
  (`api/pages/[pageId]/comments/route.ts`).
- The block editor's `MentionMenu` exists, but it is 256 wide, does name-only substring matching,
  **closes unconditionally on a space**, has no ranking, only truncates to 5, and has neither
  `N more results` nor `No results`.
- Post-send mention rendering (`CommentBody`) **already matches the original** — light `@` + name in
  the secondary color. However, it colors **any** `@word`, so text that is not an actual member also looks like a mention.
- The inbox polls every 15 seconds, and "mentioned you"-type phrases are missing from `en.ts`, so the
  English UI shows the Korean text as-is. The unread indicator is a blue dot on the left (the original has it on the right).

## 8. Deliberate differences from the original (after implementation, 2026-09-10)

Two things confirmed after implementing and running an adversarial review. Recorded here rather than hidden.

### 8.1 The menu does not open inside an email address

The original opens even on `x@` (§1 T2). If we kept that, this happens: since email is also searched (§2),
the moment you type `ping hyeonjj@comcom.ai`, `comcom.ai` matches **every internal member**, and Enter
picks the first person and replaces the address with a name — the sentence you meant to send is silently
corrupted (reproduced in dev: the input became `ping hyeonjj@HyeonJeong Jun ` and the comment was not sent).

So we close **only when the preceding character is a letter and the query contains a dot**. That is the
shape of an email; any other `x@name` opens as in the original. Chat mentions in this repo already made
the same call for the same reason. **T8** in the check `e2e/mention.check.mjs` guards this boundary.

### 8.2 Mentions being typed are not colored

The token the original inserts is a name in the secondary color + a 60%-light `@` (§5). Our comment
input is a plain `<input>`, so **we cannot color only part of the text.** The post-send render
(`CommentBody`) uses the same colors as the original, and we also mimicked the atomicity of being
deleted whole with one Backspace. Matching the color would require turning the input into a
contenteditable, which also touches IME, attachments, the send button and the height-35 check — a
separate piece of work, so it was left out of this scope.

## 9. Defects caught during implementation (found by review)

- **Security**: the block save path (`lib/transactions/apply.ts`) was **pulling recipient ids straight
  out of client HTML** and inserting notifications. There was no page access check at all, so any
  logged-in user could plant a notification with arbitrary text into any user's inbox (reproduced with
  two accounts). The gate was moved from the call sites **into `insertMentions`** (`mentionableUserIds`)
  so no call site can skip it.
- Caret 0 in `mentionQueryAt`: `lastIndexOf("@", -1)` clamps the negative index to 0 and hits index 0,
  so even with the caret **before** a leading `@`, the menu opened with an empty query and Enter inserted
  a mention into the middle of the draft.
- Ranking: an email prefix beat a name prefix, and the guest penalty was applied **after** ranking, so
  the measured orders in §2 could not be reproduced. Switched to a model of name priority (+0.5) · guests
  one tier down (+1), which reproduces both measured orders for `kim` and `hy` exactly.
- Enter being swallowed when there were no results (both in the input and the block editor):
  `preventDefault` ran **before** checking whether there was anything to pick.
- The block editor still closing on the first space — exactly the spot §1 pointed out.
- Marking a notification read with a non-uuid id returned 500 (Postgres 22P02) → now 400.
- Comment bodies had no length cap, so a single POST could fan out into as many notification rows as it had mentions.
