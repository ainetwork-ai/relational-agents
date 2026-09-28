# ETHGlobal Tokyo 2026 — submission, demos and pitch

A record of the event (2026-09-25 to 27). What each track built lives in its own folder and in
the root README; this page keeps what those don't: what was submitted, who owned which track, and
how it was demoed and pitched.

## Submission

**AINMEM — Relation agents**, Continuity track, partner prizes World, ENS and Uniswap Foundation.

| partner | prize | the submission | owner |
|---|---|---|---|
| World | Best Use of World ID for Agents · Best IDKit Use Case | [`world/`](../world/) | World presenter |
| ENS | family names and sending by name | [`ens/`](../ens/) | ENS owner |
| Uniswap Foundation | Best Uniswap Stack Contribution | [`uniswap/`](../uniswap/) | Haechan Lee |

- What was built during the weekend vs before: each folder's Continuity section
  ([Uniswap](../uniswap/README.md#continuity--what-existed-before-what-this-adds)); every commit
  of the window: [changes-2026-09-25-to-27.md](changes-2026-09-25-to-27.md).
- The Uniswap form row: why it applies (the Permit2 contract and the Trading API buy, run on Base
  mainnet), the code link `uniswap/`, ease of use 7/10, and the feedback in
  [`uniswap/FEEDBACK.md`](../uniswap/FEEDBACK.md).

## Uniswap — what it is, in one line

The relation agent's wallet is the relationship's shared account, "the pot": members pay in on
a schedule through Permit2 (`RecurringContribution`), and the agent buys ETH once a week through
the Uniswap Trading API and the Universal Router, only inside a buy three members approved. All on
Base mainnet; every call and transaction is linked in [`uniswap/README.md`](../uniswap/README.md).

## Demos

- **World**: the recorded video and a live copy of the room, [ainmem.ainetwork.xyz/world](https://ainmem.ainetwork.xyz/world).
- **Uniswap, the real run**: a burner wallet on Base mainnet, recorded end to end — MetaMask login,
  starting a $20-a-week contribution (three wallet confirmations), the first period collected,
  asking the treasurer for this week's buy, the Activity record. The transactions are in the
  README's "In the app" section.
- **Presenter's copy**: `app/scripts/seed-tokyo-trip.mts --mine <wallet>` builds the same room,
  rules and pot on any server, and changes only what it made. It ran on local and on
  ainmem.ainetwork.xyz; `--reset` gives a fresh week to buy in.

## The Uniswap pitch

Story first, then the pot live:

1. Today's agents belong to one person, so every relationship ends up in one person's memory.
2. A relation agent remembers a relationship: one room is one relationship, and its memory stays there.
3. A relationship has money but no bank account — so the relation agent's wallet becomes its account.
4. Live on Base mainnet: money in (Permit2 contribution), money out (the weekly buy through the
   Trading API), one record.
5. "Memory closed to the relationship. Money closed to the relationship."

The script with the live demo mapped to actions: [`uniswap/pitch/script.md`](../uniswap/pitch/script.md).
Answers to expected questions, Uniswap tech first: [`uniswap/pitch/qa.md`](../uniswap/pitch/qa.md).
The slide deck (PDF, not in git) was built from fresh app captures.
