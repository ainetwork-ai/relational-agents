# Family Passbook — Uniswap tsumitate inside a signed mandate

## What this is

A relationship-owned wallet turned into a shared savings account. A family member signs a spend
mandate with their own wallet (EIP-712): which pair the agent may trade, how much per run, how much
per period, until when, and anyone in the family can revoke it. On a cadence the agent buys WETH
with USDC through Uniswap v3 — once per period, only inside that mandate — and writes what happened
to a passbook the family reads: the buy with its quote and transaction, or the refusal with its
reason. The agent holds its own key and never a member's, so it cannot write itself a mandate, and
the signature is recovered again on every run, so it cannot quietly edit one either. This package is
that back end on its own: no app, no database, one JSON file.

Design record and rejected options: `plan.md`. Task-by-task build log: `tasks.md`.

## In the app — the recurring buy in the Relation Treasury

The same buy runs inside the app, where a relation's agent holds the shared pot. A member asks for
a recurring buy in the room ("@agent buy $20 of ETH every week for 12 weeks") or through the
treasurer; the relation's adopted rules decide how many verified humans must approve it with World
ID; once they have, the agent may buy once a week inside those terms, from its own wallet on Base,
and every run — bought or skipped — is a row in its history on the Treasury page, each buy also a
line in the relation's Treasury Activity.
Anyone in the room can stop it without a vote. Here the standing authority is approved by humans
with World ID instead of a signed mandate; the swap, the once-a-week rule and the passbook carry over.

