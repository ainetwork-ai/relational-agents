# Family Passbook — Uniswap tsumitate for a relationship-owned wallet

ETHGlobal Tokyo 2026 · **Uniswap Foundation — Best Uniswap Stack Contribution, Continuity Track**.
Design record, written 2026-09-25 before implementation. Decisions and rejected options stay here;
current behaviour lives in `README.md` once it exists.

## The claim

A relationship (a family) already owns an agent and that agent already owns a wallet
(`RelationalAgentRegistry` holds the agent NFT; `provisionRoomAgent()` gives it a key). Today the
agent can spend that wallet on anything. This work makes the wallet a **shared savings account**:

- **Mandate** — a family member signs (EIP-712, same mechanism as `RelationConsent`) what the agent
  may buy, how much per run and per period, until when. Anyone in the family can revoke.
- **Tsumitate** — on a cadence the agent buys through Uniswap inside the mandate, and only inside it.
- **Passbook** — every buy, deposit and *skipped* run is written where the family reads: a database
  row (dashboard) and a line in the relationship document (the agent's memory), with the reason,
  the quote, the transaction and the mandate that allowed it.

Uniswap's own `dca-bot` skill names the same guardrails for autonomous mode (per-run cap, per-period
cap, token allowlist, dry run, kill switch) and keeps its memory in a JSON state file. The mandate
is those guardrails as a signed object the app enforces; the passbook is that state file as a page.

## Layers, back to front

Each layer has one interface and at least one implementation that runs **without the layer in front
of it**, so the front can change (scenario, UI, chain) without touching the back.

### 1. Swap — `uniswap/src/swap/`

```ts
interface SwapProvider {
  quote(intent: SwapIntent): Promise<Quote>          // no side effects
  execute(quote: Quote, signer: Account): Promise<Receipt>
}
SwapIntent = { chainId, tokenIn, tokenOut, amountIn, recipient, slippageBps }
Quote      = { provider, amountIn, amountOutExpected, route, raw }
Receipt    = { txHash, amountIn, amountOut, price, route, provider, decisionOrigin }
```

Two providers, chosen by `SWAP_PROVIDER`:

| provider | how | needs | gives |
|---|---|---|---|
| `router` | v3 `SwapRouter02.exactInputSingle` with a plain ERC-20 approval, quote from the v3 `QuoterV2`; any EVM RPC | an RPC (Base fork via anvil today; Sepolia later) | works now, real Base liquidity on the fork |
| `api` | Trading API `check_approval → quote → swap`, calldata signed by the agent | `UNISWAP_API_KEY` | `X-Agent-Info` attribution, hosted routing |

Chain facts (addresses, tokens, decimals) live in `uniswap/src/chains/<chain>.js`, the way the
`dca-bot` skill's "target-chain template" does. Nothing else knows an address.

Rejected: a v4 hook enforcing the mandate on-chain. It needs our own pool, our own liquidity and
routing we do ourselves (the Interface does not route to hooked pools); the mandate's value is the
same when the app enforces it. Recorded as stretch, not scope.

### 2. Mandate — `uniswap/src/mandate/`

Pure functions, no IO, unit-tested with `node:test`.

```ts
Mandate = { id, roomId, agent, kind: "standing" | "oneoff",
            tokenIn, tokenOut, perRunCap, perPeriodCap, period: "week",
            expiresAt, nonce, revokedAt?,
            approval?: { method: "wallet-signature" | string, subject, verifiedAt, ref } }
typedData(m)                       → EIP-712 payload (own domain `ainmem Family Passbook`; same mechanism as RelationConsent, not the same domain)
verify(m, signature)               → signer address | throws
check(m, ledgerView, intent, now)  → { ok: true, decisionOrigin } | { ok: false, reason }
```

`check` refuses, in this order: revoked · expired · pair not allowed · `amountIn > perRunCap` ·
`spentThisPeriod + amountIn > perPeriodCap` · period already bought (standing only).
`decisionOrigin` is `autonomous` for a standing mandate and `human_mediated` for a one-off — the
value the `api` provider puts in `X-Agent-Info`.

Period key is derived from the cadence (ISO week for `week`), never from the UTC day — the
`dca-bot` skill documents the double-buy bug a wrong key causes.

`approval` is the one field another authentication can replace: `check` only asks whether a valid
approval exists, never how it was produced. `wallet-signature` (EIP-712, `verify` above) is the
default and the only method this plan implements; a World ID step-up or anything else plugs in by
writing the same field.

Why a signature and not a checkbox: the agent holds its own key but never a member's, so it cannot
forge a mandate; the passbook can show *who allowed what, when* as a verifiable fact; and it is the
mechanism the repo already uses at the agent's birth.

Limit, stated in README: enforcement is in the app's process. Chain-level enforcement (session keys
on a smart account, or a hook) is out of scope.

### 3. Ledger — `uniswap/src/ledger/`

```ts
interface Ledger {
  view(): Promise<LedgerView>        // { activeMandates, spentByPeriod, boughtPeriods }
  record(entry: Entry): Promise<void>
}
Entry = { at, kind: "deposit" | "buy" | "skip", who, amountIn?, amountOut?, price?, txHash?,
          mandateId?, reason?, decisionOrigin? }
```

| impl | where it writes | needs |
|---|---|---|
| `file` | `.state/passbook.json` | nothing — the executor runs end to end with no app |
| `workspace` | a **Family Passbook** database row (dashboard) **and** a line in the relationship document's `passbook` section (what the agent reads when asked "why did we buy") | the app over REST (a thin client: demo-login cookie, databases API), a demo account of its own (`demo-login { as }`) |

The relationship document is the memory the agent answers from (`readOkfSectionTexts` reads every
section in the tree); databases are not. Hence the dual write. Mandates are stored as JSON in the
passbook page's frontmatter — no new Postgres table, so no schema push in a shared DB.

### 4. Executor — `uniswap/src/tsumitate.js`

One invocation = one run, idempotent:

```
ledger.view → choose mandate → intent → mandate.check ─fail→ ledger.record(skip, reason)
                                          │ok
                                          ▼
                              swap.quote → re-check with quoted amounts (slippage)
                                          ▼
                              swap.execute (agent key) → ledger.record(buy)
```

The executor never schedules itself. A cadence comes from outside: `pnpm run tsumitate` on a cron,
or a timer in the app (`instrumentation.ts`) later. `TSUMITATE_PERIOD` lets the demo video compress
"weekly" into minutes without changing the period-key logic.

### 5. Front (later, changeable)

Mandate signing screen · deposit button · `family` profile with a `passbook` section · dashboard
seed (`seed.js`, pure data + view config) · `DEMO.md` · `FEEDBACK.md`.

## Build order

1. `swap/router` on a Base fork — quote + execute, printed receipt. Proves the chain path with no key.
2. `mandate` + tests.
3. `ledger/file` + executor — end to end on the fork: buy, then refuse (cap, revoked, same period).
4. `ledger/workspace` — needs `app/.env.local` and a running app.
5. `swap/api` — when `UNISWAP_API_KEY` exists; same interface, adds `X-Agent-Info`.
6. Front.

## Continuity split (for README)

Pre-existing: workspace, relationship agents, registry + agent wallet, EIP-712 consent, databases
and dashboard widgets, aindrive links. Built here: everything in `uniswap/`, the `SpendMandate`
type, the `passbook` profile section, the scheduler hook.

## Open

- Chain for the video: Base fork (sure) vs Sepolia + API (needs key). Same code path either way.
- Who deposits in the demo (grandmother only, or the son too).
