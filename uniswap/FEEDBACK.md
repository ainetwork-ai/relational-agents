# FEEDBACK.md — Uniswap stack, ETHGlobal Tokyo 2026 (Continuity track)

Project: **Family Passbook** — a relationship agent that buys WETH with USDC on Uniswap v3 on a
cadence, only inside a mandate a family member signed, and writes every buy and refusal to a
passbook. Code: `uniswap/` in this repository; README lists every Uniswap call with `file:line`.

## What we used

- **v3 periphery on Base**: `QuoterV2.quoteExactInputSingle` for the quote, an ERC-20 `approve`,
  `SwapRouter02.exactInputSingle` for the swap, `amountOutMinimum` for slippage. Addresses from the
  v3 deployments page (Base column) — all correct.
- **`uniswap-ai` → `dca-bot` skill**: its autonomous-mode guardrails (per-run cap, per-period cap,
  token allowlist, dry run, kill switch) became the fields of an EIP-712 `SpendMandate`; its
  warning about period keys (a UTC-day key double-buys across a week boundary) became our ISO-week
  key and a pinned test.
- **anvil fork of Base mainnet** for the 69-test suite; **Base mainnet** with real funds for the demo.
- Not used: the Trading API (no key on the day). Our `decisionOrigin` field (`autonomous` for a
  standing mandate, `human_mediated` for a one-off) is shaped for `X-Agent-Info`.

## What worked without friction

- The deployments page, the QuoterV2/SwapRouter02 ABIs and the fee-tier model: quote and swap ran
  on the fork on the first day.
- The `dca-bot` guardrail list is the right list. Turning it into a signed object the app enforces
  needed nothing the skill did not already name.
- Gas on Base is negligible for a small DCA: the mandated buy used 135,157 gas and cost
  0.00000081 ETH including the L1 data fee (2026-09-26).

## What cost us time — with what we measured

1. **Approve → swap on a public RPC pool.** On Base mainnet through `mainnet.base.org`, the
   approval was mined (receipt `success`, allowance visible on every RPC a moment later) but the
   swap's `eth_estimateGas` ran on a node one block behind and reverted with `STF` — simulated
   against a zero allowance. A single-node fork never shows this. Fix on our side: after the
   approval receipt, poll `allowance(owner, router)` on the same client until it is ≥ `amountIn`
   (bounded), then send the swap. **Suggestion:** one sentence in the swap-integration skill —
   "on load-balanced RPCs, confirm the allowance on your own client before sending the swap".
2. **RPCs that refuse receipts.** `base-rpc.publicnode.com` (free tier) answered quotes and
   balances but refused `eth_getTransactionReceipt` for a transaction it had just mined ("Archive
   requests require a personal token"). For a DCA bot that is the worst failure: the swap landed
   and the bot cannot know. We file such a run as "may have moved" and lock the period. **Suggestion:**
   the `dca-bot` state-file guidance could name this outcome — a period that is neither bought nor
   free — so bots do not double-buy on the retry.
3. **`QuoterV2` is `nonpayable`.** It returns its answer by reverting, so `readContract` cannot call
   it; `simulateContract` (viem) or `callStatic` is needed. Known to v3 veterans, a trap for a
   first-timer with a typed client. A line on the QuoterV2 reference page would save the hour.
4. **Testnet pools cannot demo a price.** Measured 2026-09-26, 20 USDC → WETH:
   Ethereum Sepolia USDC/WETH quoted ≈ 29,700 USDC per ETH across all four fee tiers (about
   11× the real price); Base Sepolia's four tiers disagreed with each other (1,281 / 1,634 /
   3,763 / 14,965). Nothing arbitrages faucet USDC. We demoed on mainnet with 1 USDC buys instead.
   **Suggestion:** a maintained "demo pool" on one testnet, or docs that say plainly "fork mainnet
   for realistic prices".
5. **Fill measurement.** A balance read before and after the swap counts anything else that
   credited the recipient in the same window. We decode the ERC-20 `Transfer` to the recipient out
   of the swap's own receipt instead. Worth stating in the skill as the way to record a fill.

## Links

- Mandated buy on Base mainnet: https://basescan.org/tx/0xf08c1b78e29e055692cbd71f61af1189af19825026891dbd7c79448e824064de
- Where each Uniswap call lives: `uniswap/README.md`, section "The Uniswap pieces".
- Design record: `uniswap/plan.md`.
