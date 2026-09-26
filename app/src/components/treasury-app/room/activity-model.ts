/**
 * The treasury's history as rows: every treasury action and recurring-buy run,
 * what it says, and — once it reached a chain — which chain, what moved in
 * tokens and its transaction. The Wallet tab lists the rows that moved on a
 * chain (onChainOnly); the Activity tab lists every row. Pure: status and the
 * wallet in, rows out; UI text goes through `t`.
 */

import { explorerTxUrl, type TreasuryChain } from "@/components/chain/chain-badge";
import type { T } from "@/i18n/translate";
import { TREASURY_TIME_ZONE, type TreasuryStatus } from "@/lib/agent/treasury/types";
import { memoOf, shortAddress, skipReasonText, tokenAmount, usd } from "./room-model";
import type { RecurringRun, SwapAmounts, TreasuryAction, TreasuryWallet } from "./room-types";

/** The agent's one address lives on both: the pot pays on Ethereum Sepolia, swaps run on Base. */
export type Chain = TreasuryChain;

export type ActivityTone = "ok" | "wait" | "bad" | "info";

export interface ActivityItem {
  id: string;
  at: string;
  tone: ActivityTone;
  /** what kind of line it is, for the icon */
  icon: "rules" | "recurring" | "buy" | "skip" | "pay" | "invest" | "withdraw" | "wait";
  title: string;
  /** what it was for and where it went: "hotel deposit · to Hotel Gracery" */
  detail: string | null;
  /** the money figure on the right: "−$180" left the pot, "$20" swapped, "up to $240" an authority */
  amount: string | null;
  /** the chain its transaction is on; null when nothing reached a chain (a decision, a request, a refusal) */
  chain: Chain | null;
  /** what moved, in tokens: "0.0009 ETH", "0.1 USDC → 0.0000372 WETH" */
  tokens: string | null;
  /** a swap through Uniswap v3 on Base */
  uniswap: boolean;
  /** where a payment went, as the relation names it and as the chain does; null for a swap or a decision */
  to: { label: string | null; address: string | null } | null;
  /** its transaction: settled, still unconfirmed, or failed on chain; `url` only when a public explorer has it */
  tx: { hash: string; state: TxState; url: string | null } | null;
}

export type TxState = "confirmed" | "pending" | "failed";

const MINUS = "−";
const TX_HASH = /0x[0-9a-fA-F]{64}/;

function txOf(hash: string | null | undefined, chain: Chain | null, state: TxState, wallet: TreasuryWallet): ActivityItem["tx"] {
  if (!hash || !chain) return null;
  return { hash, state, url: wallet.explorable[chain] ? explorerTxUrl(chain, hash) : null };
}

function swapLine(s: SwapAmounts): string {
  return `${tokenAmount(s.usdcIn)} USDC → ${tokenAmount(s.wethOut)} WETH`;
}

/** "hotel deposit · to Hotel Gracery", without saying the same name twice. */
function paymentDetail(t: T, a: TreasuryAction): string {
  const what = memoOf(a);
  const to = a.recipient?.label ?? (a.recipient?.address ? shortAddress(a.recipient.address) : null);
  if (!to) return what;
  const toLine = t("to {who}", { who: to });
  return what.toLowerCase() === to.toLowerCase() ? toLine : `${what} · ${toLine}`;
}

