# DEMO.md — the four-minute video, shot by shot

Recorded against Base mainnet with the page (`pnpm web`, http://127.0.0.1:3120) and one terminal.
Every "Run for real" spends 1 USDC from the agent's wallet; everything else is free. A human voice
narrates (ETHGlobal rule); the lines below are what to say, not a script to read.

| # | on screen | say | spends |
|---|---|---|---|
| 1 | The page header: chain `base`, the agent's address, its balances | "This wallet belongs to the family's agent — the same agent that already lives in our workspace. Today it becomes a shared savings account." | — |
| 2 | Mandates: the live mandate — 1 USDC per run, 1 per week, 90 days, signed by the grandmother's key | "Grandma signed this with her own wallet: what the agent may buy, how much per run, how much per week, until when. The agent holds its own key and never hers, so it cannot write itself a mandate." | — |
| 3 | Run → **Dry run** | "Before it spends, it rehearses: picks the live mandate, re-checks her signature, checks the caps, asks Uniswap's quoter for the real price — and writes nothing." | — |
| 4 | Run → **Run for real** (this week is already bought) → `skipped: over-per-period-cap` in the passbook | "It refuses. She allowed one USDC a week and this week's buy already happened. The refusal goes into the passbook with its reason — a line the family reads, not a silent no-op." | — |
| 5 | Set "Pretend it is" to next week → **Dry run** → **Run for real** → confirm → `bought`, click the basescan link | "Next week: quote, approve, swap through Uniswap v3 on Base — here is the transaction. The fill is read from the swap's own Transfer log, so the passbook shows what actually landed." | 1 USDC |
| 6 | Passbook table: buys and refusals, prices, links | "Every week, every refusal, every price. This is what the agent remembers when Grandma asks 'why didn't we buy last week?'" | — |
| 7 | **Revoke** → **Run for real** → `skipped: revoked` | "Anyone in the family can revoke. From that moment the agent's runs are refused — and recorded." | — |
| 8 | **Sign** a new mandate → **Run for real** → `bought` | "Re-signing takes effect on the next run. Same code path on a local fork for the 69 tests, on mainnet for this video." | 1 USDC |
| 9 | README's "The Uniswap pieces" table, and the terminal: `pnpm test` summary `69 pass · skipped 0` | "QuoterV2, an ERC-20 approve and SwapRouter02's exactInputSingle — each call named with its file and line. Slippage is the executor's bound; the caps are the family's." | — |

Budget: two real buys (shots 5 and 8) = 2 USDC; the wallet holds 8.41 USDC and 0.0015 ETH.

Before recording: `pnpm tsumitate --dry-run` in the terminal once, so the RPC is answering; keep
the fork off — the page reads `.env.base` (mainnet). If shot 5's swap files as `swap-failed`, read
the reason on the page: a skip with no txHash leaves the period open, so the same shot can be
retaken.
