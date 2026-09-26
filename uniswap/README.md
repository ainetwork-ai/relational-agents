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
provider's short message, never as a silent miss.

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
| QuoterV2 `quoteExactInputSingle`, as an `eth_call` with no state change | `src/swap/router.js:21`, address at `src/chains/base.js:17` |
| SwapRouter02 `exactInputSingle` | `src/swap/router.js:51`, address at `src/chains/base.js:18` |
| a plain ERC-20 `approve` for exactly this buy's amount | `src/swap/router.js:45` |
| the 0.05% USDC/WETH v3 pool (fee tier 500) | `src/chains/base.js:19` |
| `amountOutMinimum`, from the executor's slippage bound | `src/swap/router.js:49`, policy at `src/tsumitate.js:6` |

The fill is read from the swap's own `Transfer` logs rather than from a balance difference, so a
second buy sharing the recipient in the same block cannot be counted into the family's receipt.
