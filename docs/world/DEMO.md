# Relation Treasury — demo script (3:00, human voiceover)

**AI manages the money. Humans approve it.**
Record the voice live (ETHGlobal: no AI narration). Screen: the Tokyo Trip room
(chat left, treasury panel on top), switching members with the demo login.
Scenes marked **[pre-record]** depend on outside services (the World IdP, the
chain) and are captured as separate takes; **[live]** scenes are deterministic.

Setup before recording: `cd app && npx tsx --tsconfig scripts/tsconfig.json scripts/seed-tokyo-trip.mts --reset`
→ five friends, $1,000 in the agent's wallet, the relation's memory doc with
Purpose / Treasury Rules / Payees, Chris·Dana·Eli already seated.

## 1 · The relation (0:00–0:30) [live]

The Tokyo Trip room: the chat where five friends agreed the rules, and the
relation's memory doc beside it — **Treasury Rules** in plain sentences.

> "Five of us came to Tokyo with one pot of money. We gave it to our room's
> agent — the same agent that already keeps this relationship's memory. It
> doesn't follow a settings page. It follows what we agreed, written here, in
> our own words."

Alex taps **Claim your seat with World ID** (IDKit, Proof of Human).

> "Before anyone can approve anything, they prove one thing: that they're a
> unique human. Not who they are — no passport, no name. Just: one human, one
> seat."

## 2 · The second account (0:30–0:50) [pre-record — needs the Portal app]

"Alex (2nd account)" tries to claim a sixth seat → **"This human already holds
a seat in this relation — one human, one seat."**

> "A wallet can't tell you this. Alex can make ten accounts and ten wallets —
> World ID still sees one human."

## 3 · Paying the hotel (0:50–1:50) [live + pre-record for the IdP hop]

Alex: `@agent pay the hotel deposit, $180`

Agent: *"This needs 2 verified humans. Our rules say: “Shared expenses from $50
to $200: 2 verified members approve.”"* — a pending card appears: 0 / 2.

Chris taps **Approve with World ID** → the World ID for Agents step-up →
back in the room: 1 / 2. Alex approves → **✅ Paid $180 to Hotel Gracery
Shinjuku — approved by Chris, Alex (2 of 2 verified humans).** Etherscan tab.

> "The agent asked for a fresh verification at the moment money moves — not a
> login from this morning. Two different humans, proven now. Then it paid, from
> its own wallet, and wrote it into our memory."

## 4 · Taking the pot home (1:50–2:35) [live — the climax]

Alex: `@agent send $700 to my wallet`

Agent — no approval request at all:
*"I won't do that. Our treasury rules say: “Sending treasury money to a
member's personal wallet: not allowed.” $700 would also be 70% of our $1,000 —
moving more than 30% at once needs 4 verified members. We agreed this money is
for: fund our five-person trip to ETHGlobal Tokyo — the hotel comes first."*

> "It didn't ask for votes. It knew this isn't something our group does —
> because we told it, and it remembers. And if Alex had tried to vote twice
> from his second account? Same human, one vote."

(Optional 5-second cut: the 2nd account approving a pending request →
**"⛔ An approval was voided: the same human already approved from another
account."**)

## 5 · Why this needs World (2:35–3:00) [live]

The Treasury Activity page in the memory doc: every payment, refusal and
approver, written by the agent.

> "Wallet proves ownership. World proves humanity. The relation agent connects
> the two. AI manages the money — humans approve it. And that's how our
> relation paid for our hotel."
