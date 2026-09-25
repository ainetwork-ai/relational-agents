# Demo video script — Aqua Swap Journal (2:30, human voiceover)

One take per scene is fine; record the voice live (no AI narration — ETHGlobal
rule). Screen: left half terminal, right half the workspace in the browser.

## Scene 1 — the idea (0:00–0:20)

> "Traders remember prices, not reasons. This is a swap journal: every onchain
> fill through 1inch Aqua lands in my workspace by itself — and an agent
> reviews the session. Everything you'll see on the dashboard is plain data
> and view config on top of general product features."

Show: the empty-ish Swap Journal dashboard.

## Scene 2 — ship on official Aqua (0:20–0:50)

Terminal:

```bash
pnpm fork    # Base mainnet fork
pnpm ship
```

> "We ship a self-custodial XYC market-making strategy to the official Aqua
> registry — the deterministic 0x1111113 address — with ten thousand USDC and
> five WETH as virtual balances. The tokens stay in the maker's wallet."

Point at the strategy hash in the output.

## Scene 3 — trade + auto-journal (0:50–1:30)

Terminal: `pnpm watch` in one pane, `pnpm demo` in another.

> "A taker swaps through the official SwapVM router — four fills, both
> directions. Watch the right side: the watcher turns every Swapped event into
> a journal row — side, fill price, slippage against the recorded quote, gas,
> the tx link — and drops a markdown trade record into my aindrive folder,
> with an empty 'entry reason' slot that nags me to write why."

Show: rows appearing; open one trade-record .md; the candle chart and
buy/sell markers on the dashboard.

## Scene 4 — the review agent (1:30–2:05)

Terminal: `pnpm review`.

> "Now the agent reads the journal and the trade records, FIFO-matches my
> sells against open lots, and writes realized PnL back into the journal —
> the dashboard lights up green. It also writes a review page: session
> numbers, best and worst close, and the entry reasons I actually wrote."

Show: Realized PnL counter turning +$…, Daily PnL / tag bars filling,
the "Trade review" page.

## Scene 5 — why it's general (2:05–2:30)

Enter dashboard edit mode; change a counter's prefix, switch the chart to
line, flip the depth widget's axis.

> "None of this is a trading screen. Counters, candles, depth — they're
> workspace widgets anyone can point at any database. The trading dashboard
> is just data. Built on the official Aqua and SwapVM contracts — thanks!"