function actionItem(t: T, a: TreasuryAction, status: TreasuryStatus, wallet: TreasuryWallet): ActivityItem {
  const approvedBy = a.approvals.map((p) => p.displayName).join(", ");
  const base = { id: a.id, at: a.createdAt, amount: null, chain: null, tokens: null, uniswap: false, to: null, tx: null };

  if (a.kind === "ratify") {
    if (a.status === "executed")
      return { ...base, tone: "info", icon: "rules", title: t("Rules adopted"), detail: approvedBy ? t("approved by {names}", { names: approvedBy }) : a.memo };
    if (a.status === "pending")
      return { ...base, tone: "wait", icon: "rules", title: t("Rules change waiting for approval"), detail: a.memo };
    return { ...base, tone: "bad", icon: "rules", title: t("Rules change not adopted"), detail: a.error ?? a.memo };
  }

  if (a.kind === "recurring-buy") {
    // the memo is "recurring buy · $20 of ETH weekly · 12 weeks"; the title already says what it is
    const detail = memoOf(a).replace(/^recurring buy\s*·\s*/i, "");
    const amount = t("up to {amount}", { amount: usd(a.amountUsd) });
    if (a.status === "executed")
      return { ...base, amount, tone: "ok", icon: "recurring", title: t("Recurring buy adopted"), detail: approvedBy ? `${detail} · ${t("approved by {names}", { names: approvedBy })}` : detail };
    if (a.status === "pending")
      return { ...base, amount, tone: "wait", icon: "wait", title: t("Recurring buy waiting for approval"), detail };
    if (a.status === "cancelled")
      return { ...base, amount, tone: "bad", icon: "recurring", title: t("Recurring buy withdrawn or expired"), detail };
    return { ...base, amount, tone: "bad", icon: "recurring", title: t("Recurring buy not adopted"), detail: a.error ?? detail };
  }

  // a payment leaves the pot on Ethereum Sepolia; an investment swaps on Base
  // when this server invests (treasuryStatus gives only that one a txUrl)
  const swapped = a.kind === "investment" && Boolean(a.txUrl);
  const chain: Chain | null = a.txHash ? (swapped ? "base" : "sepolia") : null;
  const moved = wallet.swaps[a.id];
  const tokens =
    chain === "sepolia" && status.usdPerEth > 0
      ? `${tokenAmount(a.amountUsd / status.usdPerEth)} ETH`
      : chain === "base" && moved
        ? swapLine(moved)
        : null;
  const txState: TxState = a.status === "executed" ? "confirmed" : a.status === "unconfirmed" ? "pending" : "failed";
  const onChain = { chain, tokens, uniswap: swapped, to: swapped ? null : a.recipient, tx: txOf(a.txHash, chain, txState, wallet) };
  const icon = a.kind === "investment" ? "invest" : a.kind === "withdrawal" ? "withdraw" : "pay";
  // a swap pays no payee: the WETH comes back to the agent's own address
  const detail = swapped ? memoOf(a) : paymentDetail(t, a);
  // money that left the pot reads negative; an investment stays the relation's, in WETH
  const moneyOut = a.kind === "investment" ? usd(a.amountUsd) : `${MINUS}${usd(a.amountUsd)}`;

  switch (a.status) {
    case "executed":
      return {
        ...base,
        ...onChain,
        amount: moneyOut,
        tone: "ok",
        icon,
        title: a.kind === "investment" ? t("Invested") : a.kind === "withdrawal" ? t("Sent to a member") : t("Paid"),
        detail,
      };
    case "unconfirmed":
      return { ...base, ...onChain, amount: moneyOut, tone: "wait", icon: "wait", title: t("Sent, not confirmed yet"), detail };
    case "pending":
      return { ...base, amount: usd(a.amountUsd), tone: "wait", icon: "wait", title: t("Waiting for approval"), detail };
    case "cancelled":
      return { ...base, amount: usd(a.amountUsd), tone: "bad", icon, title: t("Expired unapproved"), detail };
    default:
      // blocked before sending, or failed — a reverted payment keeps its transaction, nothing moved
      return {
        ...base,
        ...onChain,
        tokens: null,
        amount: usd(a.amountUsd),
        tone: "bad",
        icon,
        title: a.status === "blocked" ? t("Blocked by our rules") : t("Not paid"),
        detail: a.error ?? detail,
      };
  }
}

function runItem(t: T, run: RecurringRun, i: number, wallet: TreasuryWallet): ActivityItem {
  const hash = run.txUrl?.match(TX_HASH)?.[0] ?? null;
  const base = { id: `run-${run.at}-${i}`, at: run.at, detail: null, amount: null, chain: null, tokens: null, uniswap: false, to: null, tx: null };
  if (run.outcome === "bought") {
    // the run records real USDC; the story dollars are that at demo scale
    const storyUsd = run.usdcIn ? Math.round((Number(run.usdcIn) / wallet.usdcPerUsd) * 100) / 100 : null;
    return {
      ...base,
      tone: "ok",
      icon: "buy",
      title: t("Weekly ETH buy"),
      amount: storyUsd === null ? null : usd(storyUsd),
      chain: "base",
      uniswap: true,
      tokens: run.usdcIn && run.wethOut ? swapLine({ usdcIn: run.usdcIn, wethOut: run.wethOut }) : null,
      tx: txOf(hash, "base", "confirmed", wallet),
    };
  }
  // a skip whose swap was sent (and failed) happened on Base; a plain skip moved nothing
  return {
    ...base,
    tone: hash ? "bad" : "info",
    icon: "skip",
    title: t("Weekly buy skipped"),
    detail: skipReasonText(t, run.reason),
    chain: hash ? "base" : null,
    uniswap: Boolean(hash),
    tx: txOf(hash, hash ? "base" : null, "failed", wallet),
  };
}

/** Every treasury action the status carries plus every recurring run, newest first. */
export function buildActivity(t: T, status: TreasuryStatus, wallet: TreasuryWallet): ActivityItem[] {
  const items = [
    ...status.actions.map((a) => actionItem(t, a, status, wallet)),
    ...(status.recurring?.history ?? []).map((r, i) => runItem(t, r, i, wallet)),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** The rows that moved money on a chain — the wallet's transactions. */
export function onChainOnly(items: ActivityItem[]): ActivityItem[] {
  return items.filter((item) => item.chain !== null);
}

export interface ActivityDay {
  key: string;
  label: string;
  items: ActivityItem[];
}

// the relation's calendar day; the room panel and the doc's Treasury Activity read the same clock
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: TREASURY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Groups newest-first items by the relation's calendar day: "Today", "Yesterday", then "Mon, Sep 21". */
export function groupByDay(t: T, items: ActivityItem[], intlLocale: string, now: Date): ActivityDay[] {
  const dayKey = (d: Date) => DAY_KEY.format(d); // "2026-09-21"
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short", month: "short", day: "numeric", timeZone: TREASURY_TIME_ZONE });
  const days: ActivityDay[] = [];
  for (const item of items) {
    const d = new Date(item.at);
    const key = dayKey(d);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: key === today ? t("Today") : key === yesterday ? t("Yesterday") : fmt.format(d), items: [] };
      days.push(day);
    }
    day.items.push(item);
  }
  return days;
}
