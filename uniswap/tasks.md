# Family Passbook — Implementation Plan (slice 1: back end on a Base fork)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A script that, given a signed spend mandate, buys WETH with USDC through Uniswap v3 on a
local Base fork exactly once per period and writes every buy or refusal to a passbook file.

**Architecture:** Four layers behind one CLI, each usable without the layer in front of it:
`swap/router` (Uniswap v3 `QuoterV2` + `SwapRouter02` over any RPC) → `mandate` (pure: typed data,
signature recovery, `check`) → `ledger/file` (JSON passbook) → `tsumitate` (one idempotent run).
Chain facts live only in `chains/<name>.js`. The Trading API provider, the workspace ledger and any UI
are slice 2 and plug into the same interfaces.

**Tech Stack:** Node 24 (ESM, `node:test`), pnpm, `viem` ^2.55, Foundry `anvil` (Base mainnet fork).

**Spec:** `uniswap/plan.md`

## Global Constraints

- Repo rules (`CLAUDE.md`): stage files one by one with `git add <path>` — never `-a`/`-A`; no
  Postgres schema changes in this slice; the app is not needed for this slice.
- `uniswap/` is a standalone package (own `package.json`), like the other bounty folders.
- Amounts are `bigint` in the token's base units everywhere in code; serialized as decimal strings.
- Nothing outside `src/chains/` may contain a contract or token address.
- Period keys come from the mandate's cadence (`week` → ISO week), never from the UTC day.
- The fork runs on port **8547** (`aqua/` uses 8546). `anvil` lives in `~/.foundry/bin`.
- Commit after every task; the hackathon judges commit history.

---

## File structure

```
uniswap/
  package.json            scripts: fork · fund · buy · tsumitate · test
  .gitignore              .state/ node_modules/
  src/chains/base.js      Base facts: RPC, tokens, Uniswap addresses, fee tier, viem chain
  src/chains/index.js     chainByName(name)
  src/swap/abi.js         minimal ABIs: QuoterV2, SwapRouter02, WETH9 (+ viem's erc20Abi)
  src/swap/router.js      routerProvider(chain) → { quote, execute }
  src/swap/index.js       swapProvider(name, chain)
  src/fork.js             anvil cheats: giveEth(client, address, eth)
  src/mandate/period.js   periodKey(period, date)
  src/mandate/typedData.js mandateTypedData(m, chainId)
  src/mandate/verify.js   recoverMandateSigner(m, chainId, signature)
  src/mandate/check.js    checkMandate(m, view, intent, now)
  src/mandate/index.js    re-exports
  src/ledger/file.js      fileLedger(path) → { view, record, addMandate, revoke }
  src/ledger/index.js     ledgerByName(name, opts)
  src/tsumitate.js        runOnce({ ledger, swap, account, chain, now, mandateId? })
  src/cli/fund.js         fork only: ETH → WETH → USDC into the agent wallet
  src/cli/buy.js          one direct buy (no mandate) — proves the swap layer
  src/cli/tsumitate.js    the real entrypoint: mandate-gated run, JSON to stdout
  test/*.test.js          node:test
```

---

### Task 1: Package + chain template + quote on the fork

**Files:**
- Create: `uniswap/package.json`, `uniswap/.gitignore`, `uniswap/src/chains/base.js`,
  `uniswap/src/chains/index.js`, `uniswap/src/swap/abi.js`, `uniswap/src/swap/router.js`,
  `uniswap/src/swap/index.js`
- Test: `uniswap/test/router.quote.test.js`

**Interfaces:**
- Produces: `chainByName("base") → Chain`, where
  `Chain = { chainId, name, rpc, viemChain, tokens: { USDC: {address, decimals}, WETH: {...} }, uniswap: { quoterV2, swapRouter02, v3FeeTier }, explorerTx(hash) }`
- Produces: `swapProvider("router", chain) → { quote(intent), execute(quote, account) }` with
  `intent = { chainId, tokenIn, tokenOut, amountIn: bigint, recipient, slippageBps }`,
  `quote = { provider: "router", amountIn, amountOutExpected: bigint, route, raw }`

- [ ] **Step 1: Scaffold the package**

`uniswap/package.json`:
```json
{
  "name": "@relational-agents/family-passbook",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "Family Passbook: a relationship-owned wallet that tsumitate-buys through Uniswap inside a signed mandate and writes every buy to the family's passbook (ETHGlobal Tokyo 2026, Continuity).",
  "scripts": {
    "fork": "anvil --fork-url ${BASE_RPC:-https://mainnet.base.org} --chain-id 8453 --port 8547 --silent",
    "fund": "node src/cli/fund.js",
    "buy": "node src/cli/buy.js",
    "tsumitate": "node src/cli/tsumitate.js",
    "test": "node --test"
  },
  "dependencies": {
    "viem": "^2.55.8"
  }
}
```

`uniswap/.gitignore`:
```
.state/
node_modules/
```

Run: `cd uniswap && pnpm install`
Expected: `node_modules/viem` exists, `pnpm-lock.yaml` created (commit it).

- [ ] **Step 2: Write the chain template**

`uniswap/src/chains/base.js`:
```js
// Every address this package knows about lives here. Verified against
// developers.uniswap.org/docs/protocols/v3/deployments (Base mainnet column) on 2026-09-25.
import { base as viemBase } from "viem/chains";

const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8547";

export const base = {
  chainId: 8453,
  name: "base",
  rpc,
  viemChain: { ...viemBase, rpcUrls: { default: { http: [rpc] } } },
  tokens: {
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  },
  uniswap: {
    quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    swapRouter02: "0x2626664c2603336E57B271c5C0b26F421741e481",
    v3FeeTier: 500, // the USDC/WETH 0.05% pool — the quote spike on 2026-09-25 crossed it
  },
  explorerTx: (hash) => `https://basescan.org/tx/${hash}`,
};
```

`uniswap/src/chains/index.js`:
```js
import { base } from "./base.js";

const chains = { base };

/** The one place a chain name becomes addresses. Throws on an unknown name. */
export function chainByName(name = process.env.CHAIN ?? "base") {
  const chain = chains[name];
  if (!chain) throw new Error(`unknown chain "${name}" — known: ${Object.keys(chains).join(", ")}`);
  return chain;
}
```

- [ ] **Step 3: Write the ABIs**

`uniswap/src/swap/abi.js`:
```js
// Only the functions we call. Full ABIs: @uniswap/v3-periphery (QuoterV2),
// @uniswap/swap-router-contracts (SwapRouter02).
export const quoterV2Abi = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable", // eth_call still works — QuoterV2 reverts internally to return data
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
];

