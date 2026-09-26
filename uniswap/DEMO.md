# DEMO.md — the video, shot by shot

The recurring buy inside the app's Tokyo Trip room: a request in chat, three humans approving with
World ID, the agent buying through Uniswap v3 on Base, the Treasury page showing it, anyone
stopping it. 2–4 minutes; a human voice narrates (ETHGlobal rule) — the lines are what to say, not
a script to read.

## Rehearse locally, record on the demo server

| | local (rehearsal) | ainmem.ainetwork.xyz (the take) |
|---|---|---|
| reset | `app/scripts/rehearse-local.sh` — rebuilds the room, prints the sign-in links | the World track's reset (`world/DEMO.md`) |
| World ID | the local mock IdP: Chris = Human 3, Dana = 4, Eli = 5 | World's sandbox (simulator identities) |
| the pot | a local Sepolia fork, $1,000 of fake ETH | Sepolia testnet |
| the weekly buy | a rehearsal line — nothing moves | a real swap on Base: needs `TREASURY_RECURRING_REAL=1` in `.env.xyz` |
| the treasurer | answers (tool-calling model) | needs a tool-calling model behind `AI_URL` |

Sign in as anyone with `/api/auth/demo-login?as=tokyo-<name>&returnTo=/dm/<room>` (one browser
profile per person for the take).

## Shots

| # | on screen | do | say |
|---|---|---|---|
| 1 | Alex's room: the panel's shared treasury, the rules | — | "Five friends share a trip pot, kept by the room's agent under rules they wrote. Now they want part of it to go into ETH every week." |
| 2 | the chat | Alex: `@agent buy $20 of ETH every week for 12 weeks` → one line and the card | "The agent turns that into one standing request. Our rules say three verified humans must approve investing — the card says exactly what they approve: $20 a week, 12 weeks, 0.1 USDC into WETH on Uniswap, on Base." |
| 3 | Chris's, Dana's, Eli's laptops | each: the card's **Approve with World ID** → the confirmation page → World ID → back ("approved with World ID — 1 of 3 · fresh check at …"); cut after the first | "Every approval is a fresh World ID check: three different humans, present now. No one of us can switch it on alone." |
| 4 | the chat | after the third: "📌 Recurring buy adopted …" | "Adopted. It's an authority, not a payment — nothing has moved yet." |
| 5 | the chat, then basescan | Alex: `@agent buy this week's ETH` → "📈 Bought this week's ETH … Uniswap v3 on Base" → open the tx | "Inside that authority the agent buys: a quote from Uniswap's QuoterV2, an approval for exactly this amount, the swap through SwapRouter02 on Base — from its own wallet." |
| 6 | the chat | Alex again: `@agent buy this week's ETH` → "Already bought this week" | "Once a week, never more — asking twice doesn't buy twice." |
| 7 | **Open treasury** → Wallet | the agent's wallet, Ethereum Sepolia and Base holdings, the swap in Transactions (expand it) | "The Treasury page is the agent's wallet in plain sight: what it holds on each chain, every swap with what went in and what came out." |
| 8 | the Treasurer tab | "How is our recurring buy going?" → answer + card; "Stop it." → stopped | "The treasurer explains, proposes and stops — money only moves inside what humans approved. Anyone can stop it, no vote needed." |
| 9 | `uniswap/README.md`, "In the app" | scroll the table | "Every Uniswap call is linked with its file and line — and what we hit along the way is in FEEDBACK.md." |

Budget on the demo server: one real buy per take (0.1 USDC at the demo scale, gas on Base is
negligible); the room's agent wallet holds the USDC for several takes. After the take, stop the
recurring buy so the room is left quiet for the World track's recording.

## Fallback — the package page (no app)

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
