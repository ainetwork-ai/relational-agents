# Uniswap pitch — answers to expected questions

## The Uniswap tech

- **Which Uniswap tech did you use?** Four pieces, all live on Base mainnet. One: the **Uniswap Trading API** — the agent's weekly buy calls `/check_approval`, `/quote` and `/swap`. Two: the **Universal Router** 2.1.2 — the API's swap goes through it. Three: **Permit2**, in two places — the swap's permit is signed for exactly one buy, and our RecurringContribution contract pulls members' contributions through Permit2. Four: **Uniswap v3** — QuoterV2 checks every API quote, and SwapRouter02 is our fallback.
- **What did you build yourselves?** RecurringContribution: a contract on Permit2 AllowanceTransfer, deployed and verified on Base (Sourcify), with 16 fork tests. And the app's Trading API buy: exact approvals, a price floor from QuoterV2, a safe fallback. All built at this hackathon; the relation agent app existed before.
- **Why the Trading API, not just the router?** The API picks the best route for each buy. At our size it found the v3 0.01% pool, while our direct path uses the 0.05% pool. It can also route to UniswapX when that's better.
- **How do you use Permit2?** Two ways. Swaps: the agent signs the API's `permitData` (EIP-712) for exactly the buy amount. Contributions: each member gives our contract a Permit2 allowance of exactly the plan's total, with an end date. Every pull lowers it. The member can set it to 0 in Permit2, without us.
- **Isn't Uniswap's approval unlimited?** `/check_approval` returns an unlimited approval — that's how Permit2 is designed. But this is a group's pot, so no approval goes beyond one buy. We send our own `approve(Permit2, amountIn)`. After each buy, both allowances read 0.
- **Do you trust the API's quote?** We check every route against the chain. The quote's minimum must reach QuoterV2's price minus our slippage, or we don't send it.
- **What if the API fails?** If nothing has been sent yet, the agent buys through Uniswap v3 directly, in the same run. Once something is sent, it never buys again that week. So it can't buy twice.
- **UniswapX?** The code supports it, and it's tested offline. But the API picks the route, and at 0.1 USDC it gives no UniswapX quote. In our tests, DUTCH_V3 appeared from about 1,000 USDC, and PRIORITY at 5,000 USDC.
- **v4? Hooks?** Our quote allows V2, V3 and V4 routes, and at our size the API chose v3 pools. We didn't write a hook — the group's rules are checked before the swap.
- **How can I check it?** `uniswap/README.md` links every Uniswap call to its line of code, with the mainnet transactions. The contract is verified on Sourcify.
- **What was hard?** It's in `FEEDBACK.md`. `/check_approval` has no "exact" option. `permitData` has no `primaryType`, which viem needs. After an approve, a load-balanced RPC node can be a block behind, so the swap fails with STF. QuoterV2 answers by reverting.

## Everything else

- **Can the agent drain a member's wallet?** No. A member allows only the plan's total, only until its end date. The contract takes one payment per period, only into the pot chosen at the start. Members can stop any time.
- **Who holds the agent's key?** Our app server. It's encrypted in the database, so a copy of the database alone can't move money. But the server signs with it. So today the app enforces the buy rules, and the contract enforces the contributions. Moving the buy rules into a contract, like we did for contributions, would shrink what you have to trust.
- **What if someone edits the rules?** An edit is only a proposal. It counts only after the strictest approval count in the rules adopts it.
- **What if the agent misreads a message?** Money commands are matched by sentence shape, not by the model. "I paid $180 yesterday" is not a command. A missed command costs a retyped message; a wrong one costs the pot.
- **Why Base?** Low gas for small weekly payments and swaps — our last buy cost about 0.000001 ETH — and native USDC.
- **Are the dollars real?** Prices and trades are real. The dollar labels use a demo scale: on Base, $1 = 0.005 USDC. The Sepolia pot shows 1 test ETH as $200,000.