export const swapRouter02Abi = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
];

export const weth9Abi = [
  { name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] },
];
```

- [ ] **Step 4: Write the failing quote test**

`uniswap/test/router.quote.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { chainByName } from "../src/chains/index.js";
import { swapProvider } from "../src/swap/index.js";

// Integration: needs `pnpm fork` running on 8547. Skips (does not fail) when it is not.
async function forkUp(rpc) {
  try {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return r.ok;
  } catch { return false; }
}

test("router.quote: 20 USDC → WETH on the Base fork returns a positive amount", async (t) => {
  const chain = chainByName("base");
  if (!(await forkUp(chain.rpc))) return t.skip("fork not running");
  const swap = swapProvider("router", chain);
  const q = await swap.quote({
    chainId: chain.chainId,
    tokenIn: chain.tokens.USDC.address,
    tokenOut: chain.tokens.WETH.address,
    amountIn: 20_000_000n,
    recipient: "0x0000000000000000000000000000000000000001",
    slippageBps: 50,
  });
  assert.equal(q.provider, "router");
  assert.equal(q.amountIn, 20_000_000n);
  assert.ok(q.amountOutExpected > 0n, "expected some WETH");
  assert.ok(q.amountOutExpected < 10n ** 18n, "20 USDC is less than 1 ETH");
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd uniswap && export PATH="$HOME/.foundry/bin:$PATH" && (pnpm fork &) && sleep 8 && node --test test/router.quote.test.js`
Expected: FAIL — `Cannot find module '../src/swap/index.js'`

- [ ] **Step 6: Implement the router provider (quote only)**

`uniswap/src/swap/router.js`:
```js
import { createPublicClient, createWalletClient, http, erc20Abi } from "viem";
import { quoterV2Abi, swapRouter02Abi } from "./abi.js";

/**
 * Uniswap v3 through the periphery contracts, over any RPC the chain template names.
 * quote → QuoterV2 (eth_call, no state). execute → ERC-20 approve + SwapRouter02.exactInputSingle.
 */
export function routerProvider(chain) {
  const pub = createPublicClient({ chain: chain.viemChain, transport: http(chain.rpc) });
  const { quoterV2, swapRouter02, v3FeeTier } = chain.uniswap;

  async function quote(intent) {
    const { result } = await pub.simulateContract({
      address: quoterV2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: intent.tokenIn, tokenOut: intent.tokenOut, amountIn: intent.amountIn,
               fee: v3FeeTier, sqrtPriceLimitX96: 0n }],
    });
    const [amountOut, , ticksCrossed, gasEstimate] = result;
    return {
      provider: "router",
      amountIn: intent.amountIn,
      amountOutExpected: amountOut,
      route: `v3 ${v3FeeTier / 10_000}% single hop`,
      raw: { ticksCrossed: Number(ticksCrossed), gasEstimate },
      intent,
    };
  }

  async function execute(quote, account) {
    throw new Error("execute: not implemented yet (Task 2)");
  }

  return { quote, execute, pub };
}
```

`uniswap/src/swap/index.js`:
```js
import { routerProvider } from "./router.js";

const providers = { router: routerProvider };

/** `SWAP_PROVIDER` picks the implementation; every one returns { quote, execute }. */
export function swapProvider(name = process.env.SWAP_PROVIDER ?? "router", chain) {
  const make = providers[name];
  if (!make) throw new Error(`unknown swap provider "${name}" — known: ${Object.keys(providers).join(", ")}`);
  return make(chain);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd uniswap && node --test test/router.quote.test.js`
Expected: PASS (1 test). If it reports `skip`, the fork is not up — start it and rerun.

- [ ] **Step 8: Commit**

```bash
git add uniswap/package.json uniswap/pnpm-lock.yaml uniswap/.gitignore \
        uniswap/src/chains/base.js uniswap/src/chains/index.js \
        uniswap/src/swap/abi.js uniswap/src/swap/router.js uniswap/src/swap/index.js \
        uniswap/test/router.quote.test.js
git commit -m "uniswap: chain template and a v3 quote on a Base fork"
```

---

### Task 2: execute — approve + exactInputSingle, proven by funding the agent (ETH → WETH → USDC)

**Files:**
- Modify: `uniswap/src/swap/router.js` (replace the `execute` stub)
- Create: `uniswap/src/fork.js`, `uniswap/src/cli/fund.js`
- Test: `uniswap/test/router.execute.test.js`

**Interfaces:**
- Consumes: `routerProvider(chain)` from Task 1.
- Produces: `execute(quote, account) → receipt`, where
  `receipt = { txHash, amountIn: bigint, amountOut: bigint, price: number, route, provider: "router" }`
  and `price` = tokenIn per whole tokenOut (e.g. USDC per ETH) using the chain's decimals.
- Produces: `giveEth(pub, address, wholeEth: string)` (fork only) and the `pnpm fund` script that
  leaves the agent wallet holding USDC.

- [ ] **Step 1: Write the failing execute test**

`uniswap/test/router.execute.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, parseEther } from "viem";
import { chainByName } from "../src/chains/index.js";
import { swapProvider } from "../src/swap/index.js";
import { giveEth, wrapEth } from "../src/fork.js";

const ANVIL_KEY_9 = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6"; // anvil #9

async function forkUp(rpc) {
  try { const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }); return r.ok; }
  catch { return false; }
}

