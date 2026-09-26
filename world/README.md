# Relation Treasury — AI manages the money, humans approve it

*Part of **AINMEM — P2P Memory** (the ETHGlobal Tokyo 2026 submission). Relation Treasury is its World-track feature: the relation's shared money, held by the agent that already keeps its memory.*

*ETHGlobal Tokyo 2026 · World · Continuity — **[Cont] Best Use of World ID for Agents** and
**[Cont] Best IDKit Use Case**.*

**Live: [ainmem.ainetwork.xyz/world](https://ainmem.ainetwork.xyz/world)** — the room from the
video, read-only, and a copy of it anyone can enter as one of the five friends. No sign-up.

**Demo video (3:35): [watch it on the live page](https://ainmem.ainetwork.xyz/world#demo)**, or
[the file in this repo](../app/public/demo/world/relation-treasury.mp4).

This folder is the World submission: this page, the [demo script](DEMO.md), the
[integration debriefs](DEBRIEF.md) and the [timestamped integration log](integration-log.md)
they are built from. The code lives in the workspace app ([`../app/`](../app/)), because the
treasury is a feature of a relation's room rather than a package of its own;
[The World pieces](#the-world-pieces) lists every World-facing part with its file and function.

## What this is

Shared money comes with an agreement — who may spend it, on what, how many must say yes — and
we keep that agreement in chat and docs. The wallet doesn't know it: a multisig knows keys and
a threshold, not "the hotel comes first" or "never to a member's own wallet", and ten wallets
of one person are ten signers.

Five friends pool $1,000 for a trip to ETHGlobal Tokyo. The room's agent — the same agent that
already keeps the relation's memory — holds the pot in its own wallet on Sepolia, and what it
may do with it is written in the relation's memory doc as plain sentences:

> - Shared expenses under $50: the agent may pay on its own.
> - Shared expenses from $50 to $200: 2 verified members approve.
> - Shared expenses over $200: 3 verified members approve.
> - Investing idle funds: 3 verified members approve.
> - Moving more than 30% of the treasury at once: 4 verified members approve.
> - Sending treasury money to a member's personal wallet: not allowed.

A money sentence in chat (`@agent pay the hotel deposit, $180`) is matched by shape, the rules
are parsed by grammar and enforced by deterministic code, and every reply is a template that
quotes the rule it followed. Members can also ask the *treasurer*, a language-model agent with
tools over the pot: the model picks which tool to call, never whether it may. Each tool
re-checks the asker and the rules itself, a proposal only queues a request that World ID
approvals must adopt, and its one spending tool runs inside a recurring buy the members have
already adopted. No model decides anything about money. World answers the one question the
treasury asks of anyone: **is this a distinct human, present now?**

## Two trust moments, two World surfaces

| Moment | Surface | What it proves | Why it is the minimum |
|---|---|---|---|
| Getting a vote (the right to approve), once per member | **IDKit** — action `treasury-seat`, signal = the room's id | Proof of Human (Orb) | The treasury needs exactly one fact about a member: one unique human, not the second account of someone who already has a vote. A passport reveals name and nationality for nothing; Selfie Check is weaker against one person running several accounts — the attack on a group treasury. |
| Approving a critical action, every time | **World ID for Agents** — OIDC step-up at the sandbox IdP, `max_age=0`, `prompt=login` | A fresh sign-in by a unique human (pairwise `sub`); `auth_time` must postdate the request | The quorum counts distinct humans at the moment money moves, not a login from this morning. |

The action id `treasury-seat` is the id registered in the Developer Portal, kept when the
on-screen word *seat* became *vote*.

*Why both, not one.* The vote fixes the roster before any request exists — who is notified,
whether enough people could ever reach a bar ("only 2 of us have a vote so far") — and anchors
"one human, one vote" on the strongest uniqueness credential. The step-up proves presence for
one specific action. Step-ups alone would let any account holder's approval count; a vote alone
would let a hijacked session approve.

Before the IdP, the app shows its own confirmation page — amount, payee name and address,
requester, the rule, who has approved so far — because the IdP screen cannot say what is being
approved. It also says what comes next (World's page checks you're a unique human, then back
here, where the approval is counted), because on the sandbox that page says "Signing you in".
Every outcome that comes back — counted, not counted and why, cancelled, World ID unreachable —
reads the same in the room and on the treasury page
([`world-result-copy.ts`](../app/src/components/treasury/world-result-copy.ts)), and a vote can
be claimed from either.

## Approve once: a recurring buy

The same approvals can adopt a standing authority instead of a single payment: *buy $X of WETH
every week for N weeks* (1 to 52 weeks; USDC → WETH on Base, from the agent's own wallet). The
bar is judged against the most the authority could ever spend — the weekly amount times the
weeks — under the investment rule, so with the rules above it needs three distinct humans (four
if it could ever move more than 30% of the pot), each approving once with a fresh World ID for
Agents step-up. After that the agent buys at most once a week (Monday to Monday on the
relation's clock) inside those terms, and any member can stop it without a vote, because
stopping only narrows what the agent may do. Real money moves only when investing is configured
and `TREASURY_RECURRING_REAL=1`; otherwise a run decides the same way and writes nothing. The
pure rules are in [`recurring-record.ts`](../app/src/lib/agent/treasury/recurring-record.ts);
proposal, adoption and the weekly runs are in
[`recurring.ts`](../app/src/lib/agent/treasury/recurring.ts).

## What gets refused

| Someone tries to… | What stops it | Where | Shown by |
|---|---|---|---|
| send the pot to a member's own wallet ("$500 to my wallet" in the video; "$700" in the try room) | the rule says *not allowed*: refused before anyone is asked, nothing is queued | [`policy.ts`](../app/src/lib/agent/treasury/policy.ts) `evaluateCommand`, called from [`skill.ts`](../app/src/lib/agent/treasury/skill.ts) before anything is queued | e2e scene e |
| claim a second vote from a second account | the proof's nullifier already holds a vote in this relation: the unique index `treasury_seats_room_nullifier`, answered with 409 | [`schema.ts`](../app/src/lib/db/schema.ts), [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `claimSeat`, [`seat/route.ts`](../app/src/app/api/dm/rooms/%5BroomId%5D/treasury/seat/route.ts) | World ID simulator, 2026-09-26 01:53 (the e2e cannot make a proof headless) |
| approve one payment twice as one human, from two accounts | the IdP's pairwise `sub` has already approved it: the second approval is voided and the count stays | [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `recordIdpApproval` | e2e scene d |
| approve on a sign-in from this morning | `auth_time` must be present and after the request; there is no `iat` fallback | [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `recordIdpApproval` | e2e scene g |
| approve without a vote, or from outside the relation | `not-seated`, `not-member` | [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `approvalGate` | e2e scene f |
| cancel at the IdP and still count | `access_denied` comes back as cancelled; nothing is recorded | [`callback/route.ts`](../app/src/app/api/auth/world/callback/route.ts) `GET` | e2e scene d |
| replay a proof made for another relation, action or environment | verification pins the action, the signal (the room's id) and the environment before calling World | [`worldid-v4.ts`](../app/src/lib/worldid-v4.ts) `verifyIdKitV4` | code |
| leave a request waiting | it lapses after 24 hours (`TREASURY_REQUEST_TTL_HOURS`) | [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `isExpired` | code |
| get paid after the rules, payees or balance changed | at quorum the request is judged again against what is in force now; a re-check only tightens | [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `recheck` | code |
| get paid twice (two approvals landing together) | one atomic claim: `UPDATE … WHERE status = 'pending' AND decided_at IS NULL` | [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `executeIfQuorum` | code |
| talk the treasurer into spending | the model's say-so is never a permission: each tool re-checks the asker, and spending exists only inside an adopted recurring buy | [`treasurer/tools.ts`](../app/src/lib/agent/treasurer/tools.ts) | code |

The e2e is [`app/e2e/treasury.check.mjs`](../app/e2e/treasury.check.mjs); its scenes are
lettered a–g after a setup scene. Pointers name the function rather than a line number, so they
stay right while the code keeps moving.

## The World pieces

| Piece | Where |
|---|---|
| IDKit v4 request with the `orbLegacy` preset and `signal` = the relation's id | [`seat-button.tsx`](../app/src/components/treasury/seat-button.tsx) `orbLegacy({ signal: roomId })`, `IDKitRequestWidget` |
| A freshly signed `rp_context` for every request (`signRequest` with the Portal's RP signing key, 300 s TTL) | [`worldid-v4.ts`](../app/src/lib/worldid-v4.ts) `signRpContext`, served by [`seat/rp-context/route.ts`](../app/src/app/api/dm/rooms/%5BroomId%5D/treasury/seat/rp-context/route.ts) |
| Verification at `developer.world.org/api/v4/verify/{rp_id}`, after checking action, signal and environment | [`worldid-v4.ts`](../app/src/lib/worldid-v4.ts) `verifyIdKitV4` |
| One human, one vote per relation: `treasury_seats` unique on `(room, nullifier)` | [`schema.ts`](../app/src/lib/db/schema.ts) `treasury_seats_room_nullifier`, [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `claimSeat` |
| The verifier's "already verified" answer mapped to the same-human refusal | [`seat/route.ts`](../app/src/app/api/dm/rooms/%5BroomId%5D/treasury/seat/route.ts) `ALREADY_VERIFIED` |
| The step-up request: code flow with PKCE (S256), `state`, `nonce`, `max_age=0`, `prompt=login` | [`connect/route.ts`](../app/src/app/api/auth/world/connect/route.ts) `startFlow` |
| Our confirmation page in front of the IdP, served with `default-src 'none'` and no script (only the Pretendard stylesheet and fonts from one CDN) | [`connect/route.ts`](../app/src/app/api/auth/world/connect/route.ts) `GET`, `confirmPage` |
| id_token checks: JWKS signature, issuer, audience, algorithm, `nonce`; `auth_time` passed on, never `iat` | [`world.ts`](../app/src/lib/auth/world.ts) `exchangeWorldCode` |
| Freshness against the request: `auth_time` after it was created, fail-closed | [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `recordIdpApproval` |
| Quorum = distinct pairwise `sub`s (`users.world_sub` is unique); the same human from another account is voided | [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `recordIdpApproval`, [`schema.ts`](../app/src/lib/db/schema.ts) `worldSub` |
| The callback, in order: state, token exchange, approval, execution | [`callback/route.ts`](../app/src/app/api/auth/world/callback/route.ts) `GET` |
| A standing authority adopted by the same approvals: a recurring buy's quorum adopts its terms instead of paying | [`recurring.ts`](../app/src/lib/agent/treasury/recurring.ts) `proposeRecurringBuy`, [`approvals.ts`](../app/src/lib/agent/treasury/approvals.ts) `executeIfQuorum` → `adoptRecurringBuy` |
| A local mock of the sandbox IdP with the same discovery shape, for development only | [`api/world-mock/`](../app/src/app/api/world-mock/) |

## Where the code is

| Path | What |
|---|---|
| [`app/src/lib/agent/treasury/`](../app/src/lib/agent/treasury/) | `policy.ts` rules parser and evaluator · `match.ts` money-sentence matcher · `memory.ts` the relation's memory doc, adoption, Treasury Activity · `approvals.ts` requests, votes, approvals, quorum, execution · `wallet.ts` the agent's Sepolia wallet · `invest.ts` the Uniswap v3 swap on Base · `recurring-record.ts`, `recurring.ts` the recurring buy · `skill.ts` the agent's replies |
| [`app/src/lib/worldid-v4.ts`](../app/src/lib/worldid-v4.ts) | IDKit v4: the RP signature, verification, canonical nullifiers |
| [`app/src/lib/auth/world.ts`](../app/src/lib/auth/world.ts) | the World ID for Agents client: discovery, PKCE, token exchange, id_token verification |
| [`app/src/app/api/auth/world/`](../app/src/app/api/auth/world/) | `connect` (the confirmation page, then the step-up) and `callback` |
| [`app/src/app/api/dm/rooms/[roomId]/treasury/`](../app/src/app/api/dm/rooms/%5BroomId%5D/treasury/) | the treasury status, `seat` (claiming a vote), `seat/rp-context` |
| [`app/src/app/api/world-mock/`](../app/src/app/api/world-mock/) | the local mock IdP |
| [`app/src/components/treasury/`](../app/src/components/treasury/) | `treasury-panel.tsx` (the panel above the chat), `seat-button.tsx` (the IDKit widget), `recurring-buy-panel.tsx` |
| [`app/src/lib/agent/treasurer/`](../app/src/lib/agent/treasurer/) | the treasurer: a language model with tools; each tool in `tools.ts` checks the asker itself |
| [`app/src/app/(app)/treasury/`](../app/src/app/%28app%29/treasury/), [`app/src/components/treasury-app/`](../app/src/components/treasury-app/) | the treasury pages: every relation's shared money in one place, and per room the account, approvals, rules, activity and the treasurer |
| [`app/src/app/world/`](../app/src/app/world/), [`app/src/lib/world-demo.ts`](../app/src/lib/world-demo.ts) | the public `/world` page: the recorded room read-only, the try-it copy's members to enter, and its start-over |
| [`app/src/lib/db/schema.ts`](../app/src/lib/db/schema.ts) | `treasury_actions`, `treasury_approvals`, `treasury_seats`, `users.world_sub` |
| [`app/scripts/seed-tokyo-trip.mts`](../app/scripts/seed-tokyo-trip.mts), [`treasury-selftest.mts`](../app/scripts/treasury-selftest.mts), [`recurring-selftest.mts`](../app/scripts/recurring-selftest.mts), [`recurring-chat-selftest.mts`](../app/scripts/recurring-chat-selftest.mts), [`app/e2e/treasury.check.mjs`](../app/e2e/treasury.check.mjs) | the demo room; checks of the parser, the matcher and the recurring buy's rules, no chain; the end-to-end journey |

## Try it

In a browser: [ainmem.ainetwork.xyz/world](https://ainmem.ainetwork.xyz/world). Under the
headline, two actions: watch the demo, or try it in about two minutes. Below: the recorded room, live and
read-only; then "Try it yourself": pick a member and you are signed in as them, on the treasury
page or in the room chat, with "What to try" (claim a vote through the World ID Simulator,
bring Chris from a second browser, ask the agent to pay, approve from both, see what gets
refused) and "Good to know". A folded table at the bottom maps each prize requirement to a step
and to the code or document behind it. The room you enter is the try-it copy
(`seed-tokyo-trip.mts --try`): its own accounts, agent and wallet, so nothing done there reaches
the recorded room.

Locally, against the mock IdP. Set up the app first ([Running it](../README.md#running-it)).
The treasury also needs a key with a little Sepolia ETH (`RELAYER_KEY` or `DEPLOYER_KEY`): it
funds the pot and refunds the agent's gas, and on testnet it is also the "hotel", so rehearsals
recycle the same SepETH. Outside production with no `WORLD_CLIENT_ID`, the step-up goes to the
local mock; point its redirect at the dev server's port.

```bash
cd app
# .env.local: RELAYER_KEY=0x…  WORLD_REDIRECT_URI=http://localhost:3110/api/auth/world/callback
npx tsx --tsconfig scripts/tsconfig.json scripts/seed-tokyo-trip.mts --reset   # the room, the rules, $1,000
npx tsx --tsconfig scripts/tsconfig.json scripts/treasury-selftest.mts         # parser and matcher, no chain
BASE_URL=http://localhost:3110 node e2e/treasury.check.mjs                      # the journey; spends ~0.002 SepETH
```

The e2e also reads `POSTGRES_URL` (from `app/.env.local`) for the few scenes with no HTTP lever,
and puts back every row it touches.

With World instead of the stand-ins:

| For | Set | Needs |
|---|---|---|
| World ID for Agents (sandbox IdP) | `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`, `WORLD_REDIRECT_URI` | a client registered for the deploy's HTTPS host; `WORLD_TOKEN_AUTH_METHOD=client_secret_post` if the registration says so |
| IDKit (claiming votes) | `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `NEXT_PUBLIC_WORLD_ID_APP_ID`, `NEXT_PUBLIC_WORLD_ID_ENV=staging` | a Developer Portal app with its relying party registered and the action `treasury-seat`; staging proofs come from simulator.worldcoin.org and are verified only inside a staging window the team opens — `scripts/world-staging-window.mjs` opens it (24 h) and saves `WORLD_STAGING_VERIFICATION_TOKEN` |

Investing, and with it the recurring buy, needs `TREASURY_INVEST=uniswap-base` and USDC plus a
little ETH in the agent's wallet on Base; the recurring buy spends real money only with
`TREASURY_RECURRING_REAL=1`.

As a member, `GET /api/dm/rooms/<room>/treasury` says which is live: `"idpMode": "sandbox"` and
`"seatMode": "world-id-v4"` are World; `"mock"` and `"dev-simulator"` are the local stand-ins,
and the panel labels the IdP "mock IdP" and rings a dev seat red (not counted). Production never runs the mock unless
`WORLD_IDP=mock` is set on purpose, because anyone can claim any human there.

## What has been exercised

Times are JST; the [integration log](integration-log.md) has the details.

- **The e2e, 8/8**: the whole journey over HTTP against the local mock IdP, moving real Sepolia
  ETH — the rows marked "e2e" above.
- **IDKit, first verified vote** — 2026-09-26 01:53, staging, through the World ID simulator.
  Click to vote ≈14 s. The same human's second account was refused with 409 by our
  `(room, nullifier)` index, not by the Portal.
- **World ID for Agents, first approval on the demo host** — 2026-09-26 05:04,
  ainmem.ainetwork.xyz, sandbox IdP. From the click on our confirmation page to back in the
  room: 4.8 s.
- **Three humans, one swap** — 2026-09-26 09:14. `@agent invest $200 of the idle funds` →
  Chris, Dana and Eli approve from three browsers → the agent swaps 1 USDC for 0.000371977 WETH
  on Uniswap v3 on Base from its own wallet
  ([tx](https://basescan.org/tx/0x9af1ec962d9ae5afc1f2446971cbfc253c3e9b2851b063f0e31a823711a53a4b)).
  The $180 deposit, approved by Chris and Dana, was paid on Sepolia the same way earlier that
  afternoon.

The sandbox IdP says "Sandbox · Uses fake identities" and completes with no human action (about
3 s), one fake human per browser. On the sandbox the demo therefore shows our side — a fresh
step-up for every approval, humans counted rather than accounts, the second account voided —
not a person at a phone. In production the proof comes from World App.

## Trust model — what this is and isn't

The treasury is a custodial agent EOA on Sepolia at a disclosed demo scale ($200,000 per ETH,
so $1,000 is 0.005 SepETH). Rules, votes and quorum are enforced by this server. The key is
sealed at rest (AES-256-GCM under `SESSION_SECRET`), so a database dump alone moves nothing, but
whoever runs the server can sign. The ledger of record is the `treasury_actions` table the panel
reads; the *Treasury Activity* page is the agent's narrative in the shared memory. Next step:
move enforcement on-chain — a Safe module or guard that executes only with the server-attested
approvals.

*Can Alex just edit the rules?* Every member can edit the doc, so an edit is a proposal: the
agent enforces the version the relation *adopted*, recorded in the database.
`@agent adopt the new rules` puts the edited Rules, Payees and any new members to a vote at the
strictest bar the rules name (never fewer than 2). Members who joined after the adoption don't
vote or direct money until the relation adopts them.

*Why not a multisig.* A Safe counts keys; this counts humans. Approvers hold no keys (a World ID
verification is the approval), one person with five accounts is still one vote, and the policy
is the relation's own sentences, which the agent reads, applies and cites.

## Continuity — what existed before, what this adds

The weekend's World work starts at `4d4612d` (2026-09-25 23:05 JST, the scenario doc).
Everything the table puts on the left predates it. The World commits since then:

```bash
git log --oneline 4d4612d..main -- world docs/world docs/world-relation-treasury-scenario.md \
  app/src/lib/agent/treasury app/src/lib/auth/world.ts app/src/app/api/auth/world \
  app/src/app/api/world-mock app/src/lib/worldid-v4.ts 'app/src/app/api/dm/rooms/[roomId]/treasury' \
  app/src/components/treasury app/src/lib/agent/treasurer app/src/components/treasury-app \
  'app/src/app/(app)/treasury' app/src/app/api/treasury app/scripts/seed-tokyo-trip.mts \
  app/scripts/treasury-selftest.mts app/scripts/recurring-selftest.mts \
  app/scripts/recurring-chat-selftest.mts app/e2e/treasury.check.mjs app/public/demo/tokyo
```

On GitHub, the history of
[the treasury](https://github.com/ainetwork-ai/relational-agents/commits/main/app/src/lib/agent/treasury) ·
[the step-up](https://github.com/ainetwork-ai/relational-agents/commits/main/app/src/lib/auth/world.ts) ·
[IDKit v4](https://github.com/ainetwork-ai/relational-agents/commits/main/app/src/lib/worldid-v4.ts) ·
[the panel](https://github.com/ainetwork-ai/relational-agents/commits/main/app/src/components/treasury) ·
[the treasurer](https://github.com/ainetwork-ai/relational-agents/commits/main/app/src/lib/agent/treasurer).

| Pre-existing | Built this weekend |
|---|---|
| World ID 3.0 personhood for relation consent (July): [`lib/worldid.ts`](../app/src/lib/worldid.ts), [`world-id-button.tsx`](../app/src/components/dm/world-id-button.tsx), the consent route's nullifier binding, `personhood_proofs` | [`lib/agent/treasury/*`](../app/src/lib/agent/treasury/) — rules parser and evaluator, command matcher, memory reader, wallet, approvals, quorum and adoption, the agent's skill, and the Uniswap investment ([`invest.ts`](../app/src/lib/agent/treasury/invest.ts)) |
| Relation agents and their memory (July): [`provision.ts`](../app/src/lib/agent/provision.ts), [`respond.ts`](../app/src/lib/agent/respond.ts), OKF folders ([`okf-store.ts`](../app/src/lib/okf-store.ts), [`okf-docs.ts`](../app/src/lib/agent/okf-docs.ts)), demo login | World ID for Agents step-up: [`lib/auth/world.ts`](../app/src/lib/auth/world.ts), [`api/auth/world/*`](../app/src/app/api/auth/world/) (confirmation page, callback), the local mock IdP [`api/world-mock/*`](../app/src/app/api/world-mock/) |
| AgentKit wallet wrapper ([`agentkit.ts`](../app/src/lib/agent/agentkit.ts), July); the songpyeon purchase demo ([`spend.ts`](../app/src/lib/agent/spend.ts), Sep 23 — it now refuses a treasury agent) | Claiming a vote with IDKit v4: [`lib/worldid-v4.ts`](../app/src/lib/worldid-v4.ts), the `treasury/seat` and `rp-context` routes, [`seat-button.tsx`](../app/src/components/treasury/seat-button.tsx) |
| [`secret-box.ts`](../app/src/lib/secret-box.ts), the family wallet in [`gift.ts`](../app/src/lib/gift.ts) (Sep 25, before the treasury) | The panel ([`treasury-panel.tsx`](../app/src/components/treasury/treasury-panel.tsx)), the `treasury_*` tables and `users.world_sub`, the seed, selftest and e2e, this folder |
| | The recurring buy ([`recurring.ts`](../app/src/lib/agent/treasury/recurring.ts), [`recurring-record.ts`](../app/src/lib/agent/treasury/recurring-record.ts)), the treasurer ([`treasurer/`](../app/src/lib/agent/treasurer/)) and the treasury pages ([`treasury-app/`](../app/src/components/treasury-app/)) — 2026-09-26, PR #30 |

The July submission this continues — an agent that exists only after two verified humans
consent, with World ID and AgentKit, run end to end on Sepolia — is kept in
[`archive/couple/world/`](../archive/couple/world/).

*A note on the history:* the eight treasury commits `aa9fc39..a4c81bb` carry the same second
(2026-09-25 15:10:57 UTC). One working session was split into these units and committed
together, not committed as each unit was finished; the integration log carries a matching note
about its times. The pushed history is left as it is.

## Honest limits

- **The sandbox uses fake identities.** It shows our checks, not a human at a phone (see
  [What has been exercised](#what-has-been-exercised)).
- **Enforcement is on this server.** It holds the agent's key and applies the rules; nothing on
  chain stops it yet (see the trust model).
- **The vote and the approval are two identifiers.** The vote is an IDKit nullifier, the
  approval an IdP pairwise `sub`, and they are not linked. The treasury knows that an account's
  human holds a vote and that each approval comes from a distinct human — not that the approver
  is the human who claimed that account's vote.
- **One action for every relation.** The nullifier is per (app, action), so the stored nullifier
  links one human's votes across relations on our server. A per-relation action would remove the
  link at the cost of registering an action per group.
- **Votes take World ID 3.0 proofs only** (`orbLegacy`): a human's 3.0 and 4.0 nullifiers
  differ, so accepting both would give one human two votes.
- **Demo scale, two chains.** The pot is Sepolia ETH at $200,000 per ETH; an investment is a
  real Uniswap v3 swap on Base mainnet at $1 = 0.005 USDC ($200 in the story is 1 USDC), from
  the agent's own wallet.
- **The real IdP needs a registered HTTPS host.** Redirects must be HTTPS and a localhost
  redirect was refused at registration, so local development runs the mock. A client's
  identity sector is fixed by its first redirect host, so each deploy domain has its own
  client — and a human's pairwise `sub` differs per domain.

## In this folder

| File | What |
|---|---|
| [`DEMO.md`](DEMO.md) | the 3:00 video, scene by scene, with the recording setup and the pre-flight check |
| [`DEBRIEF.md`](DEBRIEF.md) | the two integration debriefs: time to first success, friction, the one improvement |
| [`integration-log.md`](integration-log.md) | the timestamped log from hour 0 that the debriefs are built from |
| [`plan.md`](plan.md) | the design record: track requirements, the reviewed plan (v3.1), rejected options |
| [`scenario-vs-implementation.md`](scenario-vs-implementation.md) | what is implemented, what the story uses, the gaps between them |
| [`demo-polish-plan.md`](demo-polish-plan.md) | the pre-recording screen audit and the fixes chosen |
