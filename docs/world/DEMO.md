# Relation Treasury — demo script (3:00, human voiceover)

**AI manages the money. Humans approve it.**

**The problem the story answers.** Shared money comes with an agreement — who may spend
it, on what, how many of us must say yes. We write it down, in chat and in a doc. The wallet
doesn't know any of it: a multisig knows keys and a threshold, not "the hotel comes first" or
"never to a member's own wallet", and ten wallets of one person are ten signers. So the agent
that already keeps this relation's memory (AINmem) holds the pot and applies the agreement as
written — and because "three approved" means nothing if the three are one person, World
proves that each approval is a distinct human, present now. Every scene answers one piece of
that; the caption under each heading says which.

Record the voice live (ETHGlobal: no AI narration). Screen: the Tokyo Trip room
(chat left, treasury panel on top), switching members with the demo login.
Scenes marked **[pre-record]** depend on outside services (the World IdP, the
chain) and are captured as separate takes; **[live]** scenes are deterministic.

## Setup before recording

1. `cd app && npx tsx --tsconfig scripts/tsconfig.json scripts/seed-tokyo-trip.mts --reset`
   → five friends, $1,000 in the agent's wallet, the relation's memory doc with
   Purpose / Treasury Rules / Payees (adopted as the founding agreement),
   Chris·Dana·Eli already have a vote. The seed also unbinds every demo account's
   World ID, so a rehearsal's bindings can't void a take.
2. **Pre-flight — the takes must show World, not the stand-ins.** As any member,
   `GET /api/dm/rooms/<room>/treasury` must report:
   - `"idpMode": "sandbox"` for every IdP hop (scenes 3, 4). `"mock"` means the
     local mock — its page says "Local mock — not World" and the Approve button
     says "(mock IdP)"; that is a rehearsal, not a take. Needs the sandbox client
     registered (`WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`, an HTTPS
     `WORLD_REDIRECT_URI`; `WORLD_TOKEN_AUTH_METHOD` if the registration names
     `client_secret_post`).
   - `"seatMode": "world-id-v4"` for the vote scenes (1, 2). `"dev-simulator"`
     means no Portal app — the panel says "dev vote"; that is not a take either.
     Needs the Developer Portal staging app (`WORLD_RP_ID`,
     `WORLD_RP_SIGNING_KEY`, `NEXT_PUBLIC_WORLD_ID_APP_ID` baked into the build)
     and action `treasury-seat` registered (it keeps that original id — "vote"
     is only the on-screen word; renaming the action would break verification).
   - Production must never run with `WORLD_IDP=mock`: anyone can claim any human there.
3. With votes claimed through the Portal app, seed with `--reset --no-preseat`
   and have Chris, Dana and Eli claim theirs through simulator.worldcoin.org off
   camera, so every vote on screen is a real proof (seeded votes show as "dev vote").
4. Rehearsing on the mock IdP: pick the same human per member every time —
   Alex = Human 1, Bea = Human 2, Chris = Human 3, Dana = Human 4, Eli = Human 5,
   and Alex (2nd account) = Human 1 (the same human as Alex, for scene 4).
   Against the sandbox, Alex's 2nd account must verify with Alex's own World ID
   (one identity cannot bind two approvers, so Chris and Alex need two distinct
   sandbox World IDs).

## 0 · The problem (0:00–0:15) [live]

The Tokyo Trip room, panel collapsed: `Shared treasury · $1,000.00`.

> "Have you ever managed money with other people? Five of us are, right now, at ETHGlobal
> Tokyo. Pooling it was easy. The hard part is what we agreed — who can spend it, on what,
> how many of us must say yes. We wrote it down. *Our wallet doesn't know any of it.* So we
> gave the pot to the agent that already keeps our memory — and asked World to make sure
> every 'yes' is a different, real human."

Caption: `Shared money comes with an agreement. The wallet doesn't know it.` → `AI manages the money. Humans approve it.`

## 1 · The relation (0:15–0:32) [live — needs the Portal app]

Caption: `One unique human → one vote`