test("router.execute: WETH → USDC on the fork moves the balances it says it moved", async (t) => {
  const chain = chainByName("base");
  if (!(await forkUp(chain.rpc))) return t.skip("fork not running");
  const account = privateKeyToAccount(ANVIL_KEY_9);
  const swap = swapProvider("router", chain);
  await giveEth(swap.pub, account.address, "5");
  await wrapEth(chain, account, parseEther("1"));

  const USDC = chain.tokens.USDC.address, WETH = chain.tokens.WETH.address;
  const before = await swap.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const q = await swap.quote({ chainId: chain.chainId, tokenIn: WETH, tokenOut: USDC,
    amountIn: parseEther("0.5"), recipient: account.address, slippageBps: 50 });
  const r = await swap.execute(q, account);
  const after = await swap.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });

  assert.match(r.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(r.amountIn, parseEther("0.5"));
  assert.equal(after - before, r.amountOut, "receipt amountOut must equal the balance change");
  assert.ok(r.amountOut >= q.amountOutExpected * 9950n / 10000n, "within 0.5% of the quote");
  assert.ok(r.price > 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd uniswap && node --test test/router.execute.test.js`
Expected: FAIL — `Cannot find module '../src/fork.js'`

- [ ] **Step 3: Write the fork helpers**

`uniswap/src/fork.js`:
```js
import { createWalletClient, http, toHex, parseEther } from "viem";
import { weth9Abi } from "./swap/abi.js";

/** anvil only: set a native balance. `wholeEth` is a decimal string like "5". */
export async function giveEth(pub, address, wholeEth) {
  await pub.request({ method: "anvil_setBalance", params: [address, toHex(parseEther(wholeEth))] });
}

/** Wrap native ETH into WETH from `account` (works on any chain; on the fork it follows giveEth). */
export async function wrapEth(chain, account, amountWei) {
  const wallet = createWalletClient({ account, chain: chain.viemChain, transport: http(chain.rpc) });
  const hash = await wallet.writeContract({ address: chain.tokens.WETH.address, abi: weth9Abi,
    functionName: "deposit", value: amountWei });
  const { createPublicClient } = await import("viem");
  const pub = createPublicClient({ chain: chain.viemChain, transport: http(chain.rpc) });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
```

- [ ] **Step 4: Implement execute**

Replace the `execute` stub in `uniswap/src/swap/router.js` with:
```js
  async function execute(quote, account) {
    const { intent } = quote;
    const wallet = createWalletClient({ account, chain: chain.viemChain, transport: http(chain.rpc) });
    const decimalsOf = (addr) =>
      Object.values(chain.tokens).find((t) => t.address.toLowerCase() === addr.toLowerCase())?.decimals ?? 18;

    // 1. allowance for the router — a plain ERC-20 approval, exactly the amount of this buy
    const approveHash = await wallet.writeContract({ address: intent.tokenIn, abi: erc20Abi,
      functionName: "approve", args: [swapRouter02, intent.amountIn] });
    await pub.waitForTransactionReceipt({ hash: approveHash });

    // 2. the swap; slippage is enforced by the router through amountOutMinimum
    const amountOutMinimum = quote.amountOutExpected * BigInt(10_000 - intent.slippageBps) / 10_000n;
    const before = await pub.readContract({ address: intent.tokenOut, abi: erc20Abi,
      functionName: "balanceOf", args: [intent.recipient] });
    const txHash = await wallet.writeContract({ address: swapRouter02, abi: swapRouter02Abi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: intent.tokenIn, tokenOut: intent.tokenOut, fee: v3FeeTier,
               recipient: intent.recipient, amountIn: intent.amountIn, amountOutMinimum,
               sqrtPriceLimitX96: 0n }] });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error(`swap reverted: ${txHash}`);
    const after = await pub.readContract({ address: intent.tokenOut, abi: erc20Abi,
      functionName: "balanceOf", args: [intent.recipient] });

    // 3. what actually moved — read from balances, not from the quote
    const amountOut = after - before;
    const inWhole = Number(intent.amountIn) / 10 ** decimalsOf(intent.tokenIn);
    const outWhole = Number(amountOut) / 10 ** decimalsOf(intent.tokenOut);
    return { txHash, amountIn: intent.amountIn, amountOut, price: inWhole / outWhole,
             route: quote.route, provider: "router" };
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd uniswap && node --test test/router.execute.test.js`
Expected: PASS. (Each run spends from anvil account #9 on the fork; restarting the fork resets it.)

- [ ] **Step 6: Write the fund script**

`uniswap/src/cli/fund.js`:
```js
// Fork only. Gives the agent wallet gas, wraps 1 ETH and swaps it to USDC through Uniswap, so the
// family "has deposited" USDC without guessing a whale to impersonate.
import { privateKeyToAccount } from "viem/accounts";
import { parseEther, erc20Abi } from "viem";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";
import { giveEth, wrapEth } from "../fork.js";

const key = process.env.AGENT_PK;
if (!key) { console.error("AGENT_PK is required (an anvil key is fine on the fork)"); process.exit(2); }
const chain = chainByName();
const account = privateKeyToAccount(key);
const swap = swapProvider("router", chain);

await giveEth(swap.pub, account.address, "10");
await wrapEth(chain, account, parseEther("1"));
const q = await swap.quote({ chainId: chain.chainId, tokenIn: chain.tokens.WETH.address,
  tokenOut: chain.tokens.USDC.address, amountIn: parseEther("1"), recipient: account.address, slippageBps: 50 });
const r = await swap.execute(q, account);
const usdc = await swap.pub.readContract({ address: chain.tokens.USDC.address, abi: erc20Abi,
  functionName: "balanceOf", args: [account.address] });
console.log(JSON.stringify({ agent: account.address, funded: { eth: "9 (after wrap)", usdc: usdc.toString() },
  tx: r.txHash, price: r.price }, null, 2));
```

Run: `cd uniswap && AGENT_PK=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6 pnpm fund`
Expected: JSON with `usdc` in the thousands (6-decimal units), a tx hash, a price near the market.

- [ ] **Step 7: Commit**

```bash
git add uniswap/src/swap/router.js uniswap/src/fork.js uniswap/src/cli/fund.js uniswap/test/router.execute.test.js
git commit -m "uniswap: execute a v3 swap through SwapRouter02; fund the agent on the fork"
```

---

### Task 3: A direct buy script (USDC → WETH) — the swap layer complete

**Files:**
- Create: `uniswap/src/cli/buy.js`

**Interfaces:**
- Consumes: `swapProvider`, `chainByName`.
- Produces: `pnpm buy <usdc>` printing the receipt JSON — used to demo the layer alone.

- [ ] **Step 1: Write the script**

`uniswap/src/cli/buy.js`:
```js
// One buy, no mandate — the swap layer on its own. Usage: AGENT_PK=0x… pnpm buy 20
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";

const key = process.env.AGENT_PK;
if (!key) { console.error("AGENT_PK is required"); process.exit(2); }
const usdc = process.argv[2] ?? "20";
const chain = chainByName();
const account = privateKeyToAccount(key);
const swap = swapProvider(undefined, chain);
const amountIn = BigInt(Math.round(Number(usdc) * 10 ** chain.tokens.USDC.decimals));

const q = await swap.quote({ chainId: chain.chainId, tokenIn: chain.tokens.USDC.address,
  tokenOut: chain.tokens.WETH.address, amountIn, recipient: account.address, slippageBps: 50 });
const r = await swap.execute(q, account);
console.log(JSON.stringify({ ...r, amountIn: r.amountIn.toString(), amountOut: r.amountOut.toString(),
  explorer: chain.explorerTx(r.txHash) }, null, 2));
```

- [ ] **Step 2: Run it**

Run: `cd uniswap && AGENT_PK=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6 pnpm buy 20`
Expected: JSON with `amountIn: "20000000"`, `amountOut` around `7300000000000000`, `price` near 2,700.

- [ ] **Step 3: Commit**

```bash
git add uniswap/src/cli/buy.js
git commit -m "uniswap: a direct USDC→WETH buy script"
```

---

### Task 4: Period keys

**Files:**
- Create: `uniswap/src/mandate/period.js`
- Test: `uniswap/test/period.test.js`

**Interfaces:**
- Produces: `periodKey(period: "day" | "week" | "month", date: Date) → string`
  (`"2026-09-25"`, `"2026-W39"`, `"2026-09"`).

- [ ] **Step 1: Write the failing test**

`uniswap/test/period.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { periodKey } from "../src/mandate/period.js";

const d = (s) => new Date(s + "T12:00:00Z");

test("week: ISO week, Monday-first", () => {
  assert.equal(periodKey("week", d("2026-09-25")), "2026-W39"); // Friday
  assert.equal(periodKey("week", d("2026-09-27")), "2026-W39"); // Sunday, same week
  assert.equal(periodKey("week", d("2026-09-28")), "2026-W40"); // Monday, next week
  assert.equal(periodKey("week", d("2025-12-29")), "2026-W01"); // ISO year rolls early
});

test("day and month keys", () => {
  assert.equal(periodKey("day", d("2026-09-25")), "2026-09-25");
  assert.equal(periodKey("month", d("2026-09-25")), "2026-09");
});

test("unknown period throws", () => {
  assert.throws(() => periodKey("fortnight", d("2026-09-25")), /unknown period/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd uniswap && node --test test/period.test.js`
Expected: FAIL — cannot find `../src/mandate/period.js`

- [ ] **Step 3: Implement**

`uniswap/src/mandate/period.js`:
```js
/**
 * The idempotency key of a run. Derived from the mandate's cadence, never from the UTC day:
 * a weekly mandate keyed on days would buy every day (the dca-bot skill documents this bug).
 */
export function periodKey(period, date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (period === "day") return d.toISOString().slice(0, 10);
  if (period === "month") return d.toISOString().slice(0, 7);
  if (period === "week") {
    const isoDay = d.getUTCDay() || 7;           // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - isoDay);   // the Thursday of this ISO week fixes the ISO year
    const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  throw new Error(`unknown period "${period}"`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd uniswap && node --test test/period.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add uniswap/src/mandate/period.js uniswap/test/period.test.js
git commit -m "uniswap: period keys from the mandate cadence (ISO week)"
```

---

### Task 5: Mandate typed data + signature recovery

**Files:**
- Create: `uniswap/src/mandate/typedData.js`, `uniswap/src/mandate/verify.js`
- Test: `uniswap/test/mandate.sign.test.js`

**Interfaces:**
- Produces: `mandateTypedData(m, chainId) → { domain, types, primaryType: "SpendMandate", message }`
  (a viem `signTypedData` argument).
- Produces: `recoverMandateSigner(m, chainId, signature) → Promise<address>`.
- The `Mandate` shape used from here on:
  ```
  { id: string, roomId: string, agent: address, kind: "standing" | "oneoff",
    tokenIn: address, tokenOut: address, perRunCap: bigint, perPeriodCap: bigint,
    period: "day" | "week" | "month", expiresAt: number (unix seconds), nonce: number,
    revokedAt?: number,
    approval?: { method: string, subject: string, verifiedAt: number, ref: string } }
  ```

- [ ] **Step 1: Write the failing test**

`uniswap/test/mandate.sign.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { mandateTypedData } from "../src/mandate/typedData.js";
import { recoverMandateSigner } from "../src/mandate/verify.js";

const grandmother = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"); // anvil #6
const CHAIN_ID = 8453;

export const sampleMandate = () => ({
  id: "m-1", roomId: "room-tanaka", agent: "0x000000000000000000000000000000000000dEaD",
  kind: "standing",
  tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  tokenOut: "0x4200000000000000000000000000000000000006",
  perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week",
  expiresAt: 1798761600, nonce: 1,
});

test("a mandate signed by the grandmother recovers to her address", async () => {
  const m = sampleMandate();
  const signature = await grandmother.signTypedData(mandateTypedData(m, CHAIN_ID));
  assert.equal(await recoverMandateSigner(m, CHAIN_ID, signature), grandmother.address);
});

test("changing a cap after signing recovers a different address", async () => {
  const m = sampleMandate();
  const signature = await grandmother.signTypedData(mandateTypedData(m, CHAIN_ID));
  const tampered = { ...m, perRunCap: 50_000_000n };
  assert.notEqual(await recoverMandateSigner(tampered, CHAIN_ID, signature), grandmother.address);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd uniswap && node --test test/mandate.sign.test.js`
Expected: FAIL — cannot find `../src/mandate/typedData.js`

- [ ] **Step 3: Implement**

`uniswap/src/mandate/typedData.js`:
```js
/**
 * EIP-712 payload for a SpendMandate — the same mechanism the app uses for RelationConsent
 * (app/src/lib/relation-contract.ts). A member signs it in their wallet; the agent never can,
 * because it never holds a member's key.
 */
export const SPEND_MANDATE_TYPES = {
  SpendMandate: [
    { name: "id", type: "string" },
    { name: "roomId", type: "string" },
    { name: "agent", type: "address" },
    { name: "kind", type: "string" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "perRunCap", type: "uint256" },
    { name: "perPeriodCap", type: "uint256" },
    { name: "period", type: "string" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

export function mandateDomain(chainId) {
  return { name: "ainmem Family Passbook", version: "1", chainId };
}

export function mandateTypedData(m, chainId) {
  return {
    domain: mandateDomain(chainId),
    types: SPEND_MANDATE_TYPES,
    primaryType: "SpendMandate",
    message: {
      id: m.id, roomId: m.roomId, agent: m.agent, kind: m.kind,
      tokenIn: m.tokenIn, tokenOut: m.tokenOut,
      perRunCap: m.perRunCap, perPeriodCap: m.perPeriodCap, period: m.period,
      expiresAt: BigInt(m.expiresAt), nonce: BigInt(m.nonce),
    },
  };
}
```

`uniswap/src/mandate/verify.js`:
```js
import { recoverTypedDataAddress } from "viem";
import { mandateTypedData } from "./typedData.js";

/** Who signed this mandate. Membership is the caller's question; this only answers "who". */
export async function recoverMandateSigner(m, chainId, signature) {
  return recoverTypedDataAddress({ ...mandateTypedData(m, chainId), signature });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd uniswap && node --test test/mandate.sign.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add uniswap/src/mandate/typedData.js uniswap/src/mandate/verify.js uniswap/test/mandate.sign.test.js
git commit -m "uniswap: SpendMandate typed data and signer recovery"
```

---

### Task 6: `checkMandate` — the rule, in order

**Files:**
- Create: `uniswap/src/mandate/check.js`, `uniswap/src/mandate/index.js`
- Test: `uniswap/test/mandate.check.test.js`

**Interfaces:**
- Consumes: `periodKey` (Task 4).
- Produces: `checkMandate(m, view, intent, now: Date) → { ok: true, decisionOrigin, periodKey } | { ok: false, reason, periodKey }`
  with `view = { spentByPeriod: { [mandateId]: { [periodKey]: bigint } }, boughtPeriods: { [mandateId]: string[] } }`
  and `reason ∈ "revoked" | "expired" | "unapproved" | "pair-not-allowed" | "over-per-run-cap" | "over-per-period-cap" | "period-already-bought"`.

- [ ] **Step 1: Write the failing test**

`uniswap/test/mandate.check.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMandate } from "../src/mandate/check.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const now = new Date("2026-09-25T09:00:00Z");           // 2026-W39
const approved = { method: "wallet-signature", subject: "0xabc", verifiedAt: 1758700000, ref: "0xsig" };

const mandate = (over = {}) => ({
  id: "m-1", roomId: "r", agent: "0xagent", kind: "standing", tokenIn: USDC, tokenOut: WETH,
  perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week",
  expiresAt: 1798761600, nonce: 1, approval: approved, ...over,
});
const emptyView = () => ({ spentByPeriod: {}, boughtPeriods: {} });
const intent = (amountIn = 20_000_000n, over = {}) => ({ tokenIn: USDC, tokenOut: WETH, amountIn, ...over });

test("standing mandate inside every limit → ok, autonomous, keyed to the ISO week", () => {
  const r = checkMandate(mandate(), emptyView(), intent(), now);
  assert.deepEqual(r, { ok: true, decisionOrigin: "autonomous", periodKey: "2026-W39" });
});

test("one-off mandate → human_mediated", () => {
  const r = checkMandate(mandate({ kind: "oneoff" }), emptyView(), intent(), now);
  assert.equal(r.ok, true); assert.equal(r.decisionOrigin, "human_mediated");
});

test("refusals, in the documented order", () => {
  assert.equal(checkMandate(mandate({ revokedAt: 1 }), emptyView(), intent(), now).reason, "revoked");
  assert.equal(checkMandate(mandate({ expiresAt: 1 }), emptyView(), intent(), now).reason, "expired");
  assert.equal(checkMandate(mandate({ approval: undefined }), emptyView(), intent(), now).reason, "unapproved");
  assert.equal(checkMandate(mandate(), emptyView(), intent(20_000_000n, { tokenOut: USDC }), now).reason, "pair-not-allowed");
  assert.equal(checkMandate(mandate(), emptyView(), intent(50_000_000n), now).reason, "over-per-run-cap");
  const nearCap = { spentByPeriod: { "m-1": { "2026-W39": 90_000_000n } }, boughtPeriods: {} };
  assert.equal(checkMandate(mandate(), nearCap, intent(), now).reason, "over-per-period-cap");
  const bought = { spentByPeriod: {}, boughtPeriods: { "m-1": ["2026-W39"] } };
  assert.equal(checkMandate(mandate(), bought, intent(), now).reason, "period-already-bought");
});

test("a one-off mandate may run in a period that already had a standing buy", () => {
  const bought = { spentByPeriod: {}, boughtPeriods: { "m-1": ["2026-W39"] } };
  assert.equal(checkMandate(mandate({ kind: "oneoff" }), bought, intent(), now).ok, true);
});

test("a revoked mandate reports revoked even if also expired", () => {
  assert.equal(checkMandate(mandate({ revokedAt: 1, expiresAt: 1 }), emptyView(), intent(), now).reason, "revoked");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd uniswap && node --test test/mandate.check.test.js`
Expected: FAIL — cannot find `../src/mandate/check.js`

- [ ] **Step 3: Implement**

`uniswap/src/mandate/check.js`:
```js
import { periodKey } from "./period.js";

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * May the agent do `intent` under mandate `m` right now? Pure; the ledger supplies `view`.
 * Refusal order is part of the contract (the passbook shows the first reason that applies).
 */
export function checkMandate(m, view, intent, now) {
  const key = periodKey(m.period, now);
  const no = (reason) => ({ ok: false, reason, periodKey: key });
  const nowSec = Math.floor(now.getTime() / 1000);

  if (m.revokedAt) return no("revoked");
  if (nowSec >= m.expiresAt) return no("expired");
  if (!m.approval) return no("unapproved");
  if (!same(intent.tokenIn, m.tokenIn) || !same(intent.tokenOut, m.tokenOut)) return no("pair-not-allowed");
  if (intent.amountIn > m.perRunCap) return no("over-per-run-cap");
  const spent = view.spentByPeriod?.[m.id]?.[key] ?? 0n;
  if (spent + intent.amountIn > m.perPeriodCap) return no("over-per-period-cap");
  if (m.kind === "standing" && (view.boughtPeriods?.[m.id] ?? []).includes(key)) return no("period-already-bought");

  return { ok: true, decisionOrigin: m.kind === "standing" ? "autonomous" : "human_mediated", periodKey: key };
}
```

`uniswap/src/mandate/index.js`:
```js
export { periodKey } from "./period.js";
export { mandateTypedData, mandateDomain, SPEND_MANDATE_TYPES } from "./typedData.js";
export { recoverMandateSigner } from "./verify.js";
export { checkMandate } from "./check.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd uniswap && node --test test/mandate.check.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add uniswap/src/mandate/check.js uniswap/src/mandate/index.js uniswap/test/mandate.check.test.js
git commit -m "uniswap: checkMandate — the refusal order the passbook shows"
```

---

### Task 7: File ledger

**Files:**
- Create: `uniswap/src/ledger/file.js`, `uniswap/src/ledger/index.js`
- Test: `uniswap/test/ledger.file.test.js`

**Interfaces:**
- Produces: `fileLedger(path) → { view(), record(entry), addMandate(m), revoke(id, atSec), mandates() }`
  - `view() → { mandates: Mandate[], spentByPeriod, boughtPeriods }` (the `check` view plus the
    mandates themselves)
  - `entry = { at: ISO string, kind: "deposit" | "buy" | "skip", who: string, mandateId?: string,
    periodKey?: string, amountIn?: bigint, amountOut?: bigint, price?: number, txHash?: string,
    reason?: string, decisionOrigin?: string }`
- Produces: `ledgerByName("file", { path }) → Ledger`.
- Serialization: bigint fields (`perRunCap`, `perPeriodCap`, `amountIn`, `amountOut`) are decimal
  strings on disk and bigint in memory.

- [ ] **Step 1: Write the failing test**

`uniswap/test/ledger.file.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLedger } from "../src/ledger/file.js";

const fresh = () => fileLedger(join(mkdtempSync(join(tmpdir(), "passbook-")), "passbook.json"));
const m = { id: "m-1", roomId: "r", agent: "0xagent", kind: "standing", tokenIn: "0xa", tokenOut: "0xb",
  perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week", expiresAt: 1798761600, nonce: 1 };

test("empty ledger has an empty view", async () => {
  const l = fresh();
  assert.deepEqual(await l.view(), { mandates: [], spentByPeriod: {}, boughtPeriods: {} });
});

test("buys accumulate per mandate and period; skips and deposits do not", async () => {
  const l = fresh();
  await l.addMandate(m);
  await l.record({ at: "2026-09-25T09:00:00Z", kind: "buy", who: "0xagent", mandateId: "m-1",
    periodKey: "2026-W39", amountIn: 20_000_000n, amountOut: 7_300_000_000_000_000n, price: 2739.7, txHash: "0x1" });
  await l.record({ at: "2026-09-26T09:00:00Z", kind: "skip", who: "0xagent", mandateId: "m-1",
    periodKey: "2026-W39", reason: "period-already-bought" });
  await l.record({ at: "2026-09-26T10:00:00Z", kind: "deposit", who: "0xkenji", amountIn: 50_000_000n });
  const v = await l.view();
  assert.equal(v.mandates.length, 1);
  assert.equal(v.mandates[0].perRunCap, 20_000_000n, "bigint restored from disk");
  assert.deepEqual(v.spentByPeriod, { "m-1": { "2026-W39": 20_000_000n } });
  assert.deepEqual(v.boughtPeriods, { "m-1": ["2026-W39"] });
});

test("revoke stamps revokedAt; the file is plain JSON with string amounts", async () => {
  const l = fresh();
  await l.addMandate(m);
  await l.revoke("m-1", 1758800000);
  assert.equal((await l.view()).mandates[0].revokedAt, 1758800000);
  const raw = JSON.parse(readFileSync(l.path, "utf8"));
  assert.equal(raw.mandates[0].perRunCap, "20000000");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd uniswap && node --test test/ledger.file.test.js`
Expected: FAIL — cannot find `../src/ledger/file.js`

- [ ] **Step 3: Implement**

`uniswap/src/ledger/file.js`:
```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BIG = new Set(["perRunCap", "perPeriodCap", "amountIn", "amountOut"]);
const toDisk = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
const fromDisk = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, BIG.has(k) && typeof v === "string" ? BigInt(v) : v]));

/**
 * The passbook as one JSON file — enough to run the executor with no app at all.
 * The workspace ledger (slice 2) implements the same four calls against the app.
 */
export function fileLedger(path) {
  const load = () => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { mandates: [], entries: [] });
  const save = (db) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(db, null, 2)); };

  return {
    path,
    async mandates() { return load().mandates.map(fromDisk); },
    async addMandate(m) { const db = load(); db.mandates.push(toDisk(m)); save(db); },
    async revoke(id, atSec) {
      const db = load();
      const m = db.mandates.find((x) => x.id === id);
      if (!m) throw new Error(`no mandate ${id}`);
      m.revokedAt = atSec; save(db);
    },
    async record(entry) { const db = load(); db.entries.push(toDisk(entry)); save(db); },
    async view() {
      const db = load();
      const spentByPeriod = {}, boughtPeriods = {};
      for (const e of db.entries.map(fromDisk)) {
        if (e.kind !== "buy" || !e.mandateId) continue;
        (spentByPeriod[e.mandateId] ??= {})[e.periodKey] = (spentByPeriod[e.mandateId][e.periodKey] ?? 0n) + e.amountIn;
        const list = (boughtPeriods[e.mandateId] ??= []);
        if (!list.includes(e.periodKey)) list.push(e.periodKey);
      }
      return { mandates: db.mandates.map(fromDisk), spentByPeriod, boughtPeriods };
    },
  };
}
```

`uniswap/src/ledger/index.js`:
```js
import { fileLedger } from "./file.js";

/** `LEDGER` picks where the passbook lives. `file` needs nothing; `workspace` (slice 2) needs the app. */
export function ledgerByName(name = process.env.LEDGER ?? "file", opts = {}) {
  if (name === "file") return fileLedger(opts.path ?? process.env.PASSBOOK_PATH ?? new URL("../../.state/passbook.json", import.meta.url).pathname);
  throw new Error(`unknown ledger "${name}"`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd uniswap && node --test test/ledger.file.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add uniswap/src/ledger/file.js uniswap/src/ledger/index.js uniswap/test/ledger.file.test.js
git commit -m "uniswap: the passbook as a JSON file"
```

---

### Task 8: The executor — one idempotent run

**Files:**
- Create: `uniswap/src/tsumitate.js`
- Test: `uniswap/test/tsumitate.test.js`

**Interfaces:**
- Consumes: `checkMandate`, a `Ledger`, a `SwapProvider`, a viem `account`, a `Chain`.
- Produces: `runOnce({ ledger, swap, account, chain, now = new Date(), mandateId? }) → { outcome: "bought", receipt, periodKey } | { outcome: "skipped", reason, periodKey } | { outcome: "no-mandate" }`
  - picks `mandateId` if given, else the first mandate whose `agent` equals `account.address`
    (case-insensitive) and whose kind is `standing`.
  - the intent amount is the mandate's `perRunCap` (the fixed tsumitate amount).
  - records a `skip` entry with the reason, or a `buy` entry with the receipt.

- [ ] **Step 1: Write the failing test**

`uniswap/test/tsumitate.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLedger } from "../src/ledger/file.js";
import { runOnce } from "../src/tsumitate.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const agent = { address: "0x1111111111111111111111111111111111111111" };
const chain = { chainId: 8453, tokens: { USDC: { address: USDC, decimals: 6 }, WETH: { address: WETH, decimals: 18 } } };
const approved = { method: "wallet-signature", subject: "0xgrandmother", verifiedAt: 1, ref: "0xsig" };
const mandate = (over = {}) => ({ id: "m-1", roomId: "r", agent: agent.address, kind: "standing",
  tokenIn: USDC, tokenOut: WETH, perRunCap: 20_000_000n, perPeriodCap: 100_000_000n, period: "week",
  expiresAt: 1798761600, nonce: 1, approval: approved, ...over });

// A swap provider that never touches a chain: 1 USDC → 0.0004 WETH, always fills the quote.
const fakeSwap = () => {
  const calls = { quote: 0, execute: 0 };
  return { calls,
    quote: async (i) => { calls.quote++; return { provider: "fake", amountIn: i.amountIn, amountOutExpected: i.amountIn * 400_000_000n, route: "fake", raw: null, intent: i }; },
    execute: async (q) => { calls.execute++; return { txHash: "0x" + "ab".repeat(32), amountIn: q.amountIn, amountOut: q.amountOutExpected, price: 2500, route: "fake", provider: "fake" }; } };
};
const fresh = () => fileLedger(join(mkdtempSync(join(tmpdir(), "tsumitate-")), "passbook.json"));
const friday = new Date("2026-09-25T09:00:00Z"), saturday = new Date("2026-09-26T09:00:00Z"), nextMonday = new Date("2026-09-28T09:00:00Z");

test("first run of the week buys the per-run amount and records it", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate()); const swap = fakeSwap();
  const r = await runOnce({ ledger, swap, account: agent, chain, now: friday });
  assert.equal(r.outcome, "bought"); assert.equal(r.periodKey, "2026-W39");
  assert.equal(r.receipt.amountIn, 20_000_000n);
  const v = await ledger.view();
  assert.deepEqual(v.boughtPeriods, { "m-1": ["2026-W39"] });
  assert.equal(swap.calls.execute, 1);
});

test("second run in the same week skips without quoting; next week buys again", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate()); const swap = fakeSwap();
  await runOnce({ ledger, swap, account: agent, chain, now: friday });
  const again = await runOnce({ ledger, swap, account: agent, chain, now: saturday });
  assert.deepEqual(again, { outcome: "skipped", reason: "period-already-bought", periodKey: "2026-W39" });
  assert.equal(swap.calls.quote, 1, "a refused run must not ask for a quote");
  const next = await runOnce({ ledger, swap, account: agent, chain, now: nextMonday });
  assert.equal(next.outcome, "bought"); assert.equal(next.periodKey, "2026-W40");
});

test("a revoked mandate skips and the skip is in the passbook with its reason", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate()); await ledger.revoke("m-1", 1758700000);
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.equal(r.reason, "revoked");
  const raw = JSON.parse((await import("node:fs")).readFileSync(ledger.path, "utf8"));
  assert.equal(raw.entries.at(-1).kind, "skip"); assert.equal(raw.entries.at(-1).reason, "revoked");
});

test("no mandate for this agent → no-mandate, nothing recorded", async () => {
  const ledger = fresh(); await ledger.addMandate(mandate({ agent: "0x2222222222222222222222222222222222222222" }));
  const r = await runOnce({ ledger, swap: fakeSwap(), account: agent, chain, now: friday });
  assert.deepEqual(r, { outcome: "no-mandate" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd uniswap && node --test test/tsumitate.test.js`
Expected: FAIL — cannot find `../src/tsumitate.js`

- [ ] **Step 3: Implement**

`uniswap/src/tsumitate.js`:
```js
import { checkMandate } from "./mandate/index.js";

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * One run of the family's tsumitate. Idempotent: the mandate's period key decides whether this
 * run may buy, so a scheduler can wake it as often as it likes. Every outcome is written to the
 * passbook — a refusal is a line the family reads, not a silent no-op.
 */
export async function runOnce({ ledger, swap, account, chain, now = new Date(), mandateId }) {
  const view = await ledger.view();
  const m = mandateId
    ? view.mandates.find((x) => x.id === mandateId)
    : view.mandates.find((x) => same(x.agent, account.address) && x.kind === "standing");
  if (!m) return { outcome: "no-mandate" };

  const intent = { chainId: chain.chainId, tokenIn: m.tokenIn, tokenOut: m.tokenOut,
    amountIn: m.perRunCap, recipient: account.address, slippageBps: 50 };
  const verdict = checkMandate(m, view, intent, now);
  if (!verdict.ok) {
    await ledger.record({ at: now.toISOString(), kind: "skip", who: account.address, mandateId: m.id,
      periodKey: verdict.periodKey, reason: verdict.reason });
    return { outcome: "skipped", reason: verdict.reason, periodKey: verdict.periodKey };
  }

  const quote = await swap.quote(intent);
  if (quote.amountOutExpected === 0n) {
    await ledger.record({ at: now.toISOString(), kind: "skip", who: account.address, mandateId: m.id,
      periodKey: verdict.periodKey, reason: "no-liquidity" });
    return { outcome: "skipped", reason: "no-liquidity", periodKey: verdict.periodKey };
  }
  const receipt = await swap.execute(quote, account);
  await ledger.record({ at: now.toISOString(), kind: "buy", who: account.address, mandateId: m.id,
    periodKey: verdict.periodKey, amountIn: receipt.amountIn, amountOut: receipt.amountOut,
    price: receipt.price, txHash: receipt.txHash, decisionOrigin: verdict.decisionOrigin });
  return { outcome: "bought", receipt, periodKey: verdict.periodKey };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd uniswap && node --test test/tsumitate.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add uniswap/src/tsumitate.js uniswap/test/tsumitate.test.js
git commit -m "uniswap: runOnce — a mandate-gated, idempotent tsumitate run"
```

---

### Task 9: The CLI, end to end on the fork

**Files:**
- Create: `uniswap/src/cli/tsumitate.js`, `uniswap/src/cli/mandate.js`
- Modify: `uniswap/package.json` (add the `mandate` script)

**Interfaces:**
- Produces: `pnpm mandate sign` (grandmother signs a standing mandate for the agent and it is stored
  in the file ledger with `approval.method = "wallet-signature"`), `pnpm mandate revoke <id>`,
  `pnpm tsumitate` (one run, JSON to stdout, exit 0 on bought/skipped, 3 on no-mandate).

- [ ] **Step 1: Write the mandate CLI**

`uniswap/src/cli/mandate.js`:
```js
// Slice-1 stand-in for the signing screen: a member's key signs a standing mandate for the agent.
// Usage: MEMBER_PK=0x… AGENT_PK=0x… pnpm mandate sign [perRunUsdc] [perPeriodUsdc] [days]
//        pnpm mandate revoke <id>
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { ledgerByName } from "../ledger/index.js";
import { mandateTypedData, recoverMandateSigner } from "../mandate/index.js";

const [cmd, a, b, c] = process.argv.slice(2);
const chain = chainByName();
const ledger = ledgerByName();

if (cmd === "sign") {
  const member = privateKeyToAccount(process.env.MEMBER_PK);
  const agent = privateKeyToAccount(process.env.AGENT_PK);
  const d = chain.tokens.USDC.decimals;
  const m = {
    id: `m-${Date.now()}`, roomId: process.env.ROOM_ID ?? "room-demo", agent: agent.address, kind: "standing",
    tokenIn: chain.tokens.USDC.address, tokenOut: chain.tokens.WETH.address,
    perRunCap: BigInt(Math.round(Number(a ?? "20") * 10 ** d)),
    perPeriodCap: BigInt(Math.round(Number(b ?? "100") * 10 ** d)),
    period: process.env.TSUMITATE_PERIOD ?? "week",
    expiresAt: Math.floor(Date.now() / 1000) + Number(c ?? "90") * 86_400, nonce: Date.now(),
  };
  const signature = await member.signTypedData(mandateTypedData(m, chain.chainId));
  const signer = await recoverMandateSigner(m, chain.chainId, signature);
  m.approval = { method: "wallet-signature", subject: signer, verifiedAt: Math.floor(Date.now() / 1000), ref: signature };
  await ledger.addMandate(m);
  console.log(JSON.stringify({ ...m, perRunCap: m.perRunCap.toString(), perPeriodCap: m.perPeriodCap.toString() }, null, 2));
} else if (cmd === "revoke") {
  await ledger.revoke(a, Math.floor(Date.now() / 1000));
  console.log(JSON.stringify({ revoked: a }));
} else {
  console.error("usage: mandate sign [perRun] [perPeriod] [days] | mandate revoke <id>"); process.exit(2);
}
```

Add to `uniswap/package.json` scripts: `"mandate": "node src/cli/mandate.js"`.

- [ ] **Step 2: Write the tsumitate CLI**

`uniswap/src/cli/tsumitate.js`:
```js
// One run. A scheduler (cron, or the app's timer in slice 2) calls this; it never loops itself.
// Env: AGENT_PK (required) · CHAIN=base · SWAP_PROVIDER=router · LEDGER=file · NOW=<ISO> (tests/demo)
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";
import { ledgerByName } from "../ledger/index.js";
import { runOnce } from "../tsumitate.js";

const key = process.env.AGENT_PK;
if (!key) { console.error("AGENT_PK is required"); process.exit(2); }
const chain = chainByName();
const result = await runOnce({ ledger: ledgerByName(), swap: swapProvider(undefined, chain), chain,
  account: privateKeyToAccount(key), now: process.env.NOW ? new Date(process.env.NOW) : new Date() });
console.log(JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
process.exit(result.outcome === "no-mandate" ? 3 : 0);
```

- [ ] **Step 3: Run the whole slice on the fork**

```bash
cd uniswap && export PATH="$HOME/.foundry/bin:$PATH"
export AGENT_PK=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6   # anvil #9 = the agent
export MEMBER_PK=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a  # anvil #6 = the grandmother
rm -rf .state
pnpm fund                                   # agent holds USDC
pnpm mandate sign 20 100 90                 # standing: 20 USDC/run, 100/week, 90 days
pnpm tsumitate                              # → outcome "bought", tx hash
pnpm tsumitate                              # → "skipped", "period-already-bought"
NOW=2026-10-05T09:00:00Z pnpm tsumitate     # next ISO week → "bought"
pnpm mandate revoke <id from the sign output>
pnpm tsumitate                              # → "skipped", "revoked"
cat .state/passbook.json                    # two buys, two skips, each with its reason
```

Expected: exactly that sequence. Then `pnpm test` → all suites pass (integration suites skip if the
fork is down).

- [ ] **Step 4: Commit**

```bash
git add uniswap/package.json uniswap/src/cli/mandate.js uniswap/src/cli/tsumitate.js
git commit -m "uniswap: sign a mandate, run tsumitate, refuse — end to end on the fork"
```

---

## Out of this slice (slice 2, its own plan)

- `swap/api` — Trading API provider with `X-Agent-Info` (needs `UNISWAP_API_KEY`).
- `ledger/workspace` — passbook database rows + relationship-document line over the app's REST.
- Deposit flow, `family` profile section, signing UI, dashboard seed, scheduler in the app.
- `README.md` (code pointers, Continuity split), `DEMO.md`, `FEEDBACK.md`.
