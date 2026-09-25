# Aqua Swap Journal (ETHGlobal Tokyo 2026 — 1inch Continuity)

Ships a self-custodial **XYC AMM strategy on the official 1inch Aqua registry**
and swaps through the **official SwapVM router**, on a Base mainnet fork.
Every fill is journaled into the Notion-style workspace (Swap Journal DB +
aindrive trade records) by `journal-watcher.js` — trade in your wallet,
remember in your workspace.

Official deterministic deployments used (same address on every chain):

| Contract | Address |
|---|---|
| Aqua | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` |
| AquaSwapVM Router | `0x111111338c5091E8440b67B168bAe16a668AC0De` |

## Run

```bash
pnpm install
pnpm fork          # anvil fork of Base on :8546
pnpm ship          # maker approves Aqua + ships the USDC/WETH strategy
pnpm swap 100      # taker swaps 100 USDC → WETH through SwapVM
pnpm demo          # a short trading session (4 fills, both directions)
pnpm watch         # journal watcher → Swap Journal DB + aindrive records
```

Built during the hackathon (Continuity): everything in this directory.
Pre-existing: the Notion-style workspace, its dashboard widgets, aindrive/MCP.
