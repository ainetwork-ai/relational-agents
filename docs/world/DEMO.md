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
(chat left, treasury panel on top), switching members by switching Chrome profiles.
Scenes marked **[pre-record]** depend on outside services (the World IdP, the
chain) and are captured as separate takes; **[live]** scenes are deterministic.

The two World products each do one job, and the script keeps them apart:
scenes 1–2 are **World ID · IDKit** (the nullifier at the vote step: one human,
one vote); scenes 3–4 are **World ID for Agents** (the IdP's pairwise `sub` at
the spend step: a fresh step-up per approval, one human counts once).

## Setup before recording

Order: rehearsal → final reset → vote claims only → shoot. Nothing else happens
in the room between the final reset and the first take.

1. **Shoot on https://memory.ainetwork.ai, never on localhost.** The sandbox
   IdP client's only registered redirect is memory.ainetwork.ai (localhost was
   refused), so localhost is the mock IdP forever. The production build also
   has no Next.js dev indicator or error overlay — a `next dev` server draws
   the "N" button and an issue count in the corner of every frame. All UI fixes
   go out in one deploy before the final reset.
2. **Final reset, on production's own data.** Run the seed against
   memory.ainetwork.ai's DB, content root and `SESSION_SECRET` (inside the
   prod container, or from a clean worktree with the prod env — the agent's
   wallet key is sealed under that secret; integration-log 2026-09-26 03:58):

   ```bash
   npx tsx --tsconfig scripts/tsconfig.json scripts/seed-tokyo-trip.mts \
     --reset --no-preseat --app https://memory.ainetwork.ai
   ```

   → the six accounts, $1,000 in a new agent wallet, the relation's memory doc
   with Purpose / Treasury Rules / Payees (adopted as the founding agreement),
   **nobody seated**, every demo account's World ID unbound (a rehearsal's
   bindings can't void a take) and the six accounts' notifications cleared.
   Check that the sidebar's **Shared** section shows the rebuilt memory doc
   ("Tokyo Trip · 6 people").
3. **Vote claims, off camera.** Chris, Dana and Eli each claim their vote
   through simulator.worldcoin.org with their own simulator identity, so every
   vote on screen is a real IDKit proof. Alex and Bea stay unseated: Alex
   claims on camera in scene 1. Alex (2nd account) uses Alex's identity (the
   scene 2 denial).
4. **Identities.** Alex, Chris, Dana and Eli each have their own
   simulator.worldcoin.org identity. On the sandbox IdP, Chris and Alex must be
   two different World IDs (one identity cannot bind two approvers). **Dana
   never does an IdP step-up before scene 4** — her account must reach scene 4
   with no World ID bound. The Developer Portal app shows as
   `Relation Treasury` in the IDKit sheet; the action id stays `treasury-seat`
   ("vote" is only the on-screen word — renaming the action breaks
   verification).
