# Uniswap pitch — script

Read the quoted lines aloud. `▶` is what to do. The slides carry the same sentences.
Before: the presenter's copy freshly seeded (`seed-tokyo-trip.mts --mine <wallet> --reset`), the
presenter logged in with MetaMask on Base, their own contribution stopped so the page shows
**Start again**.

## Opening

> Hello, judges. I'm sorry — my English is not very good. So that I can explain clearly, I'll read from my notes. Thank you for understanding.

## Slides

**Title — "Relation agents"** (optional)

> We built relation agents.

**"AI agents belong to one person."**

> Today, every AI agent belongs to one person. It helps with my email, my calendar, and my questions.
> But most important things in life happen between people — with family, with friends, with a team.
> A personal agent keeps all of these relationships in one person's memory. What I decided with my friends and what I decided with my family get mixed in one place.
> That memory is not "our" memory. It is "us," as one person remembers it.

**"A relation agent remembers a relationship."**

> So we built relation agents. A relation agent is an agent that remembers a relationship.
> What happens between us, and what we agree on, is not kept in each person's memory. It is kept in one place: the relationship.

**"One room is one relationship."** (the room's chat)

> One chat room is one relationship, and the relation agent lives there.
> It turns the conversation in the room into the relationship's memory. This way, our memories don't get mixed, and the memory stays with the relationship. The relation agent uses that memory to help the relationship.

**"A relationship has no account."**

> A relationship doesn't only have memories. It also has money — for a trip, for dues, for gifts.
> But a relationship can't have a bank account. So the group's money always sits in one person's account. That person holds it, collects it, and asks everyone for permission. Everyone else has to trust that one person.
> So what if we give the relationship its own account? The relation agent's wallet becomes the relationship's account.

**"Now, the pot — live."**

> Now let me show you this account — we call it the pot — live on Base mainnet. Three things: money goes in from my wallet, the agent makes this week's buy, and both stay in one record.

## Live demo

1. **▶ Switch to the browser → Wallet tab**
   > This is the pot — the relation agent's wallet. It holds real USDC on Base and trades through Uniswap. The big number at the top is test money on Sepolia, for payments.
2. **▶ Contributions tab**
   > Money comes in from each member's own wallet, on a schedule. You can see who paid when, by person and by month. On screen, $20 is really 0.1 USDC. Prices and trades are real.
3. **▶ Start again → $20 · Weekly · 3**
   > I'll join too. Twenty dollars a week, for three weeks.
4. **▶ Point at the green summary**
   > I allow exactly 0.3 USDC. No unlimited approval.
5. **▶ Continue → Confirm in your wallet**
   > This runs on Permit2 and our own contract, RecurringContribution.
6. **▶ MetaMask confirmation 1**
   > One: Permit2 can use exactly 0.3 USDC.
7. **▶ MetaMask confirmation 2**
   > Two: the contract can take that amount, only until the plan ends.
8. **▶ MetaMask confirmation 3**
   > Three: the plan starts. The contract takes a set amount, once each period, only into this pot.
9. **▶ "You're in" → Done** — say the line that matches the dialog
   - "Your first 0.1 USDC is in the pot." → > My first week is already in the pot.
   - "The agent collects it with the next run." → > The agent collects my first week on its next run. Let's run it now.
10. **▶ Treasurer tab**
    > Now, money out. Three members approved a weekly ETH buy.
11. **▶ Type `Run this week's recurring buy.` → Enter**
    > I'll ask the agent to run this week's buy.
12. **▶ While it runs**
    > First, it collects this week's contributions. Then it gets a quote from the Uniswap Trading API and checks it against the Uniswap v3 price. It approves only this one buy, and swaps through the Universal Router.
13. **▶ The answer shows a Basescan link**
    > Done. This is a real transaction on Base mainnet.
14. **▶ Activity tab → open the "Weekly ETH buy" row**
    > Money in and money out, in one record. The route: Uniswap Trading API, Universal Router.

If a wallet step fails, press **Try again**. If the buy doesn't finish, switch to the backup
slides: "This is the same run from this morning."

## Closing — "Memory closed to the relationship. Money closed to the relationship."

> Relation agents keep memory closed to the relationship. Give that relationship an account, and you get money closed to the relationship — money that moves only as the group agreed.
> Memory closed to the relationship. Money closed to the relationship. Thank you.