| piece | where |
|---|---|
| addresses: QuoterV2, SwapRouter02, the USDC/WETH 0.05% pool (fee tier 500) | [`invest.ts:26`](../app/src/lib/agent/treasury/invest.ts#L26) |
| `QuoterV2.quoteExactInputSingle`, simulated (it answers by reverting) | [`invest.ts:76`](../app/src/lib/agent/treasury/invest.ts#L76) |
| an ERC-20 `approve` for exactly this buy, then the allowance read back on the same client until it shows | [`invest.ts:171`](../app/src/lib/agent/treasury/invest.ts#L171) |
| `amountOutMinimum` from the quote and the slippage bound | [`invest.ts:184`](../app/src/lib/agent/treasury/invest.ts#L184) |
| `SwapRouter02.exactInputSingle`, with its own gas limit | [`invest.ts:192`](../app/src/lib/agent/treasury/invest.ts#L192) |
| a receipt wait that fails after broadcast keeps the tx hash, so the week counts as used | [`invest.ts:199`](../app/src/lib/agent/treasury/invest.ts#L199) |
| the fill read from the swap's WETH `Transfer` log to the agent — on every route | [`uniswap-api.ts:162`](../app/src/lib/agent/treasury/uniswap-api.ts#L162) |
| what the agent holds, priced back through the same pool | [`invest.ts:224`](../app/src/lib/agent/treasury/invest.ts#L224) |
| once a week inside the approved terms: the decision and its refusal order | [`recurring-record.ts:341`](../app/src/lib/agent/treasury/recurring-record.ts#L341) |
| one run: the room's lock, the re-checks, the swap, one history row | [`recurring.ts:663`](../app/src/lib/agent/treasury/recurring.ts#L663), swap at [`:694`](../app/src/lib/agent/treasury/recurring.ts#L694) |
| adoption by World ID approvals; only payment kinds reach payment code | [`approvals.ts:1008`](../app/src/lib/agent/treasury/approvals.ts#L1008) |

A real swap through this path on Base mainnet (the treasury's first investment, three humans
approving): [0x9af1ec96…a53a4b](https://basescan.org/tx/0x9af1ec962d9ae5afc1f2446971cbfc253c3e9b2851b063f0e31a823711a53a4b).
Weekly runs move real USDC only where `TREASURY_INVEST=uniswap-base` and
`TREASURY_RECURRING_REAL=1` are set; elsewhere a run is a rehearsal that writes nothing.

### Through the Uniswap Trading API

With `UNISWAP_API_KEY` set, a buy asks the Uniswap Trading API first, and the API chooses the route
per buy. The direct path above is the fallback while nothing has been sent: an API error, or an
answer the buy won't act on, before a transaction goes out or an order is handed over falls back in
the same run, and the reason goes on the run's row. After that the run never falls back — a buy
that may have gone through must not be made twice — and its week stays used.

| piece | where |
|---|---|
| the choice of route, and the fallback rule | [`uniswap-api.ts:399`](../app/src/lib/agent/treasury/uniswap-api.ts#L399) |
| a buy asks for it; an investment takes CLASSIC routes only, a weekly run may take a UniswapX order | [`invest.ts:124`](../app/src/lib/agent/treasury/invest.ts#L124) |
| pinned: Universal Router 2.1.2 (the swap transaction must call it), Permit2, the UniswapX reactors on Base | [`uniswap-api.ts:22`](../app/src/lib/agent/treasury/uniswap-api.ts#L22) |
| `/check_approval` — its Permit2 approval is sent only once the quote checks out | [`uniswap-api.ts:282`](../app/src/lib/agent/treasury/uniswap-api.ts#L282) |
| `/quote`: exact input, our slippage bound, a permit for exactly this amount | [`uniswap-api.ts:293`](../app/src/lib/agent/treasury/uniswap-api.ts#L293) |
| `permitData` signed as EIP-712 with the agent's key; the primary type is the one no other type names | [`uniswap-api.ts:222`](../app/src/lib/agent/treasury/uniswap-api.ts#L222) |
| CLASSIC: `/swap`, then the Universal Router transaction — from here on nothing falls back | [`uniswap-api.ts:316`](../app/src/lib/agent/treasury/uniswap-api.ts#L316), [`:319`](../app/src/lib/agent/treasury/uniswap-api.ts#L319) |
| UniswapX (`DUTCH_V3`, `PRIORITY`): `/order`, then `/orders` polled for up to two minutes | [`uniswap-api.ts:334`](../app/src/lib/agent/treasury/uniswap-api.ts#L334), [`:361`](../app/src/lib/agent/treasury/uniswap-api.ts#L361) |
| an order still open when the run stops watching holds its week, as a sent swap does | [`recurring-record.ts:357`](../app/src/lib/agent/treasury/recurring-record.ts#L357) |
| the route and the `/quote` requestId on the run's history row | [`recurring.ts:721`](../app/src/lib/agent/treasury/recurring.ts#L721) |

Tests, offline — mocked fetch and chain, with the answer shapes the API returned on Base:
`app/scripts/uniswap-api-selftest.mts` (no key; CLASSIC; UniswapX filled; a fallback for each kind
of API error and refused answer; an order not filled in time; a swap sent, then failed).

Measured on Base on 2026-09-27 with read-only `/quote` calls, USDC → WETH: 0.1 USDC, our demo size,
routes CLASSIC through one v3 pool — the 0.01% pool, and in one quote the 0.03% pool — where the
direct path uses the 0.05% pool; at this size QuoterV2 put the 0.01% and 0.05% pools about 0.003%
apart. UniswapX-only quotes (`protocols: ["UNISWAPX_V3"]`) answered `QuoteAmountTooLowError` from
0.1 to 250 USDC, `NoRouteFoundError` at 500 and `DUTCH_V3` from 1,000; `["UNISWAPX_V2"]` answered
`PRIORITY` at 5,000. The docs: "For orders at or below 300 USDC equivalent, UniswapX is included
only when it meets that 0.2% improvement." So our buys route CLASSIC, and the UniswapX path has run
only in the tests. No swap or order has gone through the API yet — only read-only `/quote` and
`/check_approval` calls.

## Layout

Each layer runs without the layer in front of it.

| path | what |
|---|---|
| `src/swap/` | `swapProvider(name, chain) → { quote, execute }`. `router.js` is Uniswap v3 over any RPC. |
| `src/mandate/` | pure, no IO: typed data, signature recovery, `verifyApproval`, `checkMandate`, the period key. |
| `src/ledger/` | the passbook. `file.js` is one JSON file, and its `view()` is what the caps are checked against. |
| `src/tsumitate.js` | `runOnce()` — one idempotent run: choose a mandate, verify it, check it, quote, swap, record. |
| `src/chains/` | every contract and token address the JavaScript side knows; nothing else in `src/` holds one. `contracts/` names Permit2 itself — one address on every chain. |
| `src/cli/` | `fund` (fork only), `buy` (the swap layer alone), `mandate sign`/`revoke`, `tsumitate` (one run; `--dry-run` decides and quotes, writes and swaps nothing). |
| `src/web/` | `pnpm web` — a local page over the same `runOnce`, ledger and signer: sign, dry-run, run, revoke, read the passbook. |
| `src/address.js` | the one address comparison, case-insensitive. |
| `contracts/` | `RecurringContribution.sol` — recurring contributions from a member's wallet through Permit2; its Foundry tests in `contracts/test/` (`foundry.toml`). |

## Running it on the fork

Needs Node 24, pnpm and Foundry's `anvil`. Leave the fork running in its own shell:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd uniswap && pnpm install
pnpm fork                                   # Base mainnet fork, chain id 8453, port 8547
```

Then, in another shell. The two keys are anvil's own defaults standing in for the demo's people —
the agent, and the grandmother who signs:

```bash
cd uniswap
export AGENT_PK=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6   # anvil #9 — the agent
export MEMBER_PK=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a  # anvil #4 — the grandmother
rm -rf .state

pnpm fund                                   # gas, then ETH → WETH → USDC into the agent's wallet
pnpm mandate sign 20 100 90                 # standing: 20 USDC per run, 100 per week, 90 days
pnpm tsumitate                              # "bought", with the transaction hash
pnpm tsumitate                              # "skipped", "period-already-bought"
NOW=2026-10-05T09:00:00Z pnpm tsumitate     # a later ISO week → "bought"
pnpm mandate revoke <the id that sign printed>
pnpm tsumitate                              # "skipped", "revoked"
pnpm mandate sign 20 100 90                 # re-signing works: the next run buys under the new mandate
cat .state/passbook.json                    # every buy and every refusal, each with its reason
```

`tsumitate` exits 0 whether it bought or refused, 2 on a mistyped argument, 3 when the family has no
mandate at all — so a scheduler can tell its own misconfiguration from a legitimate refusal.

```bash
pnpm test
```

Read the `skipped 0` line in the summary. The two suites that need the fork skip themselves when
nothing answers on 8547, so a run reporting skips never touched the chain path.

## Running it on Base mainnet

The same code with a different `RPC_URL` — `src/chains/base.js` already holds the mainnet
addresses. Real funds, so three things differ from the fork run:

- **Fresh keys.** Never the anvil keys above; they are public. Generate two with viem's
  `generatePrivateKey()`, keep them in a git-ignored env file (the root `.gitignore` covers `.env*`)
  and fund only the agent's address: USDC for the buys, ETH for gas. The member key signs mandates
  and holds nothing.
- **A separate passbook.** `PASSBOOK_PATH=.state/passbook.base.json`, so fork rehearsals and real
  buys never share a file.
- **A dry run first.** `pnpm tsumitate --dry-run` chooses the mandate, re-verifies its signature,
  checks the caps and asks QuoterV2 for the real quote, then stops: nothing written, nothing swapped.

```bash
cd uniswap
set -a; source .env.base; set +a           # CHAIN, RPC_URL, AGENT_PK, MEMBER_PK, PASSBOOK_PATH
pnpm mandate sign 1 1 90                    # 1 USDC per run, 1 per week — the caps bound every run
pnpm tsumitate --dry-run                    # the real quote, no transaction
pnpm tsumitate                              # approve + swap on Base; the hash opens on basescan
```

Gas: on the fork the approval takes 46k–55k gas and the swap 114k–149k; multiply by the chain's
current gas price for the L2 part and read the L1 data fee, which anvil does not model, off the
first real receipt. `pnpm fund` is fork-only (anvil's balance cheat); on mainnet the deposit is an
ordinary transfer into the agent's address. A failing RPC surfaces as a `swap-failed` skip with the
provider's short message, never as a silent miss — with one gotcha: **the RPC must serve
`eth_getTransactionReceipt` for a transaction it just mined.** One that refuses (the free tier of
`base-rpc.publicnode.com` does) turns every successful swap into a "may have moved" skip that occupies
the period. `mainnet.base.org` serves receipts.

## Try it in the browser

```bash
cd uniswap
set -a; source .env.base; set +a           # or the fork's AGENT_PK / MEMBER_PK from the section above
pnpm web                                    # http://127.0.0.1:3120
```

The page is `src/web/index.html` over five routes in `src/web/server.js`, all of them the CLI's own
calls (`src/web/api.js`): sign a mandate as the member, move the demo clock (the same `NOW`), dry-run,
run for real (a confirm dialog, then `confirm: true` in the body — the only route that spends),
revoke, and the passbook with explorer links. It binds to `127.0.0.1` only, because the agent's key
sits behind it. `WEB_PORT` changes the port.

## Recurring contributions — Permit2

`contracts/RecurringContribution.sol` lets a member pay into a relation's pot on a schedule, from
their own wallet, through Uniswap's Permit2 (AllowanceTransfer, `0x000000000022D473030F116dDEE9F6B43aC78BA3`).
One contract serves every relation and every member; each plan has its own amount and its own period.

- The member calls `start(pot, token, amountPerPeriod, period, until, salt)` and gives the contract a
  Permit2 allowance on that token. `period` is in seconds — a week, two weeks, thirty days — and
  periods count from the plan's own start.
- Anyone may call `pull(id)` — the relation's agent does, once a period — and the contract moves
  exactly `amountPerPeriod` from the member to the plan's pot.
- The member calls `stop(id)` to end it.
- `plansOf(pot)` returns every plan that pays into a pot, each with `pulled` (bit i is set once period
  i was pulled) and `stoppedAt` — what an app shows, in one call. Public RPCs refuse the log ranges an
  event index would need (`eth_getLogs` is limited to 2,000 blocks on mainnet.base.org, about an hour
  of Base).

What the contract guarantees, whoever calls `pull`:
- at most `amountPerPeriod` per period. Missed periods don't add up: a late pull covers only the
  period it lands in.
- only to the pot the member chose at `start`, and nobody can start a plan that pulls from someone else.
- only until `until`, and never after `stop`.
- the member can also cut it off in Permit2 alone — `approve(token, contract, 0, 0)` — without this
  contract or us.

A member's Permit2 allowance to the contract is per token, so it is shared by all of that member's
plans on that token.

How much a member allows: both approvals are the plan's total, never unlimited — `USDC.approve(Permit2,
total)` and `Permit2.approve(USDC, RecurringContribution, total, until)`, where total is
`amountPerPeriod` × the periods until `until`. The contract has no path that sends anywhere but the
plan's pot; beyond that, if it were ever broken, what it could move from a member is bounded by that
member's remaining total, and only until the plan ends. A wallet that already approved Permit2
without limit for other apps is still capped, for this contract, by the Permit2 allowance it gives
this contract.

Deployed on Base mainnet at
[`0xE441d2DFa70fF34a20b98ddDB71433Ce8bDfC2E5`](https://basescan.org/address/0xE441d2DFa70fF34a20b98ddDB71433Ce8bDfC2E5),
source verified on [Sourcify](https://repo.sourcify.dev/8453/0xE441d2DFa70fF34a20b98ddDB71433Ce8bDfC2E5)
(exact match); `contracts/deployments/base.json` holds the address and the deploy transaction.

Its first plan runs on mainnet: a test member pays 0.1 USDC a week for three weeks into the demo
relation's pot — the agent's Base wallet `0xe03F48C1a42868707bAa9202991eCEb8BC34Cf2a` — and allowed
exactly the 0.3 USDC total. Plan id
`0xe413603acb09c3e580f17f4bf87be03f685447f0bb65c369c7a6e637767f4b91`.

| from | call | tx |
|---|---|---|
| member | `USDC.approve(Permit2, 300000)` — 0.3 USDC, the plan's total | [`0x1d6abcfb…`](https://basescan.org/tx/0x1d6abcfb92c2409044ad0bd791b57687d6d0aa44f3d351e0e78b9ee02fc77a36) |
| member | `Permit2.approve(USDC, RecurringContribution, 300000, until)` | [`0x8f128386…`](https://basescan.org/tx/0x8f128386d17774dfafe9c64c9454d4f139a68599dec55a1655ab76bf2265c9a2) |
| member | `start(pot, USDC, 100000, 604800, until, "tokyo-trip")` | [`0x858ceb92…`](https://basescan.org/tx/0x858ceb92bd54c916ff643631340f36b85d368ac40a113543ce2f677689df14c6) |
| another key | `pull(id)` — 0.1 USDC from the member to the pot; both allowances drop from 0.3 to 0.2 USDC, and `plansOf(pot)` shows `pulled = 1` | [`0x8cf28ab0…`](https://basescan.org/tx/0x8cf28ab05f120f7bfdd0a5e2b1e23ba9273185b1c1b1dc6a169826e72127afd0) |
| another key | `pull(id)` again in the same week — reverts `AlreadyPulledThisPeriod(0)` (an `eth_call`, not sent) | — |

The pull was sent from this package's own agent key, not the pot's: anyone may call `pull`, and the
USDC still went only to the plan's pot.

Not done yet: no app screen starts a plan. `node --test` runs its Foundry tests on a fork of Base
mainnet — the real Permit2 and USDC — (`test/recurring-contribution.test.js` runs `forge test
--fork-url`) and skips without Foundry or a Base RPC.

Per-period pulls are an established pattern: Coinbase Spend Permissions (`SpendPermissionManager`)
and MetaMask's `ERC20PeriodTransferEnforcer` enforce them for smart accounts. This contract does the
same for any wallet that has approved Permit2.

## Continuity — what existed before, what this adds

| piece | status |
|---|---|
| Workspace app, relationship agents, rooms, the relationship document the agent answers from | pre-existing (`app/`) |
| Agent wallet: `RelationalAgentRegistry` holds the agent, `provisionRoomAgent()` gives it a key | pre-existing (`contracts/`, `app/`) |
| EIP-712 consent between people (`RelationConsent`) — the mechanism the mandate reuses | pre-existing |
| Everything under `uniswap/`: swap layer, `SpendMandate`, ledger, executor, CLIs, web page, tests | **new, built 2026-09-25/26 during ETHGlobal Tokyo** |
| The Relation Treasury in the app (rules from the relation's doc, World ID approvals, the Sepolia pot, the investing swap) | the World track, see [`world/`](../world/) for what existed before vs what was built |
| The recurring buy in the app, its Treasury page (the agent's wallet, holdings per chain, every swap), the treasurer agent (7 tools, AG-UI stream, A2UI cards) | **new, built 2026-09-26 during ETHGlobal Tokyo** |
| `contracts/RecurringContribution.sol` — recurring contributions from members' wallets through Permit2, with Base-fork tests, deployed on Base mainnet | **new, built 2026-09-27 during ETHGlobal Tokyo** |
| The app's buy through the Uniswap Trading API (`uniswap-api.ts`), the direct v3 path as its fallback | **new, built 2026-09-27 during ETHGlobal Tokyo** |
| A scheduler that runs the week without a member asking; a Trading API provider in this package | not yet |

## Honest limits

- **One chain template.** `src/chains/base.js` serves the anvil fork and Base mainnet through
  `RPC_URL`; other chains and a Uniswap Trading API provider for this package are slice 2, behind
  the same `SwapProvider` interface (the app's buy has one — "Through the Uniswap Trading API").
- **The fork is shared.** A red balance assertion in `test/router.execute.test.js` after someone
  else's swap landed between the quote and the fill is not a code defect — rerun it.
- **`NOW` is not the chain's clock.** It moves the period key, the `at` timestamp and the expiry
  comparison; the fork's block time stays where it is.
- **Enforcement is in this process.** The signature is re-verified on every run, but nothing on
  chain stops the agent's key: no session key, no hook. A compromised agent process is unbounded.
- **The mandate bounds the input amount, not the price.** `perRunCap` and `perPeriodCap` limit
  `tokenIn`. Slippage is the executor's own `SLIPPAGE_BPS`; the family never signs a minimum output.
- **A `swap-failed` skip carrying a `txHash` means money may have moved.** That period is then
  treated as bought, so the next run refuses rather than buying on top of it — but nothing yet reads
  the chain back to find out what actually landed. A confirmed revert carries no `txHash` — the EVM
  rolled everything back — and leaves its period open. Until that reconciliation exists, mainnet
  runs are supervised — a person watching each one — from a wallet holding only what the demo
  needs, with the mandate's caps as the bound; an unattended scheduler against real funds waits.
- **A new mandate starts its own count.** Periods bought and amounts spent are kept per mandate, so
  revoking and re-signing inside one period lets that period be bought again under the new mandate,
  with `perPeriodCap` counted from zero. Re-signing needs a family member's key, which the agent
  never holds; a wallet-wide cap across mandates is slice 2.
- **`explorerTx` is a basescan link.** It opens for a mainnet transaction and not for a fork one —
  the hash is real on the fork and unknown to the public explorer.
- **The anvil keys above are demo actors.** They are published test keys; never reuse them anywhere.
- **Single writer.** Never run two executors against one passbook: the ledger is read-modify-write
  with no lock, and `writeFileSync` is not atomic.
- **The passbook is a plain JSON file** and can be edited by hand. `record` refuses entries the cap
  check could not see, and `runOnce` re-verifies the mandate's signature, but the file is not sealed.

## The Uniswap pieces

| piece | where |
|---|---|
| QuoterV2 `quoteExactInputSingle`, as an `eth_call` with no state change | `src/swap/router.js:36`, address at `src/chains/base.js:17` |
| SwapRouter02 `exactInputSingle` | `src/swap/router.js:67`, address at `src/chains/base.js:18` |
| a plain ERC-20 `approve` for exactly this buy's amount | `src/swap/router.js:60` |
| the 0.05% USDC/WETH v3 pool (fee tier 500) | `src/chains/base.js:19` |
| `amountOutMinimum`, from the executor's slippage bound | `src/swap/router.js:65`, policy at `src/tsumitate.js:6` |

The fill is read from the swap's own `Transfer` logs rather than from a balance difference, so a
second buy sharing the recipient in the same block cannot be counted into the family's receipt.