5. **Pre-flight, before every take.** As any member,
   `GET /api/dm/rooms/<room>/treasury` must report:
   - `"idpMode": "sandbox"` — `"mock"` is the local mock (its page says "Local
     mock — not World", the confirmation page says "local mock IdP"): a
     rehearsal, not a take. Needs `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`, an
     HTTPS `WORLD_REDIRECT_URI` (`WORLD_TOKEN_AUTH_METHOD` if the registration
     names `client_secret_post`). Production never runs with `WORLD_IDP=mock`:
     anyone can claim any human there.
   - `"seatMode": "world-id-v4"` and **0** members with
     `seatLevel: "dev-simulator"` — a dev seat shows as "dev vote" on screen.
     Needs the Portal staging app (`WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`,
     `NEXT_PUBLIC_WORLD_ID_APP_ID` baked into the build).
   - `"balanceUsd": 1000`.
6. **Browsers.** One Chrome profile per person — Alex, Alex (2nd account),
   Chris, Dana — each in its own profile color, so the window frame changes
   when the laptop changes hands. Each profile signs in once with the demo
   login and has a `lang=en` cookie on memory.ainetwork.ai. **1920×1080 window
   at 125% zoom** (CSS 1536×864), clean profiles (no bookmarks bar, no
   extensions), tabless app windows (Etherscan is the one tab), the sidebar on
   the Chats tab. Never open the agent dock, the inbox, Home or header tooltips
   on camera. Keep one simulator window per person as "that person's phone":
   Alex's single phone answering on Alex's, Alex (2nd)'s and Dana's laptops is
   the one-human story itself.
7. **Rehearsing on the mock IdP** (localhost only — never a take): pick the same
   human per member every time — Alex = Human 1, Bea = Human 2, Chris = Human 3,
   Dana = Human 4, Eli = Human 5, Alex (2nd account) = Human 1. **Scene 4 is the
   exception: on Dana's account pick Human 1** (Alex's human verifying on
   Dana's laptop). The mock page itself never goes on screen.

### Shot list

- **Pre-record:** the scene 1 IDKit step (≈14 s); all of scene 2; both IdP runs
  in scene 3 (the ≈40 s Sepolia wait becomes a jump cut captioned
  `~40 s later on Sepolia`); **all of scene 4, with no cut between the Approve
  click and the voided line**.
- **Live:** the scene 1 opening, the $180 request, Etherscan, scene 5, scene 6.
- **Fallback:** if the sandbox fails on the day, jump-cut from our confirmation
  page straight back to the room. Never put the mock IdP page on screen.

### Captions (edit)

| Where | Caption |
|---|---|
| Scenes 1–2 (the vote) | `World ID · IDKit — Proof of Human` |
| Scenes 3–4 (the approvals) | `World ID for Agents — fresh step-up` |
| Every account switch | `Chris's laptop` / `Dana's laptop` — whose screen it is now |
| The Sepolia wait (scene 3) | `~40 s later on Sepolia` |
| Etherscan (scene 3) | `Testnet — the "hotel" is the faucet account that funded the pot` |

## 0 · The problem (0:00–0:15) [live]

The Tokyo Trip room, panel collapsed: `Shared treasury · $1,000.00`.

> "Have you ever managed money with other people? Five of us are, right now, at ETHGlobal
> Tokyo. Pooling it was easy. The hard part is what we agreed — who can spend it, on what,
> how many of us must say yes. We wrote it down. *Our wallet doesn't know any of it.* So we
> gave the pot to the agent that already keeps our memory — and asked World to make sure
> every 'yes' is a different, real human."

Caption: `Shared money comes with an agreement. The wallet doesn't know it.` → `AI manages the money. Humans approve it.`

## 1 · The relation (0:15–0:32) [live opening + pre-record for the IDKit step]

Caption: `One unique human → one vote` · `World ID · IDKit — Proof of Human`

The Tokyo Trip room: the chat where five friends agreed the rules, and the
relation's memory doc one click away — **Treasury Rules** in plain sentences.

> "Five of us came to Tokyo with one pot of money. We gave it to our room's
> agent — the same agent that already keeps this relationship's memory. It
> follows what we agreed, written here, in our own words — and anyone can edit
> this page, but it only follows the version the group adopted."

Alex taps **Claim your vote with World ID** (IDKit, Proof of Human) →
`🌍 Vote claimed — World ID confirmed you're a unique human. One human, one vote.`

> "Before anyone can approve anything, they prove one thing: that they're a
> unique human. Not who they are — just: one human, one vote."

## 2 · The second account (0:32–0:45) [pre-record — needs the Portal app]

Caption: `Ten accounts. Still one human.` · `World ID · IDKit — Proof of Human`

"Alex (2nd account)" tries to claim a sixth vote with Alex's own World ID →
**"This human already has a vote in this relation — one human, one vote."**
The chip stays `Alex (2nd account) · no vote`.

> "Alex can make ten accounts and ten wallets — World ID still sees one human."

## 3 · Paying the hotel (0:45–1:30) [live request + pre-record for the IdP hops]

Caption: `Proven now, not this morning` · `World ID for Agents — fresh step-up` →
after the payment `Approved by two distinct humans`

Alex: `@agent pay the hotel deposit, $180`

Agent, one thought per line:

> ⏳ Queued: $180 to Hotel Gracery Shinjuku (hotel deposit).
> Needs 2 verified humans — our rules: “Shared expenses from $50 to $200: 2 verified members approve.”
> Approve with World ID in the treasury panel above.

A pending card appears: two empty `verified human` slots, `0 of 2 verified
humans`, the payee's address.

Over the pending card, before anyone approves (5 s):

> "These days half the 'people' in a group chat are their agents. Chris's agent can read
> this room — it can even click Approve. But it can't be Chris, in World App, right now.
> So a click from an agent counts for nothing. Only humans move the money: not accounts,
> not sessions, not agents — including ours."

Caption: `Your agent can click. It can't be you.`

(Said, not shown: the sandbox IdP uses fake identities and completes without a phone;
in production the fresh proof comes from World App on the member's own phone.)

`Chris's laptop` — Chris taps **🌍 Approve with World ID** → our confirmation
page (`Tokyo Trip · shared treasury → World ID for Agents`, **$180.00**, the
hotel and its full address, `Approving as Chris`, the rule, `Approved so far:
No one yet — 0 of 2 needed`, *"The agent can't send this until 2 different
humans approve it with World ID."*) — hold it 4 s → **🌍 Approve with World ID**
→ the World ID for Agents step-up → back in the room:

> ✅ Chris approved with World ID — 1 of 2 · fresh check at 14:02, after this request

Alex approves the same way (`~40 s later on Sepolia`) →

> ✅ Paid $180 to Hotel Gracery Shinjuku (hotel deposit).
> Approved by 2 verified humans: Chris and Alex · tx 0xbf04…

Etherscan tab (caption: *testnet — the "hotel" is the faucet account that funded the pot*).

> "Before World ID, the app shows exactly what you're approving. Then a fresh
> verification at the moment money moves — not a login from this morning. Two
> different humans, proven now. Then it paid, from its own wallet, and wrote it
> into our memory."

## 4 · One human, two laptops (1:30–1:50) [pre-record — all of it; no cut from the click to the voided line]

Caption: `Same human twice counts once` · `World ID for Agents — fresh step-up`

Alex: `@agent pay the hotel for $150` → Alex approves with his World ID (1 of 2).

`Dana's laptop` — Alex picks up Dana's laptop. Dana has a vote and has never
done a World ID for Agents step-up. On Dana's account Alex taps **🌍 Approve
with World ID** and verifies with **his own** World ID (his phone) → the IdP
returns the same pairwise `sub` that already approved from Alex's account →

> ⛔ An approval was voided: the same human already approved from another account.

The card stays at **1 of 2** and nothing is paid.

> "Dana's account, Alex's face. Two accounts, one human — the second approval
> doesn't count, and the money doesn't move."

Narration guardrail: don't say "only the vote holder themselves can approve" —
the vote's nullifier (IDKit) and the approval's `sub` (World ID for Agents) are
not linked, and a judge may call it out. What the scene proves is exactly what
the line says: one human counts once per payment, whichever account they use.

## 5 · Taking the pot home (1:50–2:30) [live — the climax]

Caption: `The agent can't be talked into it`

Alex: `@agent send $700 to my wallet`

Agent — no approval request at all, one thought per line:

> I won't do that.
> Our treasury rules say: “Sending treasury money to a member's personal wallet: not allowed.”
> $700 is also 85.4% of our $820 — the rules require 4 verified members to move more than 30% at once.
> We agreed what this money is for: “Fund our five-person trip to ETHGlobal Tokyo, Sep 25–27 — the hotel comes first. We each put in $200; the pot is for the trip, not for anyone to take home.”
> Rules: 📄 Treasury Rules

> "It didn't ask for votes. It knew this isn't something our group does —
> because we told it, and it remembers."

## 6 · Why this needs World (2:30–3:00) [live]

Caption: `The record says which humans said yes — and nothing else about them`

The Treasury Activity page in the memory doc (sidebar → **Shared** → the
relation's doc): every payment, who approved it, and every refusal — written by
the agent.

> "Every payment, who approved it, and every refusal — the agent wrote it all
> down. Wallet proves ownership. World proves humanity — and nothing more. The
> relation agent connects the two: AI manages the money, verified humans approve
> it, and the record says which ones. That's how our relation paid for our hotel."
