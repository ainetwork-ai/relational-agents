# Inline send confirm — "Is this Minjun?" then Send, in the chat

Request: "Sending 1 USDC should not go to another page. In the chat itself, ask back: 'Is the
person with this profile photo and this email address Minjun?' When they say yes, show an inline
button in the chat; pressing it sends the transaction."

## Decisions

- **Mechanism: the treasury's A2UI cards.** An agent message carries a marker line, the chat
  draws an `A2uiSurface` fetched from a route that renders the card for the viewer, and the
  card's buttons POST `{ action }` to that route, which answers with the card redrawn
  (`lib/agent/treasurer/surfaces.ts`, `components/a2ui/surface.tsx`,
  `api/treasury/[roomId]/surfaces/recurring-buy/[actionId]`). New markers:
  `[[a2ui:send-check/<offerId>]]` (step 1) and `[[a2ui:send/<offerId>]]` (step 2), parsed by
  the same `splitA2uiMarkers`. Route: `GET/POST /api/ens/send/offers/[offerId]?view=check|send`.
- **State: one additive table `ens_send_offers`** (the treasury keeps its cards' state in its own
  rows the same way). One row per offer: workspace, room, asker, from/to/name/amount snapshot
  taken at step 1, `phase` (asking · declined · ready · waiting · cancelled · failed · sent ·
  done · expired is derived), `fail_reason`, `token` (the signed send intent, minted on Yes),
  `tx_hash`, `lease_until` (one MetaMask request at a time). A card after a restart still draws
  from the row. Pushed by hand to dev and xyz as a single `CREATE TABLE` + index in a
  transaction; `pnpm db:check` on both.
- **Step 1 card** (`send-check`): recipient photo (the workspace member whose *verified* wallet
  equals the resolved address → `users.avatar_url`; else the ENS `avatar` record if https; else
  initials), their name, email (only if that member has one), "1 USDC", "Is this Minjun?" and
  Yes / No. No member with that wallet → "Minjun isn't in this workspace yet" and only the ENS
  alias + avatar. Only the asker gets buttons; everyone else sees it read-only. Typing yes / no
  (English and Korean words in `i18n/content/agent.ts`) answers the newest open question of that
  asker in that room (respond.ts checks before any other skill, DB-backed so a restart keeps it).
  Yes → the name is re-resolved (refuse if the address moved), a fresh intent token is signed,
  the agent posts the step-2 card. No → "Okay, I won't send it."
- **Step 2 card** (`send`): "Send 1 USDC to Minjun", one Send button. Send → POST `go`: the
  server checks asker, phase, token still live, no tx yet, the asker's verified wallet equals the
  intent's `from`, re-resolves the name (changed → failed "address changed"), takes the lease
  atomically (`UPDATE … WHERE lease free RETURNING`), answers the card as "Waiting for MetaMask"
  plus the transfer for the wallet. Browser: `sendUsdcTransfer` (account guard + Sepolia switch)
  → hash into localStorage `ens-send:<token>` → existing `/api/ens/send/confirm` (receipt +
  recipient notification; it now also writes the offer row: sent / done / back to ready on
  mismatch / failed on different) → card refetched. Rejected / failed in the wallet → POST
  `cancelled` / `failed` with a reason code; the card says it plainly and offers Send again.
  States: ready → waiting → sent (pending, Check again) → done ("Sent 1 USDC to Minjun" +
  Etherscan link) / cancelled / failed. Reload: the row gives the state; a hash in localStorage
  the server never saw is confirmed on load.
- **One pay once:** the lease + phase in the row, the intent token's `markSent`/`markConfirmed`
  (unchanged, generated from `ens/`), and a ref guard against double clicks in the browser.
- **The `/send?t=` link leaves the skill's reply.** `/send` and `send-card.tsx` stay so links in
  older messages keep working for their 10 minutes (the confirm grace covers checks); the
  assistant panel still renders such old links. `ens/mcp/server.ts` is unchanged.
- The assistant panel (`assistant-dock.tsx`) learns to draw marker cards like the room chat.
- No addresses in card text; English source through `t()`, Korean in `ko.ts`.

## Files

- `app/src/lib/db/schema.ts` — `ensSendOffers`
- `app/src/lib/agent/send-offer-surface.ts` — pure card builder (both views) + markers
- `app/src/lib/agent/send-offer.ts` — server: create, answer (yes/no), card data, go/cancel/fail, confirm hook
- `app/src/lib/agent/send-by-name.ts` — ready → offer + `send-check` marker (no link)
- `app/src/lib/agent/respond.ts`, `family-skills.ts` — typed yes/no
- `app/src/i18n/content/agent.ts` — yes/no words
- `app/src/app/api/ens/send/offers/[offerId]/route.ts` — GET/POST
- `app/src/app/api/ens/send/confirm/route.ts` — also updates the offer row
- `app/src/lib/agent/treasurer/surfaces.ts` — marker parser knows the send markers
- `app/src/components/a2ui/surface.tsx` (+ `send-wallet.ts`) — Image/avatar, send actions
- `app/src/app/(app)/dm/[roomId]/dm-view.tsx`, `components/assistant/assistant-dock.tsx`,
  `components/treasurer/treasurer-chat.tsx` — draw the send cards
- `app/src/i18n/ko.ts`

## Checks

- Browser (dev 3110, sealed cookies, recording EIP-1193 mock, en + ko): "@agent send Minjun 1
  USDC" → check card with photo + email → Yes → send card → Send → recorded
  `eth_sendTransaction` = USDC `0x1c7D…7238` `transfer(minjun, 1_000000)` from grandma's wallet
  → rejection → "Cancelled · Send again"; typed "yes"; No; ambiguous "send my grandchild 1 USDC"
  → pick → check card; another member sees no buttons (and the route refuses them); reload keeps
  the state; double click sends one request. The recorded call replays as `eth_call` on Sepolia.
- Gates: ens check / typecheck, sync `--check`, app tsc 0, eslint on touched files, i18n-keys,
  no Korean in touched non-i18n files, db:check dev + xyz.
