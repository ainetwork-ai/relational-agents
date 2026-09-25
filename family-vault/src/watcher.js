// The capsule's scribe: every on-chain event becomes a Vault Ledger row and a
// markdown record in the family drive. When CapsuleOpened fires, the sealed
// letter page unlocks — the money and the message arrive together.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { formatUnits, parseAbiItem } from "viem";
import { USDC, WETH, STATE_FILE } from "./config.js";
import { publicClient, artifact, erc20Abi } from "./clients.js";
import { api } from "./app-api.js";

const st = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const WS_STATE = new URL("../.state/workspace.json", import.meta.url).pathname;
const ws = JSON.parse(readFileSync(WS_STATE, "utf8"));

const vaultAbi = artifact("FamilyVault").abi;
const routerAbi = artifact("FamilyVaultSwapVM").abi;

let lastPrice = 2500; // USDC per WETH, updated on every fill
let lastValue = null;

async function vaultValue() {
  const [u, w] = await Promise.all([USDC, WETH].map((t) =>
    publicClient.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [st.vault] })
  ));
  return Number(formatUnits(u, 6)) + Number(formatUnits(w, 18)) * lastPrice;
}

async function blockDay(blockNumber) {
  const b = await publicClient.getBlock({ blockNumber });
  return new Date(Number(b.timestamp) * 1000).toISOString();
}

async function ensureDayOption(db, dateIso) {
  // Date is a plain date property here; nothing to upsert — kept for parity
  return dateIso;
}

async function ledgerRow(values) {
  const db = await (await import("./app-api.js")).databaseByTitle("Vault Ledger");
  const P = (n) => db.props[n].id;
  const titleId = db.properties.find((p) => p.type === "title").id;
  await api("POST", `/api/databases/${db.id}/rows`, { values: {
    [titleId]: values.title,
    [P("Date")]: values.date,
    [P("Event")]: values.event,
    ...(values.token && { [P("Token")]: values.token }),
    ...(values.amount != null && { [P("Amount")]: values.amount }),
    [P("Vault value $")]: values.value,
    ...(values.spread != null && { [P("Spread $")]: values.spread }),
    ...(values.taker && { [P("Taker")]: values.taker }),
    ...(values.memo && { [P("Memo")]: values.memo }),
    ...(values.tx && { [P("Tx")]: `https://basescan.org/tx/${values.tx}` }),
  }});
}

function driveRecord(name, md) {
  writeFileSync(join(ws.driveDir, "02_vault-records", name), md);
}

async function record(ev, fields) {
  const value = Number((await vaultValue()).toFixed(2));
  const spread = ev === "fill" && lastValue != null ? Number((value - lastValue).toFixed(2)) : undefined;
  lastValue = value;
  const date = await blockDay(fields.blockNumber);
  await ledgerRow({ ...fields, event: ev, value, spread, date });
  driveRecord(`${fields.tx}.md`, `---
type: VaultRecord
event: ${ev}
date: ${date}
vaultValueUsd: ${value}
tx: ${fields.tx}
---
# ${fields.title}

${fields.memo ?? ""}
`);
  console.log(`${ev}: ${fields.title} · vault $${value}`);
}

async function onOpened(log) {
  // 1. the ledger's final row
  await record("opened", {
    title: "Capsule opened — everything to Yuna",
    tx: log.transactionHash,
    blockNumber: log.blockNumber,
    taker: log.args.beneficiary,
  });

  // 2. the letter leaves the drive and lands in the page
  const letter = readFileSync(join(ws.driveDir, "01_letters", "letter-to-yuna.md"), "utf8")
    .replace(/^---[\s\S]*?---\n/, "");
  const pageId = ws.capsulePageId;
  await api("PATCH", `/api/pages/${pageId}`, { title: "Yuna's Time Capsule — opened", icon: "🎁" });
  await api("POST", `/api/pages/${pageId}/blocks`, { type: "divider", content: {} });
  for (const line of letter.split(/\n{2,}/).map((s) => s.replace(/\n/g, " ").trim()).filter(Boolean)) {
    const type = line.startsWith("# ") ? "heading2" : "paragraph";
    await api("POST", `/api/pages/${pageId}/blocks`, { type, content: { text: line.replace(/^# /, "") } });
  }

  // 3. the doorbell
  await api("POST", "/api/notifications", {
    type: "reminder",
    pageId,
    body: "🎁 The time capsule opened — 18 years of the vault and a letter from Mom & Dad are waiting.",
  });
  console.log("capsule page unlocked + notification sent");
}

console.log(`watching vault ${st.vault} + router ${st.router}`);

publicClient.watchContractEvent({
  address: st.router, abi: routerAbi, eventName: "Swapped", pollingInterval: 1000,
  onLogs: async (logs) => {
    for (const log of logs) {
      try {
        const { taker, tokenIn, amountIn, amountOut } = log.args;
        const buying = tokenIn.toLowerCase() === USDC.toLowerCase(); // taker buys WETH
        const inH = Number(formatUnits(amountIn, buying ? 6 : 18));
        const outH = Number(formatUnits(amountOut, buying ? 18 : 6));
        lastPrice = buying ? inH / outH : outH / inH;
        await record("fill", {
          title: `${buying ? "Sold" : "Bought"} WETH @ ${lastPrice.toFixed(2)}`,
          token: buying ? "usdc" : "weth",
          amount: inH,
          taker,
          tx: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      } catch (e) { console.error("fill record failed:", e.message); }
    }
  },
});

publicClient.watchContractEvent({
  address: st.vault, abi: vaultAbi, pollingInterval: 1000,
  onLogs: async (logs) => {
    for (const log of logs) {
      try {
        const a = log.args;
        const base = { tx: log.transactionHash, blockNumber: log.blockNumber };
        if (log.eventName === "Deposited") {
          const isUsdc = a.token.toLowerCase() === USDC.toLowerCase();
          await record("deposit", { ...base,
            title: `Deposit ${formatUnits(a.amount, isUsdc ? 6 : 18)} ${isUsdc ? "USDC" : "WETH"}`,
            token: isUsdc ? "usdc" : "weth",
            amount: Number(formatUnits(a.amount, isUsdc ? 6 : 18)),
            memo: a.memo || undefined,
          });
        } else if (log.eventName === "PolicyShipped") {
          await record("policy", { ...base, title: `Policy shipped · ${Number(a.capBps) / 100}% per-fill cap` });
        } else if (log.eventName === "ExitRequested") {
          await record("exit-request", { ...base,
            title: "Parent requested early exit — 30-day clock started",
            memo: `executable at ${new Date(Number(a.executableAt) * 1000).toISOString()}`,
          });
        } else if (log.eventName === "ExitCancelled") {
          await record("exit-cancel", { ...base, title: "Exit cancelled — the capsule stays" });
        } else if (log.eventName === "CapsuleOpened") {
          await onOpened(log);
        }
      } catch (e) { console.error(`${log.eventName} record failed:`, e.message); }
    }
  },
});
