# Family Vault — Bounty Scenario (for team sharing)

> **Status: 1inch bounty submission cancelled (2026-09-25).** The team went with a different bounty.
> This document and the `family-vault/` implementation are kept as a finished demo asset — the
> content below is a record of the submission plan from before the cancellation.

A fleshed-out version of the "family" scenario Sungmin confirmed on 2026-09-25. The code, demo, and docs
live in `family-vault/` (in English); this document is for internal team sharing.

## 1. Track name

**1inch 💦 Build an Aqua App — Continuity Track** ($2,000 · 1st place $1,500 / 2nd place $500)

## 2. Track requirements (verified)

- Use the official Aqua/SwapVM contracts — **redeploying a modified SwapVM is explicitly allowed**
- The demo includes an on-chain token transfer (a local fork is OK)
- Continuity: an extension of existing open source + small, granular commits during the hackathon (a single commit on the last day = disqualification)
- Bonus points for using SwapVM

**How we meet them**: ship/dock to the official Aqua registry (0x1111113…) ✅ ·
a SwapVM redeploy with 2 added custom operators (the official TestCustomSwapVM pattern) ✅ ·
the on-chain transfer in claim() ✅ · repo history since July + about 20 hackathon commits ✅

## 3. Demo scenario (3 minutes, voice-over — script: family-vault/DEMO.md)

1. **Deposit (100th-day celebration)** — The parents deposit $1,000 (USDC+WETH) into their family's vault contract
   + 🔒 seal a letter in the workspace. The vault becomes a maker itself and ships its investment policy to the
   official Aqua. Policy = a 4-instruction SwapVM program:
   `salt · timeCapsule(maturity, childAddress) · lowRiskGuard(maturity, 5%) · xycSwap`
2. **Growth (age 0→18)** — Market takers trade against the vault, and the spread becomes the child's
   interest. Every fill and event is recorded automatically in the Vault Ledger (an 18-year value line chart).
   The assets never leave the vault wallet for all 18 years (self-custody).
3. **Emergency-exit scene (10 seconds)** — The parents' early-termination request (public, on-chain, 30-day wait)
   and its cancellation. Both stay in the family's record. A token that goes bust is handled by re-shipping the policy.
4. **Opening (age 18)** — anvil time jump → the child's single claim() transaction transfers
   principal + returns on-chain → the same event unlocks the letter page + sends an inbox notification.
   **"The assets and the message arrive at the same time."**

## Why 1inch (the judging argument in 3 sentences)

1. The 18-year question is "where is the money?", and only Aqua answers "the liquidity never leaves
   the maker's wallet" — for custody across generations, that is not a convenience but the reason to exist.
2. In SwapVM the investment policy is not a contract but a program a few bytes long, so changing policy
   over 18 years is a single dock→ship, not a redeploy and re-audit.
3. The returns come not from a keeper bot but from real market flow going through the official registry.

## Four pillars of the winning strategy

① **Extend** SwapVM rather than just call it (2 custom operators — top of the bonus list)
② A **consumer story** that avoids the trading-UI graveyard (using the deepest part of the protocol through a story you get in 3 sentences)
③ The half only we have — **memory** (letter seal/unseal, ledger, notifications: a real product with months of history)
④ The demo choreography pre-empts the judges' Q&A (the emergency-exit and policy-swap scenes)

## Remaining work

- [ ] Record the demo video voice-over (script family-vault/DEMO.md, pipeline commands as-is)
- [ ] (Optional) Set up a clean "Family" workspace for recording — the current dev workspace has
      relationship-demo pages mixed in
- [ ] Submit the ETHGlobal form (project name Family Vault, pick the track)
