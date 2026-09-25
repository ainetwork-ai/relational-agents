// The fill watcher: every Swapped event on the OFFICIAL SwapVM router becomes
// (1) a Swap Journal row in the workspace — auto half filled, judgement half
//     left empty so the review queue nags you — and
// (2) a markdown trade record in the aindrive folder (the evidence locker).
// Pure API consumer: zero app changes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { formatUnits } from "viem";
import { ABI } from "@1inch/swap-vm-sdk";
import { SWAP_VM_AQUA_ROUTER, USDC, WETH } from "./config.js";
import { publicClient } from "./clients.js";
import { api, databaseByTitle } from "./app-api.js";

const RECORDS_DIR = process.env.AINDRIVE_DIR ?? join(process.env.HOME, "aindrive-web3-trading", "03_trade-records");
const Q_FILE = new URL("../.state/pending-quotes.json", import.meta.url).pathname;

const TOKENS = {
  [USDC.toLowerCase()]: { symbol: "USDC", decimals: 6 },
  [WETH.toLowerCase()]: { symbol: "WETH", decimals: 18 },
};
const sym = (a) => TOKENS[a.toLowerCase()]?.symbol ?? a.slice(0, 8);
const dec = (a) => TOKENS[a.toLowerCase()]?.decimals ?? 18;
const human = (amount, addr) => Number(formatUnits(amount, dec(addr)));

// "Day" is a select the dashboard groups by — a fill on a new day must first
// become an option, or the bar chart files it under "none"
async function ensureDayOption(db, day) {
  const prop = db.props["Day"];
  const options = prop.config?.options ?? [];
  if (options.some((o) => o.id === day)) return;
  options.push({ id: day, name: day, color: ["blue", "green", "purple", "orange", "pink", "yellow"][options.length % 6] });
  await api("PATCH", `/api/databases/${db.id}/properties/${prop.id}`, { config: { ...prop.config, options } });
  prop.config = { ...prop.config, options };
}

async function journalRow(db, fill) {
  const P = (n) => db.props[n].id;
  const titleId = db.properties.find((p) => p.type === "title").id;
  await ensureDayOption(db, fill.day);
  await api("POST", `/api/databases/${db.id}/rows`, { values: {
    [titleId]: fill.title,
    [P("Date")]: fill.date,
    [P("Token")]: fill.tokenSymbol.toLowerCase(),
    [P("Side")]: fill.side,
    [P("Route")]: "aqua-xyc",
    [P("Amount")]: fill.amountUsd,
    [P("Fill price")]: fill.price,
    [P("Expected out")]: fill.expectedOut ?? null,
    [P("Executed out")]: fill.executedOut,
    [P("Slippage %")]: fill.slippagePct ?? null,
    [P("Gas ETH")]: fill.gasEth,
    [P("Tx")]: `https://basescan.org/tx/${fill.tx}`,
    [P("Day")]: fill.day,
    [P("Review")]: "pending",
  }});
}

function tradeRecordMd(fill) {
  return `---
type: TradeRecord
tx: ${fill.tx}
strategy: ${fill.orderHash}
route: aqua-xyc
recordedAt: ${new Date().toISOString()}
---
# ${fill.title}

- Fill: ${fill.amountInHuman} ${sym(fill.tokenIn)} → ${fill.amountOutHuman} ${sym(fill.tokenOut)}
- Price: ${fill.price} ${sym(fill.tokenOut) === "USDC" ? "USDC" : "USDC-equiv"} per ${fill.tokenSymbol}
- Expected out: ${fill.expectedOut ?? "n/a"} · executed: ${fill.executedOut} · slippage: ${fill.slippagePct ?? "n/a"}%
- Gas: ${fill.gasEth} ETH · maker ${fill.maker} · taker ${fill.taker}
- Onchain: official 1inch Aqua registry + SwapVM router (Base fork)

> Entry reason: _write it now — tomorrow-you won't remember._
`;
}

async function onSwapped(log) {
  const { orderHash, maker, taker, tokenIn, tokenOut, amountIn, amountOut } = log.args;
  const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash });
  const gasEth = Number(formatUnits(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n), 18));

  const quotes = existsSync(Q_FILE) ? JSON.parse(readFileSync(Q_FILE, "utf8")) : {};
  const quoted = quotes[log.transactionHash];

  const inH = human(amountIn, tokenIn);
  const outH = human(amountOut, tokenOut);
  // the non-USDC leg is "the token"; buying it when USDC goes in
  const buying = sym(tokenIn) === "USDC";
  const tokenSymbol = buying ? sym(tokenOut) : sym(tokenIn);
  const price = buying ? inH / outH : outH / inH;
  const amountUsd = buying ? inH : outH;
  const expectedOut = quoted ? human(BigInt(quoted.expectedOut), tokenOut) : null;
  const slippagePct = expectedOut ? Number((((expectedOut - outH) / expectedOut) * 100).toFixed(4)) : null;
  const now = new Date();

  const fill = {
    tx: log.transactionHash, orderHash, maker, taker, tokenIn, tokenOut,
    amountInHuman: inH, amountOutHuman: outH,
    title: `${buying ? "Buy" : "Sell"} ${tokenSymbol} $${amountUsd.toFixed(2)}`,
    side: buying ? "buy" : "sell",
    tokenSymbol,
    price: Number(price.toFixed(6)),
    amountUsd: Number(amountUsd.toFixed(2)),
    expectedOut, executedOut: outH, slippagePct,
    gasEth: Number(gasEth.toFixed(8)),
    date: now.toISOString(),
    day: now.toISOString().slice(0, 10),
  };

  const db = await databaseByTitle("Swap Journal");
  // idempotent by tx hash — a watcher restart must not double-journal a fill
  const txId = db.props["Tx"].id;
  if (db.rows.some((r) => String(r.values[txId] ?? "").includes(fill.tx))) {
    console.log(`already journaled, skipping: ${fill.tx.slice(0, 12)}…`);
    return;
  }
  await journalRow(db, fill);

  mkdirSync(RECORDS_DIR, { recursive: true });
  writeFileSync(join(RECORDS_DIR, `${log.transactionHash}.md`), tradeRecordMd(fill));

  console.log(`journaled: ${fill.title} @ ${fill.price} | slip ${fill.slippagePct ?? "?"}% | ${log.transactionHash.slice(0, 12)}…`);
}

console.log(`watching Swapped on ${SWAP_VM_AQUA_ROUTER} → journal + ${RECORDS_DIR}`);
publicClient.watchContractEvent({
  address: SWAP_VM_AQUA_ROUTER,
  abi: ABI.SWAP_VM_ABI,
  eventName: "Swapped",
  pollingInterval: 1200,
  onLogs: async (logs) => {
    for (const log of logs) {
      try { await onSwapped(log); } catch (e) { console.error("journal failed:", e.message); }
    }
  },
});
