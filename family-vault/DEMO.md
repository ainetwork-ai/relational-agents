# Demo video script — Family Vault (3:00, human voiceover)

Record the voice live (ETHGlobal: no AI narration). Screen: terminal left,
workspace right. Rehearse the pipeline once; every scene is one command.

## Scene 1 — the promise (0:00–0:25)

Workspace: the 🔒 "Yuna's Time Capsule" page, sealed callout visible.

> "On Yuna's hundredth day her parents put a thousand dollars and a letter
> into a time capsule. The letter is sealed in their workspace. The money is
> sealed in a smart contract — their own contract. Nothing here is held by
> anyone else, and that's what 1inch Aqua makes possible."

## Scene 2 — deposit & the policy (0:25–1:00)

Terminal: `pnpm deploy` (already run), then `pnpm deposit`.

> "The vault ships its operating policy to the official Aqua registry. Look
> at the policy — it's four SwapVM instructions. Two of them we wrote:
> a time-capsule operator — market-making for everyone until maturity, then
> beneficiary-only — and a low-risk guard that caps every fill at five
> percent of the balance. Eighteen years of rules, in bytes."

Show: the ledger dashboard's first rows (Deposit ×2 with the memo, Policy).

## Scene 3 — eighteen years in forty seconds (1:00–1:40)

Terminal: `pnpm years`. Workspace: Vault Ledger dashboard.

> "Time-jump. Market flow fills against the vault — every fill pays it a
> little spread, and every fill lands in the family's ledger by itself.
> Watch the value line: 2026 to 2044, one thousand dollars quietly working.
> The funds never leave the vault's own wallet the entire time."

Point at: Spread earned counter going green, the 18-year line chart.

## Scene 4 — life happens (1:40–2:10)

Terminal: `pnpm exit request`, pause, `pnpm exit cancel`.

> "Real families need an escape hatch — an honest one. The parent requests
> an early exit: it's public, on-chain, and the capsule waits thirty days.
> They cancel. Both moments are now part of the family record. And if a
> token ever goes bad, the parent re-ships the policy instead — the
> principal never moves."

Show: the two red/yellow rows appearing on the ledger.

## Scene 5 — the opening (2:10–3:00)

Terminal: `pnpm open`. Workspace: the capsule page.

> "Yuna turns eighteen. She calls claim — one on-chain transaction moves
> principal plus eighteen years of spread to her wallet. And the same event
> that moves the money unlocks the page: her parents' letter, sealed since
> her hundredth day. The money and the message arrive together.
> Built on the official Aqua registry with a custom SwapVM — thank you."

Show: CapsuleOpened tx in terminal → inbox notification → 🎁 page with the
letter → child balances.