The Tokyo Trip room: the chat where five friends agreed the rules, and the
relation's memory doc beside it — **Treasury Rules** in plain sentences.

> "Five of us came to Tokyo with one pot of money. We gave it to our room's
> agent — the same agent that already keeps this relationship's memory. It
> follows what we agreed, written here, in our own words — and anyone can edit
> this page, but it only follows the version the group adopted."

Alex taps **Claim your vote with World ID** (IDKit, Proof of Human).

> "Before anyone can approve anything, they prove one thing: that they're a
> unique human. Not who they are — just: one human, one vote."

## 2 · The second account (0:32–0:45) [pre-record — needs the Portal app]

Caption: `Ten accounts. Still one human.`

"Alex (2nd account)" tries to claim a sixth vote → **"This human already has
a vote in this relation — one human, one vote."**

> "Alex can make ten accounts and ten wallets — World ID still sees one human."

## 3 · Paying the hotel (0:45–1:30) [live + pre-record for the IdP hop]

Caption: `Proven now, not this morning` → after the payment `Approved by two distinct humans`

Alex: `@agent pay the hotel deposit, $180`

Agent: *"Queued: $180 to Hotel Gracery Shinjuku (hotel deposit). This needs 2
verified humans. Our rules say: “Shared expenses from $50 to $200: 2 verified
members approve.”"* — a pending card appears: 0 / 2, with the payee's address.

Over the pending card, before anyone approves (5 s):

> "These days half the 'people' in a group chat are their agents. Chris's agent can read
> this room — it can even click Approve. But it can't be Chris, in World App, right now.
> So a click from an agent counts for nothing. Only humans move the money: not accounts,
> not sessions, not agents — including ours."

Caption: `Your agent can click. It can't be you.`

(Said, not shown: the sandbox IdP uses fake identities and completes without a phone;
in production the fresh proof comes from World App on the member's own phone.)

Chris taps **Approve with World ID** → our confirmation page ($180.00, the
hotel and its address, the rule, 0 of 2) → **Approve with World ID** → the
World ID for Agents step-up → back in the room: 1 / 2. Alex approves the same
way → **✅ Paid $180 to Hotel Gracery Shinjuku (hotel deposit) — approved by
Chris, Alex (2 of 2 verified humans).** Etherscan tab (caption: *testnet — the
"hotel" is the faucet account that funded the pot*).

> "Before World ID, the app shows exactly what you're approving. Then a fresh
> verification at the moment money moves — not a login from this morning. Two
> different humans, proven now. Then it paid, from its own wallet, and wrote it
> into our memory."

## 4 · Same human, one vote (1:30–1:50) [pre-record — the IdP hop; do not cut]

Caption: `Same human twice counts once`

Alex: `@agent pay the hotel for $150` → Alex approves (1 / 2). Alex switches to
his 2nd account and approves with **his own** World ID →
**"⛔ An approval was voided: the same human already approved from another
account."** The card stays at 1 / 2 and nothing is paid.

> "Two accounts, one human — the second approval doesn't count, and the money
> doesn't move."

## 5 · Taking the pot home (1:50–2:30) [live — the climax]

Caption: `The agent can't be talked into it`

Alex: `@agent send $700 to my wallet`

Agent — no approval request at all:
*"I won't do that. Our treasury rules say: “Sending treasury money to a
member's personal wallet: not allowed.” $700 would also be 85.4% of our $820 —
the rules require 4 verified members to move more than 30% at once. We agreed
what this money is for: “Fund our five-person trip to ETHGlobal Tokyo, Sep
25–27 — the hotel comes first. We each put in $200; the pot is for the trip,
not for anyone to take home.”"*

> "It didn't ask for votes. It knew this isn't something our group does —
> because we told it, and it remembers."

## 6 · Why this needs World (2:30–3:00) [live]

Caption: `The record says which humans said yes — and nothing else about them`

The Treasury Activity page in the memory doc: every payment, refusal and
approver, written by the agent.

> "Wallet proves ownership. World proves humanity — and nothing more. The relation
> agent connects the two: AI manages the money, verified humans approve it, and the
> record says which ones. That's how our relation paid for our hotel."
