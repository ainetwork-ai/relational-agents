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
| addresses: QuoterV2, SwapRouter02, the USDC/WETH 0.05% pool (fee tier 500) | [`invest.ts:22`](../app/src/lib/agent/treasury/invest.ts#L22) |
| `QuoterV2.quoteExactInputSingle`, simulated (it answers by reverting) | [`invest.ts:70`](../app/src/lib/agent/treasury/invest.ts#L70) |
| an ERC-20 `approve` for exactly this buy, then the allowance read back on the same client until it shows | [`invest.ts:114`](../app/src/lib/agent/treasury/invest.ts#L114) |
| `amountOutMinimum` from the quote and the slippage bound | [`invest.ts:127`](../app/src/lib/agent/treasury/invest.ts#L127) |
| `SwapRouter02.exactInputSingle`, with its own gas limit | [`invest.ts:135`](../app/src/lib/agent/treasury/invest.ts#L135) |
| a receipt wait that fails after broadcast keeps the tx hash, so the week counts as used | [`invest.ts:142`](../app/src/lib/agent/treasury/invest.ts#L142) |
| the fill read from this swap's WETH `Transfer` log | [`invest.ts:152`](../app/src/lib/agent/treasury/invest.ts#L152) |
| what the agent holds, priced back through the same pool | [`invest.ts:177`](../app/src/lib/agent/treasury/invest.ts#L177) |
| once a week inside the approved terms: the decision and its refusal order | [`recurring-record.ts:327`](../app/src/lib/agent/treasury/recurring-record.ts#L327) |
| one run: the room's lock, the re-checks, the swap, one history row | [`recurring.ts:661`](../app/src/lib/agent/treasury/recurring.ts#L661), swap at [`:690`](../app/src/lib/agent/treasury/recurring.ts#L690) |
| adoption by World ID approvals; only payment kinds reach payment code | [`approvals.ts:990`](../app/src/lib/agent/treasury/approvals.ts#L990) |

A real swap through this path on Base mainnet (the treasury's first investment, three humans
approving): [0x9af1ec96…a53a4b](https://basescan.org/tx/0x9af1ec962d9ae5afc1f2446971cbfc253c3e9b2851b063f0e31a823711a53a4b).
Weekly runs move real USDC only where `TREASURY_INVEST=uniswap-base` and
`TREASURY_RECURRING_REAL=1` are set; elsewhere a run is a rehearsal that writes nothing.

## Layout

Each layer runs without the layer in front of it.

| path | what |
|---|---|
| `src/swap/` | `swapProvider(name, chain) → { quote, execute }`. `router.js` is Uniswap v3 over any RPC. |
| `src/mandate/` | pure, no IO: typed data, signature recovery, `verifyApproval`, `checkMandate`, the period key. |
| `src/ledger/` | the passbook. `file.js` is one JSON file, and its `view()` is what the caps are checked against. |
| `src/tsumitate.js` | `runOnce()` — one idempotent run: choose a mandate, verify it, check it, quote, swap, record. |
| `src/chains/` | every contract and token address this package knows. Nothing outside this folder holds one. |
| `src/cli/` | `fund` (fork only), `buy` (the swap layer alone), `mandate sign`/`revoke`, `tsumitate` (one run; `--dry-run` decides and quotes, writes and swaps nothing). |
| `src/web/` | `pnpm web` — a local page over the same `runOnce`, ledger and signer: sign, dry-run, run, revoke, read the passbook. |
| `src/address.js` | the one address comparison, case-insensitive. |

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

## Continuity — what existed before, what this adds

| piece | status |
|---|---|
| Workspace app, relationship agents, rooms, the relationship document the agent answers from | pre-existing (`app/`) |
| Agent wallet: `RelationalAgentRegistry` holds the agent, `provisionRoomAgent()` gives it a key | pre-existing (`contracts/`, `app/`) |
| EIP-712 consent between people (`RelationConsent`) — the mechanism the mandate reuses | pre-existing |
| Everything under `uniswap/`: swap layer, `SpendMandate`, ledger, executor, CLIs, web page, tests | **new, built 2026-09-25/26 during ETHGlobal Tokyo** |
| The Relation Treasury in the app (rules from the relation's doc, World ID approvals, the Sepolia pot, the investing swap) | the World track, see [`world/`](../world/) for what existed before vs what was built |
| The recurring buy in the app, its Treasury page (the agent's wallet, holdings per chain, every swap), the treasurer agent (7 tools, AG-UI stream, A2UI cards) | **new, built 2026-09-26 during ETHGlobal Tokyo** |
| A scheduler that runs the week without a member asking, the Trading API provider | not yet |

## Honest limits

- **One chain template.** `src/chains/base.js` serves the anvil fork and Base mainnet through
  `RPC_URL`; other chains and the Uniswap Trading API provider are slice 2, behind the same
  `SwapProvider` interface.
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
