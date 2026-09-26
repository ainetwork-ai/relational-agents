# Scenario vs implementation (2026-09-26, xyz `c4f71ee`)

Problem statement: **Shared money comes with an agreement. The wallet doesn't know it.**

Three things are kept apart here: ① what is implemented, ② what the scenario uses (the script
`DEMO.md` S0–S6 and the concept doc `world_scenario.md`), ③ the gaps between them. Changes are
listed only in the last section, as proposals; this document changes neither the script nor the code.

## 1. Implemented

| # | Feature | Where | When |
|---|---|---|---|
| I1 | Relation-room agent and its memory doc (OKF folder, readable and editable as pages) | `lib/agent/`, `okf-store.ts` | before (July) |
| I2 | Treasury Rules parser and evaluator: amount bands, kinds (expense / investment / withdrawal / any), quorum, "not allowed", "30% at once" | `lib/agent/treasury/policy.ts` | new |
| I3 | Adoption (ratify): a doc edit is a proposal; `@agent adopt` puts it to a vote at the strictest bar the rules name; only the adopted version is enforced | `approvals.ts`, `memory.ts` | new |
| I4 | Agent wallet (Sepolia), balance, transfer (`transferUsd`), Etherscan link, 24 h expiry, re-check right before execution | `wallet.ts`, `approvals.ts` | new (the AgentKit wrapper existed) |
| I5 | Chat commands: `pay $X to <payee>`, `send $X to my wallet`, `invest $X of the idle funds`, status, adopt | `skill.ts` | new |
| I6 | Expenses under $50 execute without approval (hourly cap `TREASURY_AUTO_PER_HOUR`) | `approvals.ts` | new |
| I7 | Votes: IDKit World ID 4.0 Proof of Human, action `treasury-seat`, a (human, room) unique index → one human, one vote | `worldid-v4.ts`, `seat-button.tsx`, `treasury_seats` | new (the 3.0 consent banner existed) |
| I8 | Approvals: World ID for Agents IdP step-up (`max_age=0`, `prompt=login`), a confirmation page (amount, payee, address, rule, count so far), quorum by pairwise `sub`, `auth_time` after the request | `auth/world.ts`, `api/auth/world/*`, `approvals.ts` | new |
| I9 | Denied paths: a request the rules forbid is refused without a vote; a second account of the same human is voided; no vote, a stale proof, a cancel, an outsider count for nothing | e2e 8/8 | new |
| I10 | Investment (`investment` kind): with `TREASURY_INVEST=uniswap-base`, an approved investment is a **Uniswap v3 swap on Base, USDC → WETH, from the agent's own wallet**; the WETH stays with the agent; the status carries the position priced through the same pool and the panel shows it beside the pot. Demo scale: $200 in the story = 1 USDC. Without the setting, a transfer to the "Savings" payee | `invest.ts`, `approvals.ts`, `treasury-panel.tsx` | new (09-26) |
| I11 | Personal-wallet transfers: refused outright when a rule says "not allowed" | `policy.ts` | new |
| I12 | Treasury Activity written by the agent (payments, refusals, approvers, investments) | `memory.ts` | new |
| I13 | After an approved payment the agent points at idle funds (a quarter of what is left, in $50 steps, ≥ $100), citing the investment rule; it starts nothing itself | `approvals.ts` `proposeIdleFunds` | new (09-26) |
| I14 | Demo: seed (`seed-tokyo-trip.mts`, with the `Savings (idle funds)` payee = the agent's wallet), sign-in links `?as=&returnTo=`, e2e, mock IdP | `scripts/`, `e2e/` | new |
| I15 | AINDrive: aindrive sign-in and drive links; the agent reads the family's shared folders (recipes, recordings, photos), file URLs | `aindrive.ts`, `family-skills.ts` | before / Sep |
| I16 | x402: gifts — v2 exact scheme, EIP-3009 USDC (Base Sepolia), a provider layer (family ledger, aindrive), a 1 USDC MetaMask gift | `lib/x402/*`, `gift.ts` | Sep (separate from the treasury) |
| I17 | Family Vault (a time capsule that pays interest), demo | README §Family Vault | existing demo |
| I18 | Uniswap Family Passbook: USDC → WETH tsumitate inside a signed mandate (EIP-712), a passbook JSON, `/learn` | `uniswap/` | parallel track, **Base mainnet, its own wallet, not wired to the app** |

## 2. What the scenario uses

### 2a. The script [`DEMO.md`](DEMO.md) S0–S6

| Scene | Uses | State |
|---|---|---|
| S0 The problem | room, panel | ✔ |
| S1 The relation and the first vote | I1 memory doc, I2 rules, I7 vote | ✔ |
| S2 The second account | I7 one human, one vote | ✔ |
| S3 The hotel deposit, $180 | I5, I2 (2), I8 confirmation page and step-up, I4 transfer, I12 activity | ✔ measured (confirmation click to room 4.8 s) |
| S4 Same human, two accounts | I8 pairwise sub, I9 voided | ✔ |
| S5 "$500 to my wallet" | I11, I2 (30%) | ✔ |
| S3½ Idle funds at work | I13 hint, I5 `invest`, I2 (3), I8 ×3, I10 swap, I12 | ✔ measured (swap tx `0x9af1…`) |
| S5½ The upgrade | I5, I2 (2), I8 ×2, I4 | ✔ path; scene not yet rehearsed |
| S6 The record | I12 | ✔ |

The script uses only what is implemented. AINDrive and x402 are not in the script (see §4).

### 2b. The concept doc `world_scenario.md`

| Beat in the concept | Implemented | Note |
|---|---|---|
| Creating the relation (room, agent, rules doc) | ✔ | room, agent and doc in the UI; funding by script |
| Five members verify with World | ✔ (I7) | each member claims a vote; not "all at creation" |
| Rules: small auto / medium 2 / large 3 / personal | ✔ (I2, I6, I11) | amounts in dollars |
| Monthly automatic contributions | ✘ | not implemented |
| Investing idle funds, 3 approvals | ✔ (I10) | a real Uniswap v3 swap on Base since 09-26; demo scale $200 = 1 USDC |
| The agent proposes the investment first | ✔ (I13) | after an approved payment, citing the rule; a member still makes the request |
| Uniswap on-chain execution | ✔ app (I10) / ✔ package (I18) | two wallets, two chains: the pot is Sepolia, the swap is Base |
| "The pot grew" | △ | the panel prices the WETH through the pool now; whether it is up is the market's doing — never claimed |
| A better hotel | △ | the payment path (I4, I8) covers a `pay the hotel upgrade` request; no scene yet |
| A member takes it all → 4 approvals | ✔ stricter | personal wallets are not allowed at all; over 30% needs 4 |
| The agent grants AINDrive folder access after a World check | ✘ | reading and sharing exist (I15); no grant command, no World gate |
| Paying for resources with x402 | △ (I16) | gifts only; not connected to the treasury |

## 3. Gaps, in short

1. **Monthly contributions**: not implemented.
2. **AINDrive permissions and x402** under the treasury's rules: not implemented; the family demo has reading, sharing and gifts.
3. **"The pot grew"**: shown as the live price of the WETH; not something the demo can promise.
4. **The hotel upgrade**: the feature exists; the script has no scene.
5. **The IdP sandbox**: fake identities, no phone; a fresh proof is simulated (one fake human per browser).

## 4. Proposals (not applied)

| # | Proposal | Needs | Time | Risk |
|---|---|---|---|---|
| P1 | ~~Add S3½~~ — done 2026-09-26 (script + storyboard) | — | — | — |
| P2 | ~~Add S5½~~ — in the script; rehearse once on xyz | rehearsal | 15 m | a real Sepolia transfer |
| P3 | One closing line for x402 and AINDrive ("the same agent, the same rules, for files and paid resources") | script only | 5 m | none |
| P4 | An AINDrive access-grant scene gated by World | a command, a World gate, the aindrive permission API | half a day+ | new code |
| P5 | Monthly contributions | new code | — | not before the deadline |
| P6 | A hold switch for the xyz auto-deploy during rehearsal and recording (`~/.autodeploy/ainmem-xyz.hold` → skip) | 2 lines in `autodeploy.sh` (another session's file) | 5 m | a merge during a take swaps the container mid-hop |
